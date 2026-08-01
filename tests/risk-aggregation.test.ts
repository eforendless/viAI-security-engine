import assert from "node:assert/strict";
import test from "node:test";
import { RiskAggregator, createTrustResult, type RuleResult } from "../packages/core/src/rules/index.js";

function rule(score: number, recommendation?: RuleResult["recommendation"]): RuleResult {
  return { id: `rule-${score}`, matched: true, score, severity: "high", evidence: `Risk evidence ${score}`, recommendation };
}

test("risk aggregation preserves separate risk and trust values while bounding trust influence", () => {
  const trust = createTrustResult([
    { id: "TRUSTED_HASH", weight: 25, evidence: "Known hash", source: "test" },
    { id: "VALID_SIGNATURE", weight: 20, evidence: "Valid signature", source: "test" },
    { id: "PROGRAM_FILES", weight: 8, evidence: "Program Files", source: "test" },
  ]);
  const report = new RiskAggregator().aggregate("hash", [rule(45), rule(45)], {}, trust);
  assert.equal(report.riskScore, 90);
  assert.equal(report.trustScore, 53);
  assert.ok(report.overallScore >= 70);
  assert.equal(report.recommendation, "SANDBOX");
  assert.equal(report.trustIndicators, trust.indicators);
});

test("explicit suspicious-rule escalation takes precedence over trust", () => {
  const trust = createTrustResult([{ id: "TRUSTED_HASH", weight: 100, evidence: "Known hash", source: "test" }]);
  const report = new RiskAggregator().aggregate("hash", [rule(10, "AI_ANALYSIS")], {}, trust);
  assert.equal(report.recommendation, "AI_ANALYSIS");
});

test("an allow recommendation cannot lower a high-risk decision", () => {
  const trust = createTrustResult([{ id: "TRUSTED_HASH", weight: 100, evidence: "Known hash", source: "test" }]);
  const report = new RiskAggregator().aggregate("hash", [rule(80, "ALLOW")], {}, trust);
  assert.equal(report.recommendation, "SANDBOX");
});