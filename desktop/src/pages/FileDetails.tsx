import { ArrowLeft, FileBadge, FolderOpen, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel, RiskBadge } from "../components/ui";
import { pageMotion } from "../animations/motion";

interface RecordDetail { id: string; kind: string; occurredAt: string; detail: string; filePath?: string; fileHash?: string; riskScore?: number; trustScore?: number; recommendation?: string; matchedRules?: string[]; trustIndicators?: string[]; engineVersion?: string; scanDurationMs?: number; scanType?: string; report?: Record<string, unknown>; }
interface Snapshot { history: RecordDetail[]; }

export default function FileDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<RecordDetail>();
  useEffect(() => {
    let active = true;
    const select = (value: unknown) => { const snapshot = value as Snapshot; const next = snapshot?.history?.find((entry) => entry.id === id); if (active) setRecord(next); };
    void window.viai?.background.snapshot().then(select);
    return window.viai?.background.onChanged(select);
  }, [id]);
  if (!record) return <motion.div {...pageMotion} className="empty-report"><FileBadge size={42} /><h2>Report not found</h2><p>This local report is no longer available.</p><Button onClick={() => navigate("/history")}><ArrowLeft size={16} />Back to history</Button></motion.div>;
  const report = record.report ?? {};
  const metadata = object(report.metadata);
  const hashes = object(report.hashes);
  const professional = object(report.report);
  const reportTrust = object(professional.trust);
  const reportRisk = object(professional.risk);
  const reportConfidence = object(professional.confidence);
  const signature = object(report.digitalSignature);
  const evidence = strings(report.evidence);
  const openLocation = () => { if (record.filePath) void window.viai?.openPath(record.filePath); };
  const downloadHtml = () => {
    const title = record.filePath?.split(/[\\/]/).pop() ?? "viAI analysis report";
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#0c1525;color:#e8f1ff;font:15px Segoe UI,Arial,sans-serif}main{max-width:900px;margin:auto;padding:40px}section{background:#14233a;border:1px solid #29405f;border-radius:8px;padding:18px;margin:14px 0}small{color:#9fb2cf}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><main><small>viAI SECURITY</small><h1>${escapeHtml(title)}</h1><section><h2>Executive summary</h2><p>${escapeHtml(string(professional.summary) ?? "No 0.2 summary was retained for this report.")}</p></section><section><h2>Static analysis report</h2><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></section></main></body></html>`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/html" }));
    const link = document.createElement("a"); link.href = url; link.download = `${title}.html`; link.click(); URL.revokeObjectURL(url);
  };
  const rows: Array<[string, string]> = [
    ["File name", record.filePath?.split(/[\\/]/).pop() ?? "Not available"], ["Full path", record.filePath ?? "Not retained by this legacy record"], ["SHA-256", string(hashes.sha256) ?? record.fileHash ?? "Not available"], ["Timestamp", formatDate(record.occurredAt)], ["Engine version", record.engineVersion ?? "Not recorded"], ["Risk score", String(record.riskScore ?? report.finalRiskScore ?? "Not available")], ["Trust score", String(record.trustScore ?? report.trustScore ?? "Not available")], ["Recommendation", record.recommendation ?? string(report.recommendation) ?? "Not available"], ["Scan duration", record.scanDurationMs === undefined ? "Not recorded" : formatDuration(record.scanDurationMs)], ["Scan type", record.scanType ?? "Not recorded"], ["File size", typeof metadata.size === "number" ? formatBytes(metadata.size) : "Not recorded"], ["File type", string(report.fileType) ?? "Not recorded"],
  ];
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><Button onClick={() => navigate("/history")} className="secondary"><ArrowLeft size={16} />Back to history</Button><p className="eyebrow">LOCAL EVIDENCE REPORT</p><h2>{record.filePath?.split(/[\\/]/).pop() ?? record.detail}</h2><p>{record.filePath ?? "Legacy local record"}</p></div><div className="details-actions">{record.filePath && <Button onClick={openLocation}><FolderOpen size={16} />Open file location</Button>}<Button onClick={downloadHtml}>Export HTML</Button><Button onClick={() => navigator.clipboard.writeText(JSON.stringify(record, null, 2))}>Copy report</Button></div></div>{string(professional.summary) && <Panel className="evidence-panel"><div className="panel-heading"><h3>Executive summary</h3></div><p>{string(professional.summary)}</p></Panel>}<section className="report-summary"><Panel><span className="report-icon"><ShieldCheck size={25} /></span><div><span>Risk score</span><strong>{number(reportRisk.score, record.riskScore ?? 0)}<small>/100</small></strong><RiskBadge risk={risk(number(reportRisk.score, record.riskScore ?? 0))} /></div></Panel><Panel><FileBadge size={22} /><div><span>Trust score</span><strong>{number(reportTrust.score, record.trustScore ?? 0)}<small>/100</small></strong><small>{string(reportTrust.level) ?? "Not recorded"}</small></div></Panel><Panel><FileBadge size={22} /><div><span>Confidence</span><strong>{number(reportConfidence.score, number(report.confidence, 0))}<small>/100</small></strong></div></Panel><Panel><FileBadge size={22} /><div><span>Recommendation</span><strong className="recommendation">{record.recommendation ?? "Local event"}</strong></div></Panel></section><div className="details-grid"><Panel className="detail-panel"><div className="panel-heading"><FileBadge size={18} /><h3>Report details</h3></div>{rows.map(([label, value]) => <div className="detail-row" key={label}><span>{label}</span><code>{value}</code></div>)}</Panel><Panel className="detail-panel"><div className="panel-heading"><FileBadge size={18} /><h3>Digital signature</h3></div>{[["Status", string(signature.status)], ["Publisher", string(signature.publisher)], ["Certificate issuer", string(signature.certificateIssuer)], ["Expires", string(signature.certificateExpiresAt)]].map(([label, value]) => <div className="detail-row" key={label}><span>{label}</span><code>{value ?? "Not recorded"}</code></div>)}</Panel><ListPanel title="Risk breakdown" values={arrayObjects(reportRisk.breakdown).map((item) => `${number(item.score, 0) >= 0 ? "+" : ""}${number(item.score, 0)} ${string(item.reason) ?? "Static rule"}`)} empty="No scored rule matches were retained." /><ListPanel title="Confidence explanation" values={strings(reportConfidence.explanation)} empty="No confidence explanation was retained." /><ListPanel title="Matched rules" values={record.matchedRules ?? []} empty="No matched rules were retained." /><ListPanel title="Trust indicators" values={record.trustIndicators ?? []} empty="No trust indicators were retained." /><ListPanel title="Evidence" values={evidence} empty={record.detail} /></div></motion.div>;
}

function ListPanel({ title, values, empty }: { title: string; values: string[]; empty: string }) { return <Panel className="evidence-panel"><div className="panel-heading"><div><h3>{title}</h3></div></div><ul>{(values.length ? values : [empty]).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul></Panel>; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function arrayObjects(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")) : []; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
function risk(score: number | undefined): "low" | "medium" | "high" { return (score ?? 0) <= 25 ? "low" : (score ?? 0) <= 60 ? "medium" : "high"; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Not recorded" : date.toLocaleString(); }
function formatDuration(milliseconds: number): string { return `${(milliseconds / 1_000).toFixed(2)} seconds`; }
function formatBytes(value: number): string { return `${(value / 1024).toFixed(1)} KB`; }