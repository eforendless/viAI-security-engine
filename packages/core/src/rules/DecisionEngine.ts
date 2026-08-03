import type { Recommendation, RuleResult } from "./RuleResult.js";

export interface DecisionInput {
  readonly riskScore: number;
  readonly trustScore: number;
  readonly overallScore: number;
  readonly confidence: number;
  readonly matchedRules: readonly RuleResult[];
  readonly hasStrongEvidence?: boolean;
  readonly hasMeaningfulModerateEvidence?: boolean;
}

export interface DecisionPolicy {
  readonly allowRiskMaximum: number;
  readonly trustedLowRiskMaximum: number;
  readonly minimumTrustForTrustedLowRisk: number;
  readonly monitorRiskMaximum: number;
}

const defaultPolicy: DecisionPolicy = {
  allowRiskMaximum: 15,
  trustedLowRiskMaximum: 25,
  minimumTrustForTrustedLowRisk: 20,
  monitorRiskMaximum: 60,
};

const recommendationOrder: Readonly<Record<Recommendation, number>> = { ALLOW: 0, MONITOR: 1, REVIEW: 2, DYNAMIC_ANALYSIS: 3, SANDBOX: 4, AI_ANALYSIS: 5 };

export class DecisionEngine {
  constructor(private readonly policy: DecisionPolicy = defaultPolicy) {}

  decide(input: DecisionInput): Recommendation {
    const explicit = input.matchedRules.reduce<Recommendation | undefined>((highest, result) => {
      if (!result.recommendation) return highest;
      const recommendation = normalizeRecommendation(result.recommendation);
      return !highest || recommendationOrder[recommendation] > recommendationOrder[highest] ? recommendation : highest;
    }, undefined);
    const meaningfulEvidence = input.hasStrongEvidence === true || input.hasMeaningfulModerateEvidence === true;
    const baseline = input.riskScore > this.policy.monitorRiskMaximum && meaningfulEvidence
      ? "DYNAMIC_ANALYSIS"
      : input.riskScore > this.policy.monitorRiskMaximum
        ? "REVIEW"
      : input.riskScore <= this.policy.allowRiskMaximum
        ? "ALLOW"
        : input.riskScore <= this.policy.trustedLowRiskMaximum && input.trustScore >= this.policy.minimumTrustForTrustedLowRisk
          ? "ALLOW"
          : input.confidence < 50 ? "REVIEW" : "MONITOR";
    return explicit && recommendationOrder[explicit] > recommendationOrder[baseline] ? explicit : baseline;
  }
}

function normalizeRecommendation(value: Recommendation): Recommendation { return value === "SANDBOX" || value === "AI_ANALYSIS" ? "DYNAMIC_ANALYSIS" : value; }