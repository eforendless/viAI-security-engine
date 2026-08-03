import type { TrustIndicator } from "../trust/TrustIndicator.js";

export type Recommendation = "ALLOW" | "MONITOR" | "REVIEW" | "DYNAMIC_ANALYSIS" | "SANDBOX" | "AI_ANALYSIS";
export type RuleSeverity = "low" | "medium" | "high";
export type EvidenceStrength = "informational" | "weak" | "moderate" | "strong" | "very-strong";
export type EvidenceCategory = "provenance" | "execution" | "memory" | "process-access" | "persistence" | "network" | "packing" | "entropy" | "pe-structure" | "filesystem-context" | "baseline" | "signature" | "reputation";
export type StaticVerdict = "TRUSTED" | "LIKELY_BENIGN" | "UNKNOWN" | "SUSPICIOUS" | "HIGHLY_SUSPICIOUS";
export type InvestigationPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type ConfidenceLevel = "low" | "medium" | "high";
export type DynamicEvidenceKind = "PROCESS_BEHAVIOR" | "FILESYSTEM_BEHAVIOR" | "REGISTRY_BEHAVIOR" | "NETWORK_BEHAVIOR" | "PERSISTENCE_BEHAVIOR" | "MEMORY_BEHAVIOR";

export interface ConfidenceFactor { readonly source: string; readonly impact: number; readonly reason: string; }
export interface DynamicAnalysisRequest { readonly requested: true; readonly priority: InvestigationPriority; readonly reasonCodes: readonly string[]; readonly requestedEvidence: readonly DynamicEvidenceKind[]; }
export interface AssessmentEvidenceQuality { readonly collectorFailures?: number; readonly peParseStatus?: "valid" | "partial" | "malformed" | "unsupported" | "not-pe"; readonly snapshotTruncated?: boolean; readonly signatureState?: string; readonly baselineState?: string; }
export interface StaticAssessment {
  readonly schemaVersion: "0.3";
  readonly suspicion: { readonly score: number; readonly level: "low" | "moderate" | "high" };
  readonly trust: { readonly score: number; readonly level: "low" | "limited" | "established" | "high" };
  readonly confidence: { readonly score: number; readonly level: ConfidenceLevel; readonly factors: readonly ConfidenceFactor[] };
  readonly verdict: StaticVerdict;
  readonly investigationPriority: InvestigationPriority;
  readonly recommendation: Recommendation;
  readonly escalation?: DynamicAnalysisRequest;
}

export interface RuleResult {
  readonly id: string;
  readonly matched: boolean;
  readonly score: number;
  readonly severity: RuleSeverity;
  readonly evidence: string;
  readonly recommendation?: Recommendation;
  readonly category?: EvidenceCategory;
  readonly strength?: EvidenceStrength;
  readonly correlationGroup?: string;
}

export interface StaticAnalysisReport {
  readonly fileHash: string;
  readonly riskScore: number;
  readonly trustScore: number;
  readonly overallScore: number;
  readonly confidence: number;
  readonly recommendation: Recommendation;
  readonly matchedRules: readonly RuleResult[];
  readonly indicators: readonly string[];
  readonly trustIndicators: readonly TrustIndicator[];
  readonly metadata: unknown;
  readonly assessment: StaticAssessment;
  readonly correlations: readonly { readonly group: string; readonly appliedScore: number; readonly suppressedScore: number }[];
}