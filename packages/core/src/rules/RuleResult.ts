import type { TrustIndicator } from "../trust/TrustIndicator.js";

export type Recommendation = "ALLOW" | "MONITOR" | "SANDBOX" | "AI_ANALYSIS";
export type RuleSeverity = "low" | "medium" | "high";

export interface RuleResult {
  readonly id: string;
  readonly matched: boolean;
  readonly score: number;
  readonly severity: RuleSeverity;
  readonly evidence: string;
  readonly recommendation?: Recommendation;
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
}