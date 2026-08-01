import { emptyTrustResult, type TrustResult } from "../trust/TrustResult.js";
import { DecisionEngine } from "./DecisionEngine.js";
import type { RuleResult, StaticAnalysisReport } from "./RuleResult.js";

export class RiskAggregator {
  constructor(private readonly decisionEngine = new DecisionEngine()) {}

  aggregate(fileHash: string, results: readonly RuleResult[], metadata: unknown, trust: TrustResult = emptyTrustResult()): StaticAnalysisReport {
    const riskScore = Math.round(clamp(results.reduce((total, result) => total + result.score, 0), 0, 100));
    const overallScore = combinedRiskScore(riskScore, trust.trustScore);
    const confidence = evidenceConfidence(results, trust);
    return {
      fileHash,
      riskScore,
      trustScore: trust.trustScore,
      overallScore,
      confidence,
      recommendation: this.decisionEngine.decide({ riskScore, trustScore: trust.trustScore, overallScore, confidence, matchedRules: results }),
      matchedRules: Object.freeze([...results]),
      indicators: Object.freeze([...new Set(results.map((result) => result.evidence))]),
      trustIndicators: trust.indicators,
      metadata,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }

function combinedRiskScore(riskScore: number, trustScore: number): number {
  const trustInfluence = Math.min(0.3, (trustScore / 100) * (0.15 + 0.25 * (1 - riskScore / 100)));
  return Math.round(riskScore * (1 - trustInfluence));
}

function evidenceConfidence(results: readonly RuleResult[], trust: TrustResult): number {
  return Math.round(clamp(25 + results.length * 20 + trust.indicators.length * 8, 0, 100));
}