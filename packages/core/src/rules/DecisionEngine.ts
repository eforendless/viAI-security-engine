import type { Recommendation, RuleResult } from "./RuleResult.js";

export interface DecisionInput {
  readonly riskScore: number;
  readonly trustScore: number;
  readonly overallScore: number;
  readonly confidence: number;
  readonly matchedRules: readonly RuleResult[];
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

const recommendationOrder: Readonly<Record<Recommendation, number>> = { ALLOW: 0, MONITOR: 1, SANDBOX: 2, AI_ANALYSIS: 3 };

export class DecisionEngine {
  constructor(private readonly policy: DecisionPolicy = defaultPolicy) {}

  decide(input: DecisionInput): Recommendation {
    const explicit = input.matchedRules.reduce<Recommendation | undefined>((highest, result) => {
      if (!result.recommendation) return highest;
      return !highest || recommendationOrder[result.recommendation] > recommendationOrder[highest] ? result.recommendation : highest;
    }, undefined);
    const baseline = input.riskScore > this.policy.monitorRiskMaximum
      ? "SANDBOX"
      : input.riskScore <= this.policy.allowRiskMaximum
        ? "ALLOW"
        : input.riskScore <= this.policy.trustedLowRiskMaximum && input.trustScore >= this.policy.minimumTrustForTrustedLowRisk
          ? "ALLOW"
          : "MONITOR";
    return explicit && recommendationOrder[explicit] > recommendationOrder[baseline] ? explicit : baseline;
  }
}