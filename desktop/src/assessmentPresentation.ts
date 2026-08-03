export type AssessmentModel = "v0.3" | "legacy";

export interface AssessmentPresentation {
  readonly model: AssessmentModel;
  readonly modelLabel: string;
  readonly verdict: string;
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
    return {
      model: "v0.3",
      modelLabel: "Assessment schema v0.3",
      verdict: string(canonicalAssessment.verdict) ?? "UNKNOWN",
      suspicion: { score: number(assessmentSuspicion.score, undefined), level: string(assessmentSuspicion.level) ?? "unknown" },
      trust: { score: number(assessmentTrust.score, undefined), level: string(assessmentTrust.level) ?? "unknown" },
      confidence: { score: number(assessmentConfidence.score, undefined), level: string(assessmentConfidence.level) ?? "unknown" },
      priority: string(canonicalAssessment.investigationPriority) ?? "NONE",
      recommendation: string(canonicalAssessment.recommendation) ?? "REVIEW",
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

export function exportHtml(presentation: AssessmentPresentation): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>viAI assessment report</title><style>body{font-family:"Segoe UI",sans-serif;color:#13263a;margin:36px;line-height:1.45}h1{margin-bottom:4px}h2{font-size:16px;border-bottom:1px solid #cbd8e2;padding-bottom:6px}.model{color:#52657a}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.metric{border:1px solid #cbd8e2;padding:12px}.metric small{display:block;color:#52657a}.metric strong{display:block;font-size:18px}ul{padding-left:20px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #dbe5ec;padding:8px;text-align:left;vertical-align:top}th{width:32%;color:#52657a}@media print{body{margin:18px}}</style></head><body><h1>viAI Static Assessment Report</h1><p class="model">${escapeHtml(presentation.modelLabel)}</p><h2>${escapeHtml(presentation.verdict)}</h2><section class="metrics"><div class="metric"><small>Suspicion</small><strong>${metric(presentation.suspicion)}</strong></div><div class="metric"><small>Trust</small><strong>${metric(presentation.trust)}</strong></div><div class="metric"><small>Evidence confidence</small><strong>${metric(presentation.confidence)}</strong></div><div class="metric"><small>Investigation priority</small><strong>${escapeHtml(presentation.priority)}</strong></div><div class="metric"><small>Recommendation</small><strong>${escapeHtml(presentation.recommendation)}</strong></div><div class="metric"><small>Baseline/change state</small><strong>${escapeHtml(presentation.baselineState)}</strong></div></section>${section("Important evidence", presentation.importantEvidence)}${section("Trust evidence", presentation.trustEvidence)}${section("Evidence and parser warnings", presentation.warnings)}<h2>Version information</h2><table>${rows([["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema]])}</table><h2>File details</h2><table>${rows(presentation.details)}</table></body></html>`;
}

export function exportExcel(presentation: AssessmentPresentation): string {
  const row = (values: readonly string[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`).join("")}</Row>`;
  const sheet = (name: string, values: readonly [string, string][]) => `<Worksheet ss:Name="${escapeXml(name)}"><Table>${values.map(([label, value]) => row([label, value])).join("")}</Table></Worksheet>`;
  const assessment: Array<[string, string]> = [["Assessment model", presentation.modelLabel], ["Static verdict", presentation.verdict], ["Suspicion", metric(presentation.suspicion)], ["Trust", metric(presentation.trust)], ["Evidence confidence", metric(presentation.confidence)], ["Investigation priority", presentation.priority], ["Recommendation", presentation.recommendation], ["Baseline/change state", presentation.baselineState], ["Engine version", presentation.versions.engine], ["Rule-set version", presentation.versions.ruleSet], ["Trust-policy version", presentation.versions.trustPolicy], ["Assessment schema version", presentation.versions.assessmentSchema]];
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet("Assessment", assessment)}${sheet("Important evidence", listRows(presentation.importantEvidence))}${sheet("Trust evidence", listRows(presentation.trustEvidence))}${sheet("Warnings", listRows(presentation.warnings))}${sheet("File details", presentation.details)}</Workbook>`;
}

export function exportPdf(presentation: AssessmentPresentation): string {
  const lines = ["viAI STATIC ASSESSMENT REPORT", presentation.modelLabel, `Verdict: ${presentation.verdict}`, `Suspicion: ${metric(presentation.suspicion)}`, `Trust: ${metric(presentation.trust)}`, `Evidence confidence: ${metric(presentation.confidence)}`, `Investigation priority: ${presentation.priority}`, `Recommendation: ${presentation.recommendation}`, `Baseline/change state: ${presentation.baselineState}`, `Engine version: ${presentation.versions.engine}`, `Rule-set version: ${presentation.versions.ruleSet}`, `Trust-policy version: ${presentation.versions.trustPolicy}`, `Assessment schema version: ${presentation.versions.assessmentSchema}`, "Important evidence:", ...presentation.importantEvidence, "Trust evidence:", ...presentation.trustEvidence, "Warnings:", ...presentation.warnings, "File details:", ...presentation.details.map(([label, value]) => `${label}: ${value}`)].flatMap((line) => wrap(line, 84));
  let y = 790;
  let content = "";
  for (const line of lines) { content += `BT\n/F1 9 Tf\n48 ${y} Td\n(${escapePdf(line)}) Tj\nET\n`; y -= 13; }
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF`;
}

export function exportJson(presentation: AssessmentPresentation): string { return JSON.stringify({ assessment: presentation }, null, 2); }

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