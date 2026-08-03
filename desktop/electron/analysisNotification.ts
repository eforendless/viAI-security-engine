export interface AnalysisNotification {
  readonly setting: "notifyHighRisk" | "notifyMediumRisk" | "notifySafeScan";
  readonly title: string;
  readonly body: string;
}

export function notificationForAnalysis(value: unknown): AnalysisNotification {
  const body = object(value);
  const nested = object(body.analysis);
  const assessment = assessmentFrom(body.assessment) ?? assessmentFrom(object(nested.report).assessment);
  if (assessment) {
    const high = ["HIGH", "URGENT"].includes(assessment.investigationPriority);
    const review = high || assessment.investigationPriority === "MEDIUM" || ["REVIEW", "DYNAMIC_ANALYSIS"].includes(assessment.recommendation);
    return high ? { setting: "notifyHighRisk", title: "viAI assessment needs investigation", body: assessmentText(assessment) }
      : review ? { setting: "notifyMediumRisk", title: "viAI assessment review", body: assessmentText(assessment) }
        : { setting: "notifySafeScan", title: "viAI scan complete", body: assessmentText(assessment) };
  }
  const riskScore = typeof body.riskScore === "number" ? body.riskScore : 0;
  const setting = riskScore >= 61 ? "notifyHighRisk" : riskScore >= 26 ? "notifyMediumRisk" : "notifySafeScan";
  return { setting, title: riskScore >= 61 ? "viAI legacy score alert" : "viAI scan complete", body: `Legacy score model: local static analysis returned risk score ${riskScore}.` };
}

interface Assessment { investigationPriority: string; recommendation: string; verdict: string; }
function assessmentFrom(value: unknown): Assessment | undefined { const assessment = object(value); return assessment.schemaVersion === "0.3" && typeof assessment.investigationPriority === "string" && typeof assessment.recommendation === "string" && typeof assessment.verdict === "string" ? { investigationPriority: assessment.investigationPriority, recommendation: assessment.recommendation, verdict: assessment.verdict } : undefined; }
function assessmentText(assessment: Assessment): string { return `Static verdict ${assessment.verdict}; ${assessment.investigationPriority} priority; recommendation ${assessment.recommendation}.`; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }