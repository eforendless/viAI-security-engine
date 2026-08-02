import { useDeferredValue, useEffect, useState } from "react";
import { Download, FileJson, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Button, ConfirmDialog, DropdownMenu, LoadingState, Panel, RiskBadge } from "../components/ui";
import { pageMotion } from "../animations/motion";

interface PersistedRecord { id: string; kind: string; occurredAt: string; detail: string; fileHash?: string; filePath?: string; riskScore?: number; trustScore?: number; recommendation?: string; matchedRules?: string[]; engineVersion: string; }
interface BackgroundSnapshot { history: PersistedRecord[]; }
const rowHeight = 84;
const riskOptions = [{ value: "all", label: "All risk levels" }, { value: "low", label: "Low risk" }, { value: "medium", label: "Medium risk" }, { value: "high", label: "High risk" }] as const;

export default function History() {
  const [persisted, setPersisted] = useState<PersistedRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [riskFilter, setSelectedRiskFilter] = useState<"all" | "low" | "medium" | "high">("all");
  const [scrollTop, setScrollTop] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const setRiskFilter = (value: string) => setSelectedRiskFilter(value as typeof riskFilter);
  useEffect(() => { let mounted = true; void (async () => { try { const value = await window.viai?.background.snapshot(); if (mounted && value) setPersisted((value as BackgroundSnapshot).history ?? []); } finally { if (mounted) setLoaded(true); } })(); return window.viai?.background.onChanged((value) => { if (mounted && value) { setPersisted((value as BackgroundSnapshot).history ?? []); setLoaded(true); } }); }, []);
  if (!loaded) return <motion.div {...pageMotion} className="page-stack"><LoadingState title="Loading analysis history" detail="Retrieving local reports and events." /></motion.div>;
  const records = persisted.map((record) => ({ ...record, risk: risk(record.riskScore), score: record.riskScore ?? 0, trust: record.trustScore, rules: record.matchedRules ?? [] })).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const results = records.filter((item) => `${item.filePath ?? ""} ${item.detail}`.toLowerCase().includes(deferredQuery.toLowerCase()) && (riskFilter === "all" || item.risk === riskFilter));
  const exportJson = () => { const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "viai-analysis-history.json"; anchor.click(); URL.revokeObjectURL(url); };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const last = Math.min(results.length, first + 18);
  const visible = results.slice(first, last);
  const selectedRiskLabel = riskOptions.find((option) => option.value === riskFilter)?.label ?? "All risk levels";
  return <motion.div {...pageMotion} className="page-stack">
    <div className="page-title split-title"><div><p className="eyebrow">LOCAL RECORDS</p><h2>Analysis history</h2><p>Full local reports, recommendations, trust evidence, and rule matches remain available for review.</p></div><div className="history-actions"><ClearDataControl /><HistoryClearControl /><Button onClick={exportJson} disabled={!results.length}><Download size={16} />Export JSON</Button></div></div>
    <Panel className="history-panel"><div className="toolbar"><div className="history-filters"><label className="search-box"><Search size={17} /><span className="sr-only">Search analysis history</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and local events" /></label><DropdownMenu ariaLabel="Filter by risk level" label={selectedRiskLabel} value={riskFilter} options={riskOptions} onChange={setRiskFilter} icon={SlidersHorizontal} /></div><span>{results.length} record{results.length === 1 ? "" : "s"}</span></div>{results.length ? <div className="history-viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="history-virtual-list" style={{ height: results.length * rowHeight }}>{visible.map((item, offset) => <div className="history-row" key={item.id} style={{ transform: `translateY(${(first + offset) * rowHeight}px)` }}><FileJson size={18} className="file-icon" /><div className="file-cell"><strong title={item.filePath}>{item.filePath?.split(/[\\/]/).pop() ?? item.detail}</strong><span>{new Date(item.occurredAt).toLocaleString()} - {item.recommendation ?? "Local event"} - trust {item.trust ?? 0}</span><span>{item.rules.length ? `Rules: ${item.rules.join(", ")}` : item.detail}</span></div><RiskBadge risk={item.risk} /><strong className="score-cell">{item.score}</strong><Link className="text-link" to={`/details/${item.id}`}>View details</Link></div>)}</div></div> : <div className="empty-state"><FileJson size={30} /><div><strong>No matching local records</strong><p>Completed analyses and realtime events will appear here.</p></div></div>}</Panel>
  </motion.div>;
}

function HistoryClearControl() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "low" | "medium" | "high">("all");
  const [clearing, setClearing] = useState(false);
  const confirm = async () => { setClearing(true); try { await window.viai?.background.clearHistory(scope); setOpen(false); toast.success("Local history cleared."); } catch { toast.error("Could not clear local history."); } finally { setClearing(false); } };
  return <><Button className="danger" onClick={() => setOpen(true)}><Trash2 size={16} />Clear history</Button><ConfirmDialog open={open} title="Clear local history" detail="Choose which local analysis records to remove. This cannot be undone." confirmLabel={clearing ? "Clearing..." : `Clear ${scope} records`} onCancel={() => setOpen(false)} onConfirm={() => void confirm()}><div className="confirm-options" role="group" aria-label="History records to clear">{(["all", "low", "medium", "high"] as const).map((option) => <button key={option} type="button" className={scope === option ? "selected" : ""} onClick={() => setScope(option)}>{option === "all" ? "All records" : `${option[0].toUpperCase()}${option.slice(1)} risk`}</button>)}</div></ConfirmDialog></>;
}

function ClearDataControl() {
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const confirm = async () => { setClearing(true); try { await window.viai?.application.clearLocalData(); setOpen(false); toast.success("Local scan data cleared."); } catch { toast.error("Could not clear local data."); } finally { setClearing(false); } };
  return <><Button className="danger" onClick={() => setOpen(true)}><Trash2 size={16} />Clear data</Button><ConfirmDialog open={open} title="Clear local data?" detail="This removes local scan history, active scan state, device records, trust decisions, settings, and cached hash reputation. It does not remove files from your computer." confirmLabel={clearing ? "Clearing..." : "Clear local data"} onCancel={() => setOpen(false)} onConfirm={() => void confirm()} /></>;
}

function risk(score: number | undefined): "low" | "medium" | "high" { return (score ?? 0) <= 25 ? "low" : (score ?? 0) <= 60 ? "medium" : "high"; }