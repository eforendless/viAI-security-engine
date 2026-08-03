import { useDeferredValue, useEffect, useState } from "react";
import { Download, FileJson, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Button, ConfirmDialog, DropdownMenu, Panel, Skeleton } from "../components/ui";
import { assessmentHistoryFilters, getAssessmentHistoryCategory, presentAssessment, type AssessmentPresentation, type UserAssessmentHistoryFilter } from "../assessmentPresentation";
import { pageMotion } from "../animations/motion";

interface PersistedRecord { id: string; kind: string; occurredAt: string; detail: string; fileHash?: string; filePath?: string; recommendation?: string; matchedRules?: string[]; engineVersion: string; assessment?: unknown; baselineState?: string; }
interface BackgroundSnapshot { history: PersistedRecord[]; }
type AssessmentFilter = UserAssessmentHistoryFilter;
interface HistoryItem extends PersistedRecord { presentation: AssessmentPresentation; rules: string[]; }
const filters = assessmentHistoryFilters;
const rowHeight = 96;

export default function History() {
  const [persisted, setPersisted] = useState<PersistedRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssessmentFilter>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const deferredQuery = useDeferredValue(query);
  useEffect(() => { let mounted = true; void (async () => { try { const value = await window.viai?.background.snapshot(); if (mounted && value) setPersisted((value as BackgroundSnapshot).history ?? []); } finally { if (mounted) setLoaded(true); } })(); return window.viai?.background.onChanged((value) => { if (mounted && value) { setPersisted((value as BackgroundSnapshot).history ?? []); setLoaded(true); } }); }, []);
  useEffect(() => { setScrollTop(0); }, [deferredQuery, filter]);
  if (!loaded) return <motion.div {...pageMotion} className="page-stack history-loading-skeleton" aria-busy="true"><div><Skeleton className="history-skeleton-title" /><Skeleton className="history-skeleton-copy" /></div><Panel className="history-skeleton-panel"><div className="history-skeleton-toolbar"><Skeleton /><Skeleton /></div>{Array.from({ length: 6 }, (_, index) => <div className="history-skeleton-row" key={index}><Skeleton /><div><Skeleton /><Skeleton /></div><Skeleton /></div>)}</Panel></motion.div>;

  const records: HistoryItem[] = persisted.map((record) => ({ ...record, presentation: presentAssessment(record, record.engineVersion), rules: record.matchedRules ?? [] })).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const results = records.filter((item) => matchesSearch(item, deferredQuery) && matchesFilter(item.presentation, filter));
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const visible = results.slice(first, Math.min(results.length, first + 18));
  const selectedLabel = filters.find((option) => option.value === filter)?.label ?? "All assessments";
  const exportJson = () => download(JSON.stringify(results, null, 2), "viai-analysis-history.json", "application/json");

  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><p className="eyebrow">LOCAL SECURITY ACTIVITY</p><h2>Analysis history</h2><p>Review local security activity and open any analysis for its retained technical evidence.</p></div><div className="history-actions"><ClearDataControl /><HistoryClearControl /><Button onClick={exportJson} disabled={!results.length}><Download size={16} />Export JSON</Button></div></div><Panel className="history-panel"><div className="toolbar"><div className="history-filters"><label className="search-box"><Search size={17} /><span className="sr-only">Search analysis history</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files, actions, or evidence" /></label><DropdownMenu ariaLabel="Filter analysis history" label={selectedLabel} value={filter} options={filters} onChange={(value) => setFilter(value as AssessmentFilter)} icon={SlidersHorizontal} /></div><span>{results.length} record{results.length === 1 ? "" : "s"}</span></div>{results.length ? <div className="history-viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="history-virtual-list" style={{ height: results.length * rowHeight }}>{visible.map((item, offset) => <HistoryRow key={item.id} item={item} top={(first + offset) * rowHeight} />)}</div></div> : <div className="empty-state"><FileJson size={30} /><div><strong>No matching local records</strong><p>Completed analyses and local events will appear here.</p></div></div>}</Panel></motion.div>;
}

function HistoryRow({ item, top }: { item: HistoryItem; top: number }) {
  const fileName = item.filePath?.split(/[\\/]/).pop() ?? item.detail;
  const evidence = item.presentation.consumerEvidence[0]?.title;
  return <motion.div className="history-row consumer-history-row" style={{ top }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><FileJson size={18} className="file-icon" /><div className="file-cell"><strong title={item.filePath}>{fileName}</strong><span>{formatTime(item.occurredAt)}</span>{evidence && <small>{evidence}</small>}</div><span className={`assessment-status ${item.presentation.status.tone}`}>{item.presentation.status.label}</span><span className={`assessment-action ${item.presentation.displayRecommendation.tone}`}>{item.presentation.displayRecommendation.label}</span><Link className="text-link" to={`/details/${item.id}`}>View details</Link></motion.div>;
}

function matchesSearch(item: HistoryItem, query: string): boolean { const values = [item.filePath, item.detail, item.presentation.verdict, item.presentation.recommendation, item.presentation.status.label, item.presentation.displayRecommendation.label, ...item.presentation.importantEvidence, ...item.rules].filter((value): value is string => Boolean(value)); return values.join(" ").toLowerCase().includes(query.toLowerCase()); }
function matchesFilter(presentation: AssessmentPresentation, filter: AssessmentFilter): boolean { return filter === "all" || getAssessmentHistoryCategory(presentation) === filter; }
function formatTime(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function HistoryClearControl() { const [open, setOpen] = useState(false); const [clearing, setClearing] = useState(false); const confirm = async () => { setClearing(true); try { await window.viai?.background.clearHistory("all"); setOpen(false); toast.success("Local history cleared."); } catch { toast.error("Could not clear local history."); } finally { setClearing(false); } }; return <><Button className="danger" onClick={() => setOpen(true)}><Trash2 size={16} />Clear history</Button><ConfirmDialog open={open} title="Clear local history" detail="This removes all local analysis records. This cannot be undone." confirmLabel={clearing ? "Clearing..." : "Clear history"} onCancel={() => setOpen(false)} onConfirm={() => void confirm()} /></>; }
function ClearDataControl() { const [open, setOpen] = useState(false); const [clearing, setClearing] = useState(false); const confirm = async () => { setClearing(true); try { await window.viai?.application.clearLocalData(); setOpen(false); toast.success("Local scan data cleared. Protection settings remain active."); } catch { toast.error("Could not clear local data."); } finally { setClearing(false); } }; return <><Button className="danger" onClick={() => setOpen(true)}><Trash2 size={16} />Clear data</Button><ConfirmDialog open={open} title="Clear local data?" detail="This removes local scan history, active scan state, device records, trust decisions, and cached hash reputation. Protection settings remain active. It does not remove files from your computer." confirmLabel={clearing ? "Clearing..." : "Clear local data"} onCancel={() => setOpen(false)} onConfirm={() => void confirm()} /></>; }
function download(content: BlobPart, filename: string, type: string): void { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }