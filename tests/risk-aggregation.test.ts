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
  assert.equal(report.recommendation, "DYNAMIC_ANALYSIS");
  assert.equal(report.trustIndicators, trust.indicators);
});

test("explicit suspicious-rule escalation takes precedence over trust", () => {
  const trust = createTrustResult([{ id: "TRUSTED_HASH", weight: 100, evidence: "Known hash", source: "test" }]);
  const report = new RiskAggregator().aggregate("hash", [rule(10, "AI_ANALYSIS")], {}, trust);
  assert.equal(report.recommendation, "DYNAMIC_ANALYSIS");
});

test("an allow recommendation cannot lower a high-risk decision", () => {
  const trust = createTrustResult([{ id: "TRUSTED_HASH", weight: 100, evidence: "Known hash", source: "test" }]);
  const report = new RiskAggregator().aggregate("hash", [rule(80, "ALLOW")], {}, trust);
  assert.equal(report.recommendation, "DYNAMIC_ANALYSIS");
});

test("correlation suppresses duplicate related evidence without suppressing independent evidence", () => {
  const report = new RiskAggregator().aggregate("hash", [
    { id: "high-entropy", matched: true, score: 25, severity: "medium", evidence: "High entropy", category: "entropy", strength: "weak", correlationGroup: "packing-indicators" },
    { id: "packer-marker", matched: true, score: 20, severity: "medium", evidence: "Packer marker", category: "packing", strength: "weak", correlationGroup: "packing-indicators" },
    { id: "reputation", matched: true, score: 30, severity: "medium", evidence: "Suspicious reputation", category: "reputation", strength: "moderate" },
  ], {}, createTrustResult([]));
  assert.equal(report.riskScore, 45);
  assert.deepEqual(report.correlations.find((entry) => entry.group === "packing-indicators"), { group: "packing-indicators", appliedScore: 25, suppressedScore: 20 });
});

test("weak-only evidence cannot produce a highly suspicious verdict", () => {
  const results: RuleResult[] = Array.from({ length: 8 }, (_, index) => ({ id: `weak-${index}`, matched: true, score: 15, severity: "low", evidence: `Weak evidence ${index}`, category: index % 2 === 0 ? "entropy" : "packing", strength: "weak" }));
  const report = new RiskAggregator().aggregate("hash", results, {}, createTrustResult([]));
  assert.equal(report.assessment.verdict, "UNKNOWN");
  assert.equal(report.recommendation, "MONITOR");
});

test("evidence quality reduces confidence independently from suspicion", () => {
  const report = new RiskAggregator().aggregate("hash", [rule(80)], {}, createTrustResult([]), { collectorFailures: 1, peParseStatus: "partial", snapshotTruncated: true, signatureState: "verification-unavailable", baselineState: "new" });
  assert.equal(report.assessment.suspicion.level, "high");
  assert.equal(report.assessment.verdict, "HIGHLY_SUSPICIOUS");
  assert.equal(report.assessment.confidence.score, 35);
  assert.equal(report.assessment.confidence.level, "low");
  assert.deepEqual(report.assessment.confidence.factors.map((factor) => factor.source), ["COLLECTORS", "PE_PARSE", "SNAPSHOT", "SIGNATURE", "BASELINE"]);
});