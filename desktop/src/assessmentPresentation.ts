export type AssessmentModel = "v0.3" | "legacy";
export type AssessmentTone = "safe" | "info" | "warning" | "danger" | "neutral";
export type AssessmentHistoryCategory = "needs-investigation" | "monitoring" | "no-action" | "legacy";
export type UserAssessmentHistoryFilter = "all" | Exclude<AssessmentHistoryCategory, "legacy">;
export const assessmentHistoryFilters: readonly { readonly value: UserAssessmentHistoryFilter; readonly label: string }[] = [
  { value: "all", label: "All assessments" },
  { value: "needs-investigation", label: "Needs investigation" },
  { value: "monitoring", label: "Monitoring" },
  { value: "no-action", label: "No action needed" },
];

export interface DisplayMetric {
  readonly label: string;
  readonly tone: AssessmentTone;
}

export interface ConsumerEvidence {
  readonly title: string;
  readonly detail: string;
}

export interface AssessmentPresentation {
  readonly model: AssessmentModel;
  readonly modelLabel: string;
  readonly verdict: string;
  readonly status: DisplayMetric;
  readonly displayRecommendation: DisplayMetric;
  readonly displaySuspicion: DisplayMetric;
  readonly displayConfidence: DisplayMetric;
  readonly displayTrust: DisplayMetric;
  readonly displayPriority: DisplayMetric;
  readonly shortExplanation: string;
  readonly consumerEvidence: readonly ConsumerEvidence[];
  readonly requiresEscalation: boolean;
  readonly suspicion: { readonly score: number | undefined; readonly level: string };
  readonly trust: { readonly score: number | undefined; readonly level: string };
  readonly confidence: { readonly score: number | undefined; readonly level: string };
  readonly priority: string;
  readonly recommendation: string;
  readonly baselineState: string;
  readonly importantEvidence: readonly string[];
  readonly trustEvidence: readonly string[];
  readonly warnings: readonly string[];
  readonly versions: { readonly engine: string; readonly ruleSet: string; readonly trustPolicy: string; readonly assessmentSchema: string };
  readonly details: readonly [string, string][];
}

export function presentAssessment(record: unknown, engineVersionFallback = "Not recorded"): AssessmentPresentation {
  const history = object(record);
  const analysis = object(history.report);
  const professional = object(analysis.report);
  const assessment = object(professional.assessment);
  const summaryAssessment = object(history.assessment);
  const canonicalAssessment = assessment.schemaVersion === "0.3" ? assessment : summaryAssessment;
  const metadata = object(analysis.metadata);
  const analysisMetadata = object(professional.analysisMetadata);
  const canonical = canonicalAssessment.schemaVersion === "0.3" && typeof canonicalAssessment.verdict === "string";
  const legacyRisk = number(professional.riskScore, number(object(professional.risk).score, number(analysis.finalRiskScore, number(history.riskScore, undefined))));
  const assessmentTrust = object(canonicalAssessment.trust);
  const assessmentSuspicion = object(canonicalAssessment.suspicion);
  const assessmentConfidence = object(canonicalAssessment.confidence);
  const professionalTrust = object(professional.trust);
  const professionalConfidence = object(professional.confidence);
  const baseline = object(professional.baseline);
  const engine = string(analysisMetadata.engineVersion) ?? string(history.engineVersion) ?? engineVersionFallback;
  const importantEvidence = strings(analysis.evidence).length ? strings(analysis.evidence) : strings(professional.indicators);
  const trustEvidence = arrayObjects(professionalTrust.indicators).map((indicator) => string(indicator.reason) ?? string(indicator.evidence)).filter((value): value is string => Boolean(value));
  const fileName = string(history.filePath)?.split(/[\\/]/).pop() ?? "viAI analysis report";
  const details: Array<[string, string]> = [
    ["File name", fileName],
    ["Full path", string(history.filePath) ?? "Not retained by this local record"],
    ["SHA-256", string(object(analysis.hashes).sha256) ?? string(history.fileHash) ?? "Not available"],
    ["Analysis timestamp", string(history.occurredAt) ?? string(analysis.analyzedAt) ?? "Not recorded"],
    ["File size", typeof metadata.size === "number" ? `${metadata.size} bytes` : "Not recorded"],
    ["File type", string(analysis.fileType) ?? "Not recorded"],
  ];

  if (canonical) {
    const verdict = string(canonicalAssessment.verdict) ?? "UNKNOWN";
    const recommendation = string(canonicalAssessment.recommendation) ?? "REVIEW";
    const suspicion = { score: number(assessmentSuspicion.score, undefined), level: string(assessmentSuspicion.level) ?? "unknown" };
    const trust = { score: number(assessmentTrust.score, undefined), level: string(assessmentTrust.level) ?? "unknown" };
    const confidence = { score: number(assessmentConfidence.score, undefined), level: string(assessmentConfidence.level) ?? "unknown" };
    const priority = string(canonicalAssessment.investigationPriority) ?? "NONE";
    return {
      model: "v0.3",
      modelLabel: "Assessment schema v0.3",
      verdict,
      status: displayStatus(verdict),
      displayRecommendation: displayRecommendation(recommendation),
      displaySuspicion: displaySuspicion(suspicion),
      displayConfidence: displayConfidence(confidence),
      displayTrust: displayTrust(trust),
      displayPriority: displayPriority(priority),
      shortExplanation: explanation(verdict, recommendation, importantEvidence),
      consumerEvidence: importantEvidence.map(presentEvidence),
      requiresEscalation: object(canonicalAssessment.escalation).requested === true,
      suspicion,
      trust,
      confidence,
      priority,
      recommendation,
      baselineState: string(baseline.state) ?? string(history.baselineState) ?? "Not recorded",
      importantEvidence,
      trustEvidence,
      warnings: strings(professional.warnings),
      versions: {
        engine,
        ruleSet: string(analysisMetadata.ruleSetVersion) ?? "Not recorded",
        trustPolicy: string(analysisMetadata.trustPolicyVersion) ?? "Not recorded",
        assessmentSchema: string(analysisMetadata.assessmentSchemaVersion) ?? "0.3",
      },
      details,
    };
  }

  return {
    model: "legacy",
    modelLabel: "Legacy v0.1/v0.2 score model",
    verdict: "LEGACY SCORE MODEL",
    status: { label: "Assessment unavailable", tone: "neutral" },
    displayRecommendation: { label: "Open details to review", tone: "neutral" },
    displaySuspicion: { label: "Legacy score", tone: "neutral" },
    displayConfidence: { label: "Not recorded", tone: "neutral" },
    displayTrust: { label: "Not recorded", tone: "neutral" },
    displayPriority: { label: "Not recorded", tone: "neutral" },
    shortExplanation: "This historical record uses the prior score model. Its original data is retained for review.",
    consumerEvidence: importantEvidence.map(presentEvidence),
    requiresEscalation: false,
    suspicion: { score: legacyRisk, level: legacyRisk === undefined ? "not recorded" : legacyRisk <= 25 ? "low" : legacyRisk <= 60 ? "medium" : "high" },
    trust: { score: number(professionalTrust.score, number(analysis.trustScore, number(history.trustScore, undefined))), level: string(professionalTrust.level) ?? "not recorded" },
    confidence: { score: number(professionalConfidence.score, number(analysis.confidence, undefined)), level: "not recorded" },
    priority: "Not available in legacy reports",
    recommendation: string(history.recommendation) ?? string(professional.recommendation) ?? string(analysis.recommendation) ?? "Not recorded",
    baselineState: "Not available in legacy reports",
    importantEvidence,
    trustEvidence,
    warnings: strings(professional.warnings),
    versions: { engine, ruleSet: "Not recorded", trustPolicy: "Not recorded", assessmentSchema: "Legacy" },
    details,
  };
}

export function getAssessmentHistoryCategory(presentation: AssessmentPresentation): AssessmentHistoryCategory {
  if (presentation.model !== "v0.3") return "legacy";
  const investigationRequired = presentation.requiresEscalation || ["MEDIUM", "HIGH", "URGENT"].includes(presentation.priority) || ["REVIEW", "DYNAMIC_ANALYSIS", "SANDBOX", "AI_ANALYSIS"].includes(presentation.recommendation) || ["SUSPICIOUS", "HIGHLY_SUSPICIOUS"].includes(presentation.verdict);
  if (investigationRequired) return "needs-investigation";
  if (presentation.recommendation === "MONITOR") return "monitoring";
  return "no-action";
}

function displayStatus(verdict: string): DisplayMetric {
  switch (verdict) {
    case "TRUSTED":
    case "LIKELY_BENIGN": return { label: "Likely safe", tone: "safe" };
    case "SUSPICIOUS": return { label: "Needs investigation", tone: "warning" };
    case "HIGHLY_SUSPICIOUS": return { label: "Threat detected", tone: "danger" };
    default: return { label: "More information needed", tone: "neutral" };
  }
}

function displayRecommendation(recommendation: string): DisplayMetric {
  switch (recommendation) {
    case "ALLOW": return { label: "No action required", tone: "safe" };
    case "MONITOR": return { label: "Continue monitoring", tone: "info" };
    case "DYNAMIC_ANALYSIS": return { label: "Deeper analysis recommended", tone: "info" };
    case "SANDBOX": return { label: "Behavior analysis recommended", tone: "warning" };
    case "AI_ANALYSIS": return { label: "Advanced analysis recommended", tone: "info" };
    case "REVIEW": return { label: "Review this file", tone: "warning" };
    default: return { label: "Recommendation unavailable", tone: "neutral" };
  }
}

function displaySuspicion(value: AssessmentPresentation["suspicion"]): DisplayMetric {
  const level = value.level.toLowerCase();
  return { label: level === "low" ? "Low" : level === "medium" ? "Moderate" : level === "high" ? "High" : "Unknown", tone: level === "high" ? "danger" : level === "medium" ? "warning" : level === "low" ? "safe" : "neutral" };
}

function displayConfidence(value: AssessmentPresentation["confidence"]): DisplayMetric {
  const level = value.level.toLowerCase();
  return { label: level === "high" ? "High" : level === "medium" ? "Moderate" : level === "low" ? "Limited" : "Not available", tone: level === "high" ? "safe" : level === "medium" ? "info" : "neutral" };
}

function displayTrust(value: AssessmentPresentation["trust"]): DisplayMetric {
  const level = value.level.toLowerCase();
  return { label: level === "not recorded" || level === "unknown" ? "Not available" : level.charAt(0).toUpperCase() + level.slice(1), tone: level === "trusted" || level === "high" ? "safe" : level === "limited" || level === "medium" ? "info" : "neutral" };
}

function displayPriority(priority: string): DisplayMetric {
  const normalized = priority.toLowerCase();
  return { label: normalized === "none" ? "No priority" : normalized.charAt(0).toUpperCase() + normalized.slice(1), tone: normalized === "urgent" || normalized === "high" ? "danger" : normalized === "medium" ? "warning" : normalized === "low" ? "info" : "neutral" };
}

function explanation(verdict: string, recommendation: string, evidence: readonly string[]): string {
  if (verdict === "TRUSTED" || verdict === "LIKELY_BENIGN") return recommendation === "MONITOR" ? "viAI found only minor static indicators. Continued monitoring is recommended." : "viAI found no significant static indicators requiring immediate action.";
  if (verdict === "SUSPICIOUS") return "viAI found static indicators that deserve a closer review before this file is trusted.";
  if (verdict === "HIGHLY_SUSPICIOUS") return "viAI found static indicators that require prompt investigation.";
  return evidence.length ? "viAI retained the available static evidence for further review." : "viAI did not retain enough static evidence for a clear conclusion.";
}

function presentEvidence(value: string): ConsumerEvidence {
  if (/entropy/i.test(value)) return { title: "High entropy detected", detail: "This file contains compressed or high-entropy data. This is common in packaged software and does not by itself indicate malicious behavior." };
  return { title: value.replace(/([a-z])([A-Z])/g, "$1 $2"), detail: "Supporting static evidence retained by viAI." };
}

function legacyExportHtml(presentation: AssessmentPresentation): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>viAI assessment report</title><style>body{font-family:"Segoe UI",sans-serif;color:#13263a;margin:36px;line-height:1.45}h1{margin-bottom:4px}h2{font-size:16px;border-bottom:1px solid #cbd8e2;padding-bottom:6px}.model{color:#52657a}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{border:1px solid #cbd8e2;padding:12px}.metric small{display:block;color:#52657a}.metric strong{display:block;font-size:18px}ul{padding-left:20px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dbe5ec;padding:8px;text-align:left;vertical-align:top}th{width:32%;color:#52657a}@media print{body{margin:18px}}</style></head><body><h1>viAI Static Assessment Report</h1><p class="model">${escapeHtml(presentation.modelLabel)}</p><h2>${escapeHtml(presentation.verdict)}</h2><section class="metrics"><div class="metric"><small>Suspicion</small><strong>${metric(presentation.suspicion)}</strong></div><div class="metric"><small>Trust</small><strong>${metric(presentation.trust)}</strong></div><div class="metric"><small>Evidence confidence</small><strong>${metric(presentation.confidence)}</strong></div><div class="metric"><small>Investigation priority</small><strong>${escapeHtml(presentation.priority)}</strong></div><div class="metric"><small>Recommendation</small><strong>${escapeHtml(presentation.recommendation)}</strong></div><div class="metric"><small>Baseline/change state</small><strong>${escapeHtml(presentation.baselineState)}</strong></div></section>${section("Important evidence", presentation.importantEvidence)}${section("Trust evidence", presentation.trustEvidence)}${section("Evidence and parser warnings", presentation.warnings)}<h2>Version information</h2><table>${rows([["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema]])}</table><h2>File details</h2><table>${rows(presentation.details)}</table></body></html>`;
}

function legacyExportExcel(presentation: AssessmentPresentation): string {
  const row = (values: readonly string[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`;
  const sheet = (name: string, values: readonly [string, string][]) => `<Worksheet ss:Name="${escapeXml(name)}"><Table>${values.map(([label, value]) => row([label, value])).join("")}</Table></Worksheet>`;
  const assessment: Array<[string, string]> = [["Assessment model", presentation.modelLabel], ["Static verdict", presentation.verdict], ["Suspicion", metric(presentation.suspicion)], ["Trust", metric(presentation.trust)], ["Evidence confidence", metric(presentation.confidence)], ["Investigation priority", presentation.priority], ["Recommendation", presentation.recommendation], ["Baseline/change state", presentation.baselineState], ["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema]];
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet("Assessment", assessment)}${sheet("Important evidence", listRows(presentation.importantEvidence))}${sheet("Trust evidence", listRows(presentation.trustEvidence))}${sheet("Warnings", listRows(presentation.warnings))}${sheet("File details", presentation.details)}</Workbook>`;
}

function legacyExportPdf(presentation: AssessmentPresentation): string {
  const lines = ["viAI STATIC ASSESSMENT REPORT", presentation.modelLabel, `Verdict: ${presentation.verdict}`, `Suspicion: ${metric(presentation.suspicion)}`, `Trust: ${metric(presentation.trust)}`, `Evidence confidence: ${metric(presentation.confidence)}`, `Investigation priority: ${presentation.priority}`, `Recommendation: ${presentation.recommendation}`, `Baseline/change state: ${presentation.baselineState}`, `Engine version: ${presentation.versions.engine}`, `Rule-set version: ${presentation.versions.ruleSet}`, `Trust-policy version: ${presentation.versions.trustPolicy}`, `Assessment schema version: ${presentation.versions.assessmentSchema}`, "Important evidence:", ...presentation.importantEvidence, "Trust evidence:", ...presentation.trustEvidence, "Warnings:", ...presentation.warnings, "File details:", ...presentation.details.map(([label, value]) => `${label}: ${value}`)].flatMap((line) => wrap(line, 84));
  let y = 790;
  let content = "";
  for (const line of lines) { content += `BT\n/F1 9 Tf\n48 ${y} Td\n(${escapePdf(line)}) Tj\nET\n`; y -= 13; }
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF`;
}

export function exportJson(presentation: AssessmentPresentation): string { return JSON.stringify({ assessment: presentation }, null, 2); }

void legacyExportHtml;
void legacyExportExcel;
void legacyExportPdf;

export function exportHtml(presentation: AssessmentPresentation): string {
  const assessment = [["Status", presentation.status.label], ["Recommended action", presentation.displayRecommendation.label], ["Suspicion", displayMetric(presentation.displaySuspicion, presentation.suspicion.score)], ["Trust evidence", displayMetric(presentation.displayTrust, presentation.trust.score)], ["Evidence confidence", displayMetric(presentation.displayConfidence, presentation.confidence.score)], ["Investigation priority", presentation.displayPriority.label]] as const;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>viAI Security Analysis Report</title><style>${reportStyles}</style></head><body><main><header><div class="brand"><b>viAI</b><span>SECURITY</span></div><p>LOCAL SECURITY ANALYSIS REPORT</p><h1>${escapeHtml(detailValue(presentation, "File name"))}</h1><span>${escapeHtml(detailValue(presentation, "Full path"))}</span></header><section class="status ${presentation.status.tone}"><small>STATUS</small><strong>${escapeHtml(presentation.status.label)}</strong><p>${escapeHtml(presentation.shortExplanation)}</p><b>${escapeHtml(presentation.displayRecommendation.label)}</b></section><h2>Assessment</h2><section class="metrics">${assessment.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</section>${htmlEvidenceSection("Why this result", presentation.consumerEvidence.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></li>`).join(""), "No notable static evidence was retained.")}${htmlEvidenceSection("Technical evidence", listItems(presentation.importantEvidence), "No technical evidence was retained.")}${htmlEvidenceSection("Trust indicators", listItems(presentation.trustEvidence), "No trust indicators were retained.")}<h2>File information</h2><table>${rows(presentation.details)}</table><h2>Engine information</h2><table>${rows([["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema], ["Assessment model", presentation.modelLabel]])}</table><footer>Generated locally by viAI Security. Static analysis does not determine intent.</footer></main></body></html>`;
}

export function exportExcel(presentation: AssessmentPresentation): string {
  const row = (values: readonly string[], style = "") => `<Row${style ? ` ss:StyleID="${style}"` : ""}>${values.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`;
  const sheet = (name: string, values: readonly [string, string][], title?: string) => `<Worksheet ss:Name="${escapeXml(name)}"><Table><Column ss:Width="175"/><Column ss:Width="420"/>${title ? row([title, ""], "title") : ""}${row(["Field", "Value"], "header")}${values.map(([label, value]) => row([label, value])).join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>2</SplitHorizontal><TopRowBottomPane>2</TopRowBottomPane></WorksheetOptions></Worksheet>`;
  const summary: Array<[string, string]> = [["File", detailValue(presentation, "File name")], ["Status", presentation.status.label], ["Recommendation", presentation.displayRecommendation.label], ["Suspicion", displayMetric(presentation.displaySuspicion, presentation.suspicion.score)], ["Trust evidence", displayMetric(presentation.displayTrust, presentation.trust.score)], ["Confidence", displayMetric(presentation.displayConfidence, presentation.confidence.score)], ["Investigation priority", presentation.displayPriority.label], ["Analysis date", detailValue(presentation, "Analysis timestamp")]];
  const assessment: Array<[string, string]> = [["Assessment model", presentation.modelLabel], ["Canonical verdict", presentation.verdict], ["Suspicion", metric(presentation.suspicion)], ["Trust", metric(presentation.trust)], ["Evidence confidence", metric(presentation.confidence)], ["Investigation priority", presentation.priority], ["Recommendation", presentation.recommendation], ["Baseline/change state", presentation.baselineState]];
  const sheets = [sheet("Summary", summary, "viAI Security Analysis Report"), sheet("Assessment", assessment), sheet("File Metadata", presentation.details), sheet("Technical Information", [["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema]])];
  if (presentation.importantEvidence.length) sheets.push(sheet("Evidence", listRows(presentation.importantEvidence)));
  if (presentation.trustEvidence.length) sheets.push(sheet("Trust Indicators", listRows(presentation.trustEvidence)));
  if (presentation.warnings.length) sheets.push(sheet("Warnings", listRows(presentation.warnings)));
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="title"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="14"/><Interior ss:Color="#102846" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2777AE" ss:Pattern="Solid"/></Style></Styles>${sheets.join("")}</Workbook>`;
}

export function exportPdf(presentation: AssessmentPresentation): string {
  const lines = ["viAI SECURITY", "LOCAL SECURITY ANALYSIS REPORT", detailValue(presentation, "File name"), `Status: ${presentation.status.label}`, `Recommended action: ${presentation.displayRecommendation.label}`, presentation.shortExplanation, "ASSESSMENT", `Suspicion: ${displayMetric(presentation.displaySuspicion, presentation.suspicion.score)}`, `Trust evidence: ${displayMetric(presentation.displayTrust, presentation.trust.score)}`, `Evidence confidence: ${displayMetric(presentation.displayConfidence, presentation.confidence.score)}`, `Investigation priority: ${presentation.displayPriority.label}`, "WHY THIS RESULT", ...presentation.consumerEvidence.flatMap((item) => [item.title, item.detail]), "TECHNICAL EVIDENCE", ...presentation.importantEvidence, "FILE INFORMATION", ...presentation.details.map(([label, value]) => `${label}: ${value}`), "ENGINE INFORMATION", `Engine version: ${presentation.versions.engine}`, `Rule-set version: ${presentation.versions.ruleSet}`, `Trust-policy version: ${presentation.versions.trustPolicy}`, `Assessment schema version: ${presentation.versions.assessmentSchema}`, "Generated locally by viAI Security. Static analysis does not determine intent."].flatMap((line) => wrap(line, 82));
  return pdfDocument(lines);
}

const reportStyles = `:root{font-family:"Segoe UI",Aptos,sans-serif;color:#17304f;background:#edf5fb}*{box-sizing:border-box}body{margin:0;padding:32px;background:#edf5fb}main{max-width:920px;margin:auto;background:#fff;border:1px solid #d5e4f0;border-radius:10px;overflow:hidden;box-shadow:0 18px 45px #17304f1f}header{padding:34px 40px;background:#102846;color:#f8fcff}.brand{display:flex;gap:8px;align-items:baseline;color:#7ed6e5}.brand b{font-size:24px}.brand span,header>p{font-size:11px;font-weight:700;letter-spacing:1.4px}header>p{margin:24px 0 6px;color:#9fc9df}h1{margin:0;font-size:27px;overflow-wrap:anywhere}header>span{display:block;margin-top:8px;color:#c7ddec;font-size:13px;overflow-wrap:anywhere}.status{margin:26px 40px;padding:20px;border-left:4px solid #6f8197;background:#f6f9fc}.status small,.metrics small{display:block;color:#607692;font-size:11px;font-weight:700;letter-spacing:.7px}.status strong{display:block;margin:5px 0;font-size:22px}.status p{margin:4px 0 10px;line-height:1.5}.status.safe{border-color:#3a9464;background:#effaf4}.status.warning{border-color:#cf942c;background:#fff8e9}.status.danger{border-color:#c9505a;background:#fff2f3}.status.info{border-color:#3986c9;background:#eef7ff}h2{margin:28px 40px 12px;color:#193b62;font-size:16px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 40px}.metrics div{min-height:82px;padding:13px;border:1px solid #dbe7f1;border-radius:7px;background:#fbfdff}.metrics strong{display:block;margin-top:6px;color:#204d77;font-size:15px}ul{margin:0 40px;padding:0;list-style:none}li{padding:12px 0;border-top:1px solid #e4edf5;overflow-wrap:anywhere}li strong,li span{display:block}li span{margin-top:4px;color:#61758e;font-size:13px;line-height:1.45}table{width:calc(100% - 80px);margin:0 40px;border-collapse:collapse}th,td{padding:10px;border-top:1px solid #e4edf5;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{width:30%;color:#55708e;font-size:12px}footer{margin-top:34px;padding:18px 40px;background:#f1f7fb;color:#627995;font-size:12px}@media(max-width:650px){body{padding:0}main{border:0;border-radius:0}.metrics{grid-template-columns:1fr;padding:0 22px}header,.status,h2,ul,table{margin-left:22px;margin-right:22px}header{padding:28px 22px}table{width:calc(100% - 44px)}footer{padding:18px 22px}}@media print{body{padding:0;background:#fff}main{max-width:none;border:0;box-shadow:none}.status,.metrics div{break-inside:avoid}}`;
function htmlEvidenceSection(title: string, values: string, empty: string): string { return `<h2>${escapeHtml(title)}</h2><ul>${values || `<li>${escapeHtml(empty)}</li>`}</ul>`; }
function listItems(values: readonly string[]): string { return values.map((value) => `<li>${escapeHtml(value)}</li>`).join(""); }
function displayMetric(value: DisplayMetric, score: number | undefined): string { return score === undefined ? value.label : `${value.label} (${score}/100)`; }
function detailValue(presentation: AssessmentPresentation, label: string): string { return presentation.details.find(([name]) => name === label)?.[1] ?? "Not recorded"; }
function pdfDocument(lines: readonly string[]): string {
  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 43)) }, (_, index) => lines.slice(index * 43, (index + 1) * 43));
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, index) => `${index * 2 + 5} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];
  pages.forEach((page, index) => {
    const header = "0.063 0.157 0.275 rg\n0 780 612 62 re f\n1 1 1 rg\nBT /F2 16 Tf 42 816 Td (viAI SECURITY) Tj ET\nBT /F1 8 Tf 42 800 Td (LOCAL SECURITY ANALYSIS REPORT) Tj ET\n0.09 0.19 0.31 rg\n";
    const body = page.map((line, lineIndex) => `BT /${line === line.toUpperCase() && line.length < 34 ? "F2" : "F1"} ${line === line.toUpperCase() && line.length < 34 ? 10 : 9} Tf 42 ${758 - lineIndex * 16} Td (${escapePdf(line)}) Tj ET`).join("\n");
    const footer = `\nBT /F1 8 Tf 42 24 Td (Generated locally by viAI Security - Page ${index + 1} of ${pages.length}) Tj ET`;
    const stream = `${header}${body}${footer}\n`;
    const pageObject = index * 2 + 5;
    const contentObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function arrayObjects(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown, fallback: number | undefined): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function metric(value: { readonly score: number | undefined; readonly level: string }): string { return value.score === undefined ? value.level : `${value.score}/100 (${value.level})`; }
function section(title: string, values: readonly string[]): string { return `<h2>${escapeHtml(title)}</h2>${values.length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "<p>Not recorded.</p>"}`; }
function rows(values: readonly [string, string][]): string { return values.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join(""); }
function listRows(values: readonly string[]): Array<[string, string]> { return values.length ? values.map((value, index) => [`Item ${index + 1}`, value]) : [["Status", "Not recorded"]]; }
function wrap(value: string, width: number): string[] { const words = value.replace(/[^\x20-\x7E]/g, "?").split(/\s+/); const lines: string[] = []; let line = ""; for (const word of words) { if (`${line} ${word}`.trim().length > width && line) { lines.push(line); line = word; } else line = `${line} ${word}`.trim(); } return line ? [...lines, line] : lines; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
function escapeXml(value: string): string { return escapeHtml(value); }
function escapePdf(value: string): string { return value.replace(/[^\x20-\x7E]/g, "?").replace(/[\\()]/g, "\\$&"); }