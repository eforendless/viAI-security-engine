import type { RuleResult, StaticAnalysisReport, Recommendation } from "./RuleResult.js";

const recommendationOrder: Readonly<Record<Recommendation, number>> = { ALLOW: 0, MONITOR: 1, SANDBOX: 2, AI_ANALYSIS: 3 };

export class RiskAggregator {
  aggregate(fileHash: string, results: readonly RuleResult[], metadata: unknown): StaticAnalysisReport {
    const riskScore = Math.round(clamp(results.reduce((total, result) => total + result.score, 0), 0, 100));
    const explicit = results.reduce<Recommendation | undefined>((highest, result) => {
      if (!result.recommendation) return highest;
      return !highest || recommendationOrder[result.recommendation] > recommendationOrder[highest] ? result.recommendation : highest;
    }, undefined);
    return {
      fileHash,
      riskScore,
      recommendation: explicit ?? (riskScore <= 25 ? "ALLOW" : riskScore <= 60 ? "MONITOR" : "SANDBOX"),
      matchedRules: Object.freeze([...results]),
      indicators: Object.freeze([...new Set(results.map((result) => result.evidence))]),
      metadata,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }