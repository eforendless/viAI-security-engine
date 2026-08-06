export type ScanReportStatus = "running" | "paused" | "completed" | "cancelled" | "failed";
export type ScanPerformanceMode = "light" | "balanced" | "deep";
export type ScanExportFormat = "html" | "json" | "pdf" | "excel";

export interface ScanReport {
  scanId: string;
  status: ScanReportStatus;
  performanceMode: ScanPerformanceMode;
  startedAt: string;
  endedAt?: string;
  elapsedMs?: number;
  discoveredCount: number;
  processedCount: number;
  analyzedCount: number;
  inventoryCount: number;
  skippedCount: number;
  safeCount: number;
  monitorCount: number;
  investigationCount: number;
  errorCount: number;
  cancelledAt?: string;
  pausedAt?: string;
  completionPercentage: number;
  failureReason?: string;
  target: string;
}

export interface ScanReportPresentation {
  readonly report: ScanReport;
  readonly statusLabel: string;
  readonly performanceLabel: string;
  readonly startedLabel: string;
  readonly endedLabel?: string;
  readonly durationLabel: string;
  readonly durationDescription: string;
  readonly progressLabel: string;
  readonly warnings: readonly string[];
  readonly generatedAt: string;
}

export function presentScanReport(report: ScanReport, generatedAt = new Date()): ScanReportPresentation {
  const activeElapsed = Math.max(0, generatedAt.valueOf() - Date.parse(report.startedAt));
  const elapsedMs = report.elapsedMs ?? activeElapsed;
  const terminal = report.status === "completed" || report.status === "cancelled" || report.status === "failed";
  const durationDescription = report.status === "running" ? "Elapsed" : report.status === "paused" ? "Active time" : report.status === "cancelled" ? "Cancelled after" : report.status === "failed" ? "Failed after" : "Duration";
  const warnings = [
    ...(report.status === "cancelled" ? [`Scan cancelled at ${formatDate(report.cancelledAt ?? report.endedAt ?? generatedAt.toISOString())}.`] : []),
    ...(report.status === "failed" ? [report.failureReason ?? "The local scan service stopped unexpectedly."] : []),
    ...(report.errorCount > 0 ? [`${report.errorCount.toLocaleString()} file${report.errorCount === 1 ? "" : "s"} could not be read or analyzed.`] : []),
  ];
  return {
    report,
    statusLabel: report.status.toUpperCase(),
    performanceLabel: report.performanceMode.toUpperCase(),
    startedLabel: formatDate(report.startedAt),
    endedLabel: terminal && report.endedAt ? formatDate(report.endedAt) : undefined,
    durationLabel: formatDuration(elapsedMs),
    durationDescription,
    progressLabel: `${Math.round(report.completionPercentage)}% ${report.status === "completed" ? "complete" : "completed"}`,
    warnings,
    generatedAt: generatedAt.toISOString(),
  };
}

export function exportScanReport(report: ScanReport, format: ScanExportFormat): { content: string; extension: string; mimeType: string } {
  const presentation = presentScanReport(report);
  if (format === "json") return { content: JSON.stringify(jsonDocument(presentation), null, 2), extension: "json", mimeType: "application/json" };
  if (format === "html") return { content: htmlDocument(presentation), extension: "html", mimeType: "text/html" };
  if (format === "excel") return { content: excelWorkbook(presentation), extension: "xls", mimeType: "application/vnd.ms-excel" };
  return { content: pdfDocument(presentation), extension: "pdf", mimeType: "application/pdf" };
}

export function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
export function formatDuration(milliseconds: number): string { const seconds = Math.max(0, Math.floor(milliseconds / 1000)); const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60); return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`; }

function jsonDocument(model: ScanReportPresentation): Record<string, unknown> {
  const { report } = model;
  return {
    schemaVersion: "1.1",
    reportType: "full-scan",
    generatedBy: "viAI Security",
    generatedAt: model.generatedAt,
    scan: { id: report.scanId, status: report.status, performanceMode: report.performanceMode, target: report.target, startedAt: report.startedAt, endedAt: report.endedAt, elapsedMs: report.elapsedMs ?? elapsedFromPresentation(model) },
    summary: { processed: report.processedCount, discovered: report.discoveredCount, completionPercentage: report.completionPercentage, errors: report.errorCount },
    performance: { analyzed: report.analyzedCount, inventoryOnly: report.inventoryCount, unchangedSkipped: report.skippedCount },
    assessmentSummary: { likelySafe: report.safeCount, monitoringRecommended: report.monitorCount, needsInvestigation: report.investigationCount },
    warnings: model.warnings,
  };
}

function htmlDocument(model: ScanReportPresentation): string {
  const { report } = model;
  const metrics = [["Files processed", report.processedCount.toLocaleString()], ["Need review", report.investigationCount.toLocaleString()], ["Monitoring", report.monitorCount.toLocaleString()], [model.durationDescription, model.durationLabel]];
  const rows = [["Likely safe", report.safeCount], ["Monitoring recommended", report.monitorCount], ["Needs investigation", report.investigationCount], ["Further analysis", report.analyzedCount], ["Inventory-only", report.inventoryCount], ["Unchanged skipped", report.skippedCount]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>viAI Security Full Scan Report</title><style>:root{color:#18314e;font:15px "Segoe UI Variable","Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#eef4f8}main{max-width:980px;margin:32px auto;background:#fff;border:1px solid #d6e3ed;box-shadow:0 14px 34px #0c243514}.hero{padding:34px 38px;color:#fff;background:#102946}.brand{font-size:22px;font-weight:750}.eyebrow{margin:26px 0 5px;color:#91d1ec;font-size:11px;font-weight:800;letter-spacing:.9px}.hero h1{margin:0;font-size:29px}.meta{display:flex;gap:10px;align-items:center;margin-top:22px;color:#d6e7f4}.badge{display:inline-block;padding:5px 8px;border:1px solid #93cbe5;border-radius:4px;color:#fff;font-size:10px;font-weight:800;letter-spacing:.7px}.badge.status{background:#236a85;border-color:#4fa5c7}.content{padding:30px 38px}.section{margin-top:29px}.section h2{margin:0 0 13px;color:#1b3e61;font-size:13px;letter-spacing:.7px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{padding:16px;border:1px solid #d9e5ed;border-radius:7px;background:#fbfdff}.metric b{display:block;color:#173554;font-size:24px}.metric span{display:block;margin-top:5px;color:#667f96;font-size:12px}.progress{height:8px;overflow:hidden;border-radius:999px;background:#dfeaf1}.progress i{display:block;height:100%;background:#2d83b5}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:10px 0;border-bottom:1px solid #e1ebf1;text-align:left}.table th{color:#607891;font-size:12px;font-weight:600}.table td{text-align:right;font-weight:700}.notice{padding:13px 15px;border-left:3px solid #b7792d;background:#fff8e9;color:#674918;font-size:13px}.footer{padding:17px 38px;color:#6d8296;border-top:1px solid #dce7ee;font-size:11px}@media(max-width:640px){main{margin:0}.hero,.content{padding:25px}.metrics,.grid{grid-template-columns:1fr 1fr}.hero h1{font-size:24px}}</style></head><body><main><header class="hero"><div class="brand">viAI Security</div><p class="eyebrow">FULL DEVICE SCAN REPORT</p><h1>Full Device Scan</h1><div class="meta"><span class="badge">${html(model.performanceLabel)}</span><span class="badge status">${html(model.statusLabel)}</span><span>${html(model.startedLabel)}</span></div></header><div class="content"><section class="section"><h2>SCAN OVERVIEW</h2><div class="metrics">${metrics.map(([label, value]) => `<div class="metric"><b>${html(String(value))}</b><span>${html(String(label))}</span></div>`).join("")}</div></section><section class="section"><h2>COMPLETION</h2><div class="progress"><i style="width:${Math.max(0, Math.min(100, report.completionPercentage))}%"></i></div><p>${html(model.progressLabel)}${model.endedLabel ? ` • Ended ${html(model.endedLabel)}` : ""}</p></section><section class="section grid"><div><h2>ASSESSMENT SUMMARY</h2><table class="table"><tbody>${rows.slice(0, 3).map(([label, value]) => `<tr><th>${html(String(label))}</th><td>${value.toLocaleString()}</td></tr>`).join("")}</tbody></table></div><div><h2>SCAN COVERAGE</h2><table class="table"><tbody>${[["Files discovered", report.discoveredCount], ...rows.slice(3)].map(([label, value]) => `<tr><th>${html(String(label))}</th><td>${Number(value).toLocaleString()}</td></tr>`).join("")}</tbody></table></div></section>${model.warnings.length ? `<section class="section"><h2>WARNINGS</h2>${model.warnings.map((warning) => `<p class="notice">${html(warning)}</p>`).join("")}</section>` : ""}<section class="section"><h2>REPORT INFORMATION</h2><table class="table"><tbody><tr><th>Scan ID</th><td>${html(report.scanId)}</td></tr><tr><th>Target</th><td>${html(report.target)}</td></tr><tr><th>Generated</th><td>${html(formatDate(model.generatedAt))}</td></tr></tbody></table></section></div><footer class="footer">Generated locally by viAI Security • Scan ID ${html(report.scanId)}</footer></main></body></html>`;
}

function excelWorkbook(model: ScanReportPresentation): string {
  const { report } = model;
  const workbook = (name: string, rows: Array<[string, string | number]>) => `<Worksheet ss:Name="${xml(name)}"><Table><Column ss:Width="220"/><Column ss:Width="240"/><Row ss:Height="28"><Cell ss:MergeAcross="1" ss:StyleID="Title"><Data ss:Type="String">viAI Security</Data></Cell></Row><Row><Cell ss:MergeAcross="1" ss:StyleID="Subtitle"><Data ss:Type="String">FULL DEVICE SCAN REPORT — ${xml(name.toUpperCase())}</Data></Cell></Row><Row/><Row><Cell ss:StyleID="Heading"><Data ss:Type="String">Field</Data></Cell><Cell ss:StyleID="Heading"><Data ss:Type="String">Value</Data></Cell></Row>${rows.map(([label, value]) => `<Row><Cell ss:StyleID="Label"><Data ss:Type="String">${xml(label)}</Data></Cell><Cell ss:StyleID="Value"><Data ss:Type="String">${xml(String(value))}</Data></Cell></Row>`).join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane></WorksheetOptions></Worksheet>`;
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Title"><Font ss:FontName="Segoe UI" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#102946" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="Subtitle"><Font ss:FontName="Segoe UI" ss:Size="10" ss:Bold="1" ss:Color="#397EA8"/><Alignment ss:Vertical="Center"/></Style><Style ss:ID="Heading"><Font ss:FontName="Segoe UI" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2875A8" ss:Pattern="Solid"/></Style><Style ss:ID="Label"><Font ss:FontName="Segoe UI" ss:Color="#506B83"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5ED"/></Borders></Style><Style ss:ID="Value"><Font ss:FontName="Segoe UI" ss:Bold="1" ss:Color="#18314E"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D9E5ED"/></Borders></Style></Styles>${workbook("Overview", [["Status", model.statusLabel], ["Performance", model.performanceLabel], ["Started", model.startedLabel], [model.durationDescription, model.durationLabel], ["Completion", model.progressLabel], ["Files processed", report.processedCount]])}${workbook("Assessment Summary", [["Likely safe", report.safeCount], ["Monitoring recommended", report.monitorCount], ["Needs investigation", report.investigationCount], ["Further analysis", report.analyzedCount]])}${workbook("Performance", [["Files discovered", report.discoveredCount], ["Inventory-only", report.inventoryCount], ["Unchanged skipped", report.skippedCount], ["Unreadable files", report.errorCount]])}${model.warnings.length ? workbook("Warnings", model.warnings.map((warning, index) => [`Warning ${index + 1}`, warning])) : ""}${workbook("Metadata", [["Scan ID", report.scanId], ["Target", report.target], ["Generated by", "viAI Security"], ["Generated", formatDate(model.generatedAt)]])}</Workbook>`;
}

function pdfDocument(model: ScanReportPresentation): string {
  const { report } = model;
  const lines = [["viAI Security", 22, 48, 782, "#FFFFFF"], ["FULL DEVICE SCAN REPORT", 10, 48, 757, "#8FD0EB"], ["Full Device Scan", 20, 48, 731, "#FFFFFF"], [`${model.performanceLabel}  |  ${model.statusLabel}  |  ${model.startedLabel}`, 10, 48, 709, "#D7EAF6"], ["SCAN OVERVIEW", 11, 48, 648, "#1B3E61"], [`${report.processedCount.toLocaleString()}  Files processed`, 16, 60, 614, "#18314E"], [`${report.investigationCount.toLocaleString()}  Need review`, 16, 250, 614, "#18314E"], [`${model.durationLabel}  ${model.durationDescription}`, 16, 420, 614, "#18314E"], ["ASSESSMENT SUMMARY", 11, 48, 548, "#1B3E61"], [`Likely safe                                      ${report.safeCount.toLocaleString()}`, 11, 60, 518, "#18314E"], [`Monitoring recommended                    ${report.monitorCount.toLocaleString()}`, 11, 60, 494, "#18314E"], [`Needs investigation                         ${report.investigationCount.toLocaleString()}`, 11, 60, 470, "#18314E"], ["SCAN COVERAGE", 11, 48, 416, "#1B3E61"], [`Files discovered                                ${report.discoveredCount.toLocaleString()}`, 11, 60, 386, "#18314E"], [`Inventory-only files                              ${report.inventoryCount.toLocaleString()}`, 11, 60, 362, "#18314E"], [`Completion                                      ${model.progressLabel}`, 11, 60, 338, "#18314E"], ["REPORT INFORMATION", 11, 48, 284, "#1B3E61"], [`Scan ID  ${report.scanId}`, 9, 60, 256, "#506B83"], [`Generated locally by viAI Security  |  ${formatDate(model.generatedAt)}  |  Page 1`, 9, 48, 54, "#6D8296"]] as const;
  const commands = ["q 0.063 0.161 0.275 rg 0 680 612 162 re f Q", "q 0.92 0.96 0.98 rg 48 580 160 54 re f 218 580 160 54 re f 388 580 160 54 re f Q", ...lines.map(([text, size, x, y, color]) => textCommand(text, size, x, y, color))].join("\n");
  return `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${commands.length} >>\nstream\n${commands}\nendstream\nendobj\ntrailer\n<< /Size 5 /Root 1 0 R >>\n%%EOF`;
}

function textCommand(text: string, size: number, x: number, y: number, color: string): string { const [red, green, blue] = rgb(color); return `BT /F1 ${size} Tf ${red} ${green} ${blue} rg 1 0 0 1 ${x} ${y} Tm (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`; }
function rgb(value: string): [string, string, string] { const channel = (index: number) => (Number.parseInt(value.slice(index, index + 2), 16) / 255).toFixed(3); return [channel(1), channel(3), channel(5)]; }
function elapsedFromPresentation(model: ScanReportPresentation): number { const parsed = /^(?:(\d+)h )?(?:(\d+)m )?(\d+)s$/.exec(model.durationLabel); return parsed ? ((Number(parsed[1] ?? 0) * 3600 + Number(parsed[2] ?? 0) * 60 + Number(parsed[3])) * 1000) : 0; }
function html(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function xml(value: string): string { return html(value); }