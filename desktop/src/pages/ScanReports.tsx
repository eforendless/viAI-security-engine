import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { ArrowRight, ClipboardList, Play, Search, SlidersHorizontal } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Button, DropdownMenu, Panel, Skeleton } from "../components/ui";
import { pageMotion } from "../animations/motion";
import { formatDate, formatDuration, presentScanReport, type ScanPerformanceMode, type ScanReport, type ScanReportStatus } from "../scanReportPresentation";

interface ScanReportPage { items: ScanReport[]; total: number; page: number; pageSize: number; }
interface ReportUpdate { event: string; report: ScanReport; }
const statusOptions = [{ value: "all", label: "All statuses" }, { value: "running", label: "Running" }, { value: "completed", label: "Completed" }, { value: "paused", label: "Paused" }, { value: "cancelled", label: "Cancelled" }, { value: "failed", label: "Failed" }] as const;
const performanceOptions = [{ value: "all", label: "All performance levels" }, { value: "light", label: "Light" }, { value: "balanced", label: "Balanced" }, { value: "deep", label: "Deep" }] as const;
const pageSize = 30;

export default function ScanReports() {
  const [reports, setReports] = useState<ScanReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ScanReportStatus>("all");
  const [performanceMode, setPerformanceMode] = useState<"all" | ScanPerformanceMode>("all");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    let active = true;
    void window.viai?.background.scanReportPage({ page, pageSize, search: deferredSearch, status, performanceMode }).then((value) => {
      if (!active || !value) return;
      const result = value as ScanReportPage;
      startTransition(() => { setReports(result.items ?? []); setTotal(result.total ?? 0); });
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [page, deferredSearch, status, performanceMode, revision]);

  useEffect(() => { setPage(0); }, [deferredSearch, status, performanceMode]);

  useEffect(() => window.viai?.background.onScanReportUpdated((value) => {
    const update = value as Partial<ReportUpdate>;
    if (!update.report || typeof update.report.scanId !== "string") return;
    const report = update.report;
    const matches = matchesCurrentQuery(report, deferredSearch, status, performanceMode);
    startTransition(() => {
      setReports((current) => {
        const index = current.findIndex((item) => item.scanId === report.scanId);
        if (!matches) return index === -1 ? current : current.filter((item) => item.scanId !== report.scanId);
        if (index !== -1) return current.map((item) => item.scanId === report.scanId ? report : item);
        if (page !== 0) return current;
        return [report, ...current].sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, pageSize);
      });
    });
    if (update.event !== "scanProgress") setRevision((current) => current + 1);
  }), [deferredSearch, status, performanceMode, page]);

  if (!loaded) return <motion.div {...pageMotion} className="page-stack report-list-loading" aria-busy="true"><Skeleton className="report-skeleton-title" /><Panel className="report-list-panel">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="scan-report-skeleton" />)}</Panel></motion.div>;
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title"><p className="eyebrow">FULL DEVICE SCANS</p><h2>Scan Reports</h2><p>Review completed, paused, cancelled, and failed full scan sessions.</p></div><Panel className="report-list-panel"><div className="report-list-toolbar"><label className="search-box"><Search size={17} /><span className="sr-only">Search scan reports</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search scan reports..." /></label><div className="report-list-filters"><DropdownMenu ariaLabel="Filter scan report status" label={statusOptions.find((option) => option.value === status)?.label ?? "All statuses"} value={status} options={statusOptions} onChange={(value) => setStatus(value as "all" | ScanReportStatus)} icon={SlidersHorizontal} /><DropdownMenu ariaLabel="Filter scan report performance" label={performanceOptions.find((option) => option.value === performanceMode)?.label ?? "All performance levels"} value={performanceMode} options={performanceOptions} onChange={(value) => setPerformanceMode(value as "all" | ScanPerformanceMode)} icon={SlidersHorizontal} /></div></div><div className="report-list-count">{total} scan report{total === 1 ? "" : "s"}</div>{reports.length ? <div className="scan-report-list">{reports.map((report) => <ScanReportCard key={report.scanId} report={report} />)}</div> : <div className="scan-reports-empty"><ClipboardList size={34} /><div><strong>No scan reports yet</strong><p>Completed, paused, cancelled, and failed Full Device Scans will appear here.</p></div><Link to="/full-scan"><Button className="primary"><Play size={16} />Start Full Scan</Button></Link></div>}{total > pageSize && <div className="report-pagination"><Button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>Previous</Button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}</span><Button onClick={() => setPage((current) => current + 1)} disabled={(page + 1) * pageSize >= total}>Next</Button></div>}</Panel></motion.div>;
}

function ScanReportCard({ report }: { report: ScanReport }) {
  const model = presentScanReport(report);
  const active = report.status === "running";
  const elapsed = report.elapsedMs === undefined ? model.durationLabel : formatDuration(report.elapsedMs);
  return <article className={`scan-report-card ${report.status}`}><header><div><p className="scan-report-kicker">Full Device Scan</p><div className="scan-report-title-line"><h3>{model.performanceLabel}</h3><span className="scan-performance-badge">{model.performanceLabel}</span></div><p className="scan-report-date">{formatDate(report.startedAt)}</p></div><span className={`scan-report-status ${report.status}`}>{active && <i aria-hidden="true" />}{model.statusLabel}</span></header><div className="scan-report-card-body"><section className="scan-report-card-metrics"><Metric value={report.processedCount.toLocaleString()} label="Files processed" /><Metric value={report.investigationCount.toLocaleString()} label="Need review" /><Metric value={report.monitorCount.toLocaleString()} label="Monitoring" /><Metric value={report.safeCount.toLocaleString()} label="Likely safe" /></section><div className="scan-report-progress"><div><span>{model.progressLabel}</span><span>{model.durationDescription} {elapsed}</span></div><div className="scan-report-progress-track" aria-label={model.progressLabel}><i style={{ width: `${Math.max(0, Math.min(100, report.completionPercentage))}%` }} /></div></div></div><footer><span>{report.status === "paused" ? "Paused. Ready to continue." : report.status === "cancelled" ? `Cancelled after ${model.durationLabel}` : report.status === "failed" ? `Failed after ${model.durationLabel}` : report.status === "completed" ? `Completed in ${model.durationLabel}` : "Live update every 400 ms"}</span><Link to={`/scan-reports/${report.scanId}`}><Button>{active ? "View Live Report" : "View Report"}<ArrowRight size={16} /></Button></Link></footer></article>;
}

function Metric({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function matchesCurrentQuery(report: ScanReport, search: string, status: "all" | ScanReportStatus, performanceMode: "all" | ScanPerformanceMode): boolean { return (status === "all" || report.status === status) && (performanceMode === "all" || report.performanceMode === performanceMode) && (!search.trim() || `${report.scanId} ${report.target} ${report.performanceMode}`.toLowerCase().includes(search.trim().toLowerCase())); }
