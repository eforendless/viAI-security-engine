import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
const { assessmentHistoryFilters, dashboardVerdictPresentation, getAssessmentHistoryCategory, presentAssessment, presentAssessmentVerdict } = await vite.ssrLoadModule("/src/assessmentPresentation.ts");
await vite.close();

const canonical = (verdict, priority, recommendation, escalation = false) => presentAssessment({ assessment: { schemaVersion: "0.3", verdict, investigationPriority: priority, recommendation, suspicion: { score: 5, level: "low" }, trust: { score: 70, level: "high" }, confidence: { score: 90, level: "high" }, ...(escalation ? { escalation: { requested: true } } : {}) } });

assert.deepEqual(assessmentHistoryFilters.map((filter) => filter.label), ["All assessments", "Needs investigation", "Monitoring", "No action needed"]);
assert.equal(assessmentHistoryFilters.some((filter) => filter.value === "legacy"), false);
assert.equal(getAssessmentHistoryCategory(canonical("SUSPICIOUS", "MEDIUM", "REVIEW")), "needs-investigation");
assert.equal(getAssessmentHistoryCategory(canonical("LIKELY_BENIGN", "LOW", "MONITOR")), "monitoring");
assert.equal(getAssessmentHistoryCategory(canonical("TRUSTED", "NONE", "ALLOW")), "no-action");
assert.equal(getAssessmentHistoryCategory(canonical("UNKNOWN", "NONE", "ALLOW", true)), "needs-investigation");

const legacy = presentAssessment({ riskScore: 99, recommendation: "REVIEW" });
assert.equal(getAssessmentHistoryCategory(legacy), "legacy");
assert.equal(getAssessmentHistoryCategory(presentAssessment({ riskScore: 99, assessment: { schemaVersion: "0.3", verdict: "LIKELY_BENIGN", investigationPriority: "NONE", recommendation: "ALLOW", suspicion: { score: 5, level: "low" }, trust: { score: 70, level: "high" }, confidence: { score: 90, level: "high" } } })), "no-action");
assert.equal(canonical("LIKELY_BENIGN", "NONE", "ALLOW").status.label, "Likely safe");
assert.notEqual(canonical("LIKELY_BENIGN", "NONE", "ALLOW").status.label, "LIKELY_BENIGN");
assert.equal(canonical("likely_benign", "none", "no_follow_up").status.label, "Likely safe");
assert.equal(canonical("likely_benign", "none", "no_follow_up").displayRecommendation.label, "No action needed");
assert.equal(presentAssessmentVerdict("needs_investigation").label, "Needs investigation");
assert.equal(presentAssessmentVerdict("likely_benign").label, "Likely safe");
assert.deepEqual(dashboardVerdictPresentation.map((item) => item.label), ["Likely safe", "Likely safe", "Needs investigation", "Threat detected", "More information needed"]);

console.log("assessment presentation history tests passed");