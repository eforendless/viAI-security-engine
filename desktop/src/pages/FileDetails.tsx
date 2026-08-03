import { ArrowLeft, Download, FileBadge, FolderOpen, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, DropdownMenu, Panel, Skeleton } from "../components/ui";
import { exportExcel, exportHtml, exportJson, exportPdf, presentAssessment, type AssessmentPresentation, type DisplayMetric } from "../assessmentPresentation";
import { pageMotion } from "../animations/motion";

interface RecordDetail { id: string; kind: string; occurredAt: string; detail: string; filePath?: string; engineVersion?: string; report?: Record<string, unknown>; }
type ExportFormat = "excel" | "pdf" | "html" | "json";
const exportOptions = [{ value: "excel", label: "Excel" }, { value: "pdf", label: "PDF" }, { value: "html", label: "HTML" }, { value: "json", label: "JSON" }] as const;

export default function FileDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<RecordDetail>();
  const [loaded, setLoaded] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string>();

  useEffect(() => {
    let active = true;
    void (async () => { try { const next = id ? await window.viai?.background.historyRecord(id) : undefined; if (active) setRecord(next as RecordDetail | undefined); } finally { if (active) setLoaded(true); } })();
    void window.viai?.application.engineVersion().then((value) => { if (active) setEngineVersion(value); });
    return () => { active = false; };
  }, [id]);

  if (!loaded) return <motion.div {...pageMotion} className="page-stack report-loading-skeleton" aria-busy="true"><Skeleton className="report-skeleton-title" /><section className="report-skeleton-metrics">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} />)}</section></motion.div>;
  if (!record) return <motion.div {...pageMotion} className="empty-report"><FileBadge size={42} /><h2>Report not found</h2><p>This local report is no longer available.</p><Button onClick={() => navigate("/history")}><ArrowLeft size={16} />Back to history</Button></motion.div>;

  const presentation = presentAssessment(record, engineVersion ?? record.engineVersion ?? "Not recorded");
  const fileName = record.filePath?.split(/[\\/]/).pop() ?? record.detail;
  const exportReport = (format: ExportFormat) => {
    const content = format === "html" ? exportHtml(presentation) : format === "pdf" ? exportPdf(presentation) : format === "excel" ? exportExcel(presentation) : exportJson(presentation);
    const extension = format === "excel" ? "xls" : format;
    const type = format === "html" ? "text/html" : format === "pdf" ? "application/pdf" : format === "excel" ? "application/vnd.ms-excel" : "application/json";
    download(content, `${fileName}.${extension}`, type);
  };

    return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><Button onClick={() => navigate("/history")} className="secondary"><ArrowLeft size={16} />Back to history</Button><p className="eyebrow">{presentation.model === "legacy" ? "LEGACY ASSESSMENT" : "SECURITY ANALYSIS"}</p><h2>{fileName}</h2><p>{record.filePath ?? "Legacy local record"}</p></div><div className="details-actions">{record.filePath && <Button onClick={() => void window.viai?.openPath(record.filePath)}><FolderOpen size={16} />Open file location</Button>}<DropdownMenu ariaLabel="Export report as" label="Export as" options={exportOptions} onChange={exportReport} icon={Download} /><Button onClick={() => void navigator.clipboard.writeText(JSON.stringify(record, null, 2))}>Copy report</Button></div></div>
      {presentation.model === "legacy" && <Panel className="evidence-panel"><div className="panel-heading"><h3>Legacy assessment</h3></div><p>This v0.1/v0.2 record has no canonical v0.3 assessment. Its retained score is shown only for historical context.</p></Panel>}
      <Panel className={`consumer-summary tone-${presentation.status.tone}`}><ShieldCheck size={28} /><div><span className="status-label">{presentation.status.label}</span><h3>{presentation.shortExplanation}</h3><p>{presentation.displayRecommendation.label}</p></div></Panel>
      <section className="report-summary"><ConsumerMetric icon={ShieldCheck} label="Status" value={presentation.status} /><ConsumerMetric icon={FileBadge} label="Recommended action" value={presentation.displayRecommendation} /><ConsumerMetric icon={FileBadge} label="Suspicion" value={presentation.displaySuspicion} /><ConsumerMetric icon={FileBadge} label="Analysis confidence" value={presentation.displayConfidence} /></section>
      <EvidencePanel values={presentation.consumerEvidence} />
      <details className="technical-details"><summary>Technical details</summary><div className="details-grid"><ListPanel title="Assessment" values={technicalAssessmentDetails(presentation)} empty="No assessment details were retained." /><ListPanel title="Important evidence" values={presentation.importantEvidence} empty="No important evidence was retained." /><ListPanel title="Trust evidence" values={presentation.trustEvidence} empty="No trust evidence was retained." /><ListPanel title="Evidence and parser warnings" values={presentation.warnings} empty="No evidence or parser warnings were retained." /><ListPanel title="File details" values={presentation.details.map(([label, value]) => `${label}: ${value}`)} empty="No file details were retained." /></div></details>
    </motion.div>;
  }

  function ConsumerMetric({ icon: Icon, label, value }: { icon: typeof FileBadge; label: string; value: DisplayMetric }) { return <Panel className={`consumer-metric tone-${value.tone}`}><Icon size={22} /><div><span>{label}</span><strong>{value.label}</strong></div></Panel>; }
  function EvidencePanel({ values }: { values: AssessmentPresentation["consumerEvidence"] }) { return <Panel className="evidence-panel consumer-evidence"><div className="panel-heading"><h3>Why viAI reached this conclusion</h3></div>{values.length ? <div className="consumer-evidence-list">{values.map((evidence, index) => <div key={`${evidence.title}-${index}`}><strong>{evidence.title}</strong><p>{evidence.detail}</p></div>)}</div> : <p>No notable static evidence was retained for this report.</p>}</Panel>; }
  function ListPanel({ title, values, empty }: { title: string; values: readonly string[]; empty: string }) { return <Panel className="evidence-panel"><div className="panel-heading"><h3>{title}</h3></div><ul>{(values.length ? values : [empty]).map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</ul></Panel>; }
  function metric(value: AssessmentPresentation["suspicion"]): string { return value.score === undefined ? value.level : `${value.score}/100 (${value.level})`; }
  function technicalAssessmentDetails(presentation: AssessmentPresentation): string[] { return [`Assessment model: ${presentation.modelLabel}`, `Canonical verdict: ${presentation.verdict}`, `Suspicion score: ${metric(presentation.suspicion)}`, `Trust score: ${metric(presentation.trust)}`, `Evidence confidence: ${metric(presentation.confidence)}`, `Investigation priority: ${presentation.priority}`, `Recommendation: ${presentation.recommendation}`, `Baseline/change state: ${presentation.baselineState}`, `Engine version: ${presentation.versions.engine}`, `Rule-set version: ${presentation.versions.ruleSet}`, `Trust-policy version: ${presentation.versions.trustPolicy}`, `Assessment schema version: ${presentation.versions.assessmentSchema}`]; }
  function download(content: BlobPart, filename: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
