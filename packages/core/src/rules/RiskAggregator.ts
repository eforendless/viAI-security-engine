import { emptyTrustResult, type TrustResult } from "../trust/TrustResult.js";
import { DecisionEngine } from "./DecisionEngine.js";
import type { AssessmentEvidenceQuality, ConfidenceFactor, EvidenceCategory, EvidenceStrength, InvestigationPriority, Recommendation, RuleResult, StaticAnalysisReport, StaticAssessment, StaticVerdict } from "./RuleResult.js";

export class RiskAggregator {
  constructor(private readonly decisionEngine = new DecisionEngine()) {}

  aggregate(fileHash: string, results: readonly RuleResult[], metadata: unknown, trust: TrustResult = emptyTrustResult(), quality: AssessmentEvidenceQuality = {}): StaticAnalysisReport {
    const correlated = correlate(results);
    const riskScore = Math.round(clamp(correlated.score, 0, 100));
    const overallScore = combinedRiskScore(riskScore, trust.trustScore);
    const confidenceResult = evidenceConfidence(quality);
    const hasStrongEvidence = correlated.applied.some((result) => strengthOf(result) === "strong" || strengthOf(result) === "very-strong");
    const hasMeaningfulModerateEvidence = correlated.applied.filter((result) => strengthOf(result) === "moderate").length >= 2;
    const recommendation = this.decisionEngine.decide({ riskScore, trustScore: trust.trustScore, overallScore, confidence: confidenceResult.score, matchedRules: correlated.applied, hasStrongEvidence, hasMeaningfulModerateEvidence });
    const verdict = verdictFor(riskScore, trust.trustScore, confidenceResult.score, hasStrongEvidence, hasMeaningfulModerateEvidence);
    const priority = priorityFor(recommendation, verdict, riskScore);
    const escalation = recommendation === "DYNAMIC_ANALYSIS" ? { requested: true as const, priority, reasonCodes: correlated.applied.map((result) => result.id), requestedEvidence: requestedEvidence(correlated.applied) } : undefined;
    return {
      fileHash,
      riskScore,
      trustScore: trust.trustScore,
      overallScore,
      confidence: confidenceResult.score,
      recommendation,
      matchedRules: Object.freeze([...results]),
      indicators: Object.freeze([...new Set(results.map((result) => result.evidence))]),
      trustIndicators: trust.indicators,
      metadata,
      correlations: Object.freeze(correlated.correlations),
      assessment: Object.freeze({ schemaVersion: "0.3", suspicion: { score: riskScore, level: suspicionLevel(riskScore) }, trust: { score: trust.trustScore, level: trustLevel(trust.trustScore) }, confidence: confidenceResult, verdict, investigationPriority: priority, recommendation, ...(escalation ? { escalation } : {}) }),
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

function combinedRiskScore(riskScore: number, trustScore: number): number {
  const trustInfluence = Math.min(0.3, (trustScore / 100) * (0.15 + 0.25 * (1 - riskScore / 100)));
  return Math.round(riskScore * (1 - trustInfluence));
}

function correlate(results: readonly RuleResult[]): { score: number; applied: readonly RuleResult[]; correlations: readonly { group: string; appliedScore: number; suppressedScore: number }[] } {
  const groups = new Map<string, RuleResult[]>();
  for (const [index, result] of results.entries()) { const group = result.correlationGroup ?? `${result.id}:${index}`; groups.set(group, [...(groups.get(group) ?? []), result]); }
  const applied: RuleResult[] = [];
  const correlations: Array<{ group: string; appliedScore: number; suppressedScore: number }> = [];
  for (const [group, members] of groups) {
    const chosen = [...members].sort((left, right) => right.score - left.score)[0]!;
    applied.push(chosen);
    const total = members.reduce((sum, member) => sum + member.score, 0);
    correlations.push({ group, appliedScore: chosen.score, suppressedScore: total - chosen.score });
  }
  const categoryTotals = new Map<string, number>();
  const capped = applied.map((result) => {
    const category = result.category ?? `unclassified:${result.id}`;
    const used = categoryTotals.get(category) ?? 0;
    const available = Math.max(0, categoryCap(category, strengthOf(result)) - used);
    const contribution = Math.min(result.score, available);
    categoryTotals.set(category, used + contribution);
    return contribution;
  });
  return { score: capped.reduce((sum, value) => sum + value, 0), applied, correlations };
}

function categoryCap(category: string, strength: EvidenceStrength): number { if (category.startsWith("unclassified:")) return 100; return strength === "informational" ? 5 : strength === "weak" ? 15 : strength === "moderate" ? 45 : strength === "strong" ? 75 : 100; }
function strengthOf(result: RuleResult): EvidenceStrength { return result.strength ?? (result.severity === "high" ? "strong" : result.severity === "medium" ? "moderate" : "weak"); }

function evidenceConfidence(quality: AssessmentEvidenceQuality): { score: number; level: "low" | "medium" | "high"; factors: readonly ConfidenceFactor[] } {
  const factors: ConfidenceFactor[] = [];
  if ((quality.collectorFailures ?? 0) > 0) factors.push({ source: "COLLECTORS", impact: -15 * (quality.collectorFailures ?? 0), reason: "One or more evidence collectors failed." });
  if (quality.peParseStatus === "partial") factors.push({ source: "PE_PARSE", impact: -10, reason: "PE analysis was partial." });
  if (quality.peParseStatus === "malformed" || quality.peParseStatus === "unsupported") factors.push({ source: "PE_PARSE", impact: -25, reason: "PE analysis could not be completed." });
  if (quality.snapshotTruncated) factors.push({ source: "SNAPSHOT", impact: -10, reason: "Inspection bytes were bounded for this large file." });
  if (quality.signatureState === "verification-unavailable" || quality.signatureState === "verification-error") factors.push({ source: "SIGNATURE", impact: -15, reason: "Authenticode verification was unavailable or incomplete." });
  if (quality.baselineState === "new") factors.push({ source: "BASELINE", impact: -5, reason: "No prior local baseline is available for change comparison." });
  const score = Math.round(clamp(90 + factors.reduce((sum, factor) => sum + factor.impact, 0), 0, 100));
  return { score, level: score >= 75 ? "high" : score >= 50 ? "medium" : "low", factors: Object.freeze(factors) };
}

function trustLevel(score: number): "low" | "limited" | "established" | "high" { return score >= 75 ? "high" : score >= 45 ? "established" : score > 0 ? "limited" : "low"; }
function suspicionLevel(score: number): StaticAssessment["suspicion"]["level"] { return score <= 25 ? "low" : score <= 60 ? "moderate" : "high"; }
function verdictFor(score: number, trust: number, confidence: number, strong: boolean, moderate: boolean): StaticVerdict { if (score <= 15 && trust >= 45 && confidence >= 65) return "TRUSTED"; if (score <= 15 && confidence >= 65) return "LIKELY_BENIGN"; if (score >= 70 && strong) return "HIGHLY_SUSPICIOUS"; if (score >= 45 && (strong || moderate)) return "SUSPICIOUS"; return "UNKNOWN"; }
function priorityFor(recommendation: Recommendation, verdict: StaticVerdict, score: number): InvestigationPriority { if (recommendation === "DYNAMIC_ANALYSIS") return verdict === "HIGHLY_SUSPICIOUS" ? "URGENT" : score > 60 ? "HIGH" : "MEDIUM"; if (recommendation === "REVIEW") return "MEDIUM"; if (recommendation === "MONITOR") return "LOW"; return "NONE"; }
function requestedEvidence(results: readonly RuleResult[]): readonly "PROCESS_BEHAVIOR"[] | readonly ("PROCESS_BEHAVIOR" | "MEMORY_BEHAVIOR" | "FILESYSTEM_BEHAVIOR" | "REGISTRY_BEHAVIOR")[] { return results.some((result) => result.category === "memory" || result.category === "process-access") ? ["PROCESS_BEHAVIOR", "MEMORY_BEHAVIOR"] : ["PROCESS_BEHAVIOR", "FILESYSTEM_BEHAVIOR", "REGISTRY_BEHAVIOR"]; }