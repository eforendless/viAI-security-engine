export interface AnalysisNotification {
  readonly setting: "notifyHighRisk" | "notifyMediumRisk" | "notifySafeScan";
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
}

export function notificationForAnalysis(value: unknown): AnalysisNotification {
  const body = object(value);
  const nested = object(body.analysis);
  const assessment = assessmentFrom(body.assessment) ?? assessmentFrom(object(nested.report).assessment);
  const fileName = displayName(nested.filePath ?? body.filePath);
  const identity = typeof nested.hashes === "object" && nested.hashes && typeof (nested.hashes as { sha256?: unknown }).sha256 === "string" ? (nested.hashes as { sha256: string }).sha256 : fileName;
  if (assessment) {
    const high = ["HIGH", "URGENT"].includes(assessment.investigationPriority);
    const review = high || assessment.investigationPriority === "MEDIUM" || ["REVIEW", "DYNAMIC_ANALYSIS"].includes(assessment.recommendation);
    return high ? { setting: "notifyHighRisk", title: "viAI Security", body: `${fileName} needs your attention. Further analysis is recommended.`, dedupeKey: `assessment:${identity}` }
      : review ? { setting: "notifyMediumRisk", title: "viAI Security", body: `${fileName} needs investigation. Further analysis is recommended.`, dedupeKey: `assessment:${identity}` }
        : { setting: "notifySafeScan", title: "viAI Security", body: `${fileName} was analyzed locally.`, dedupeKey: `assessment:${identity}` };
  }
  const riskScore = typeof body.riskScore === "number" ? body.riskScore : 0;
  const setting = riskScore >= 61 ? "notifyHighRisk" : riskScore >= 26 ? "notifyMediumRisk" : "notifySafeScan";
  return { setting, title: "viAI Security", body: riskScore >= 61 ? `${fileName} needs your attention.` : `${fileName} was analyzed locally.`, dedupeKey: `assessment:${identity}` };
}

interface Assessment { investigationPriority: string; recommendation: string; verdict: string; }
function assessmentFrom(value: unknown): Assessment | undefined { const assessment = object(value); return assessment.schemaVersion === "0.3" && typeof assessment.investigationPriority === "string" && typeof assessment.recommendation === "string" && typeof assessment.verdict === "string" ? { investigationPriority: assessment.investigationPriority, recommendation: assessment.recommendation, verdict: assessment.verdict } : undefined; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function displayName(value: unknown): string { return typeof value === "string" && value.length > 0 ? value.replaceAll("/", "\\").split("\\").filter(Boolean).at(-1) ?? "This file" : "This file"; }