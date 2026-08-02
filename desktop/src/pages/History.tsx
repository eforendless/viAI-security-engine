import { useDeferredValue, useEffect, useState } from "react";
import { Download, FileJson, Search, SlidersHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button, DropdownMenu, Panel, RiskBadge } from "../components/ui";
import { pageMotion } from "../animations/motion";

interface PersistedRecord { id: string; kind: string; occurredAt: string; detail: string; fileHash?: string; filePath?: string; riskScore?: number; trustScore?: number; recommendation?: string; matchedRules?: string[]; engineVersion: string; }
interface BackgroundSnapshot { history: PersistedRecord[]; }
const rowHeight = 84;
const riskOptions = [{ value: "all", label: "All risk levels" }, { value: "low", label: "Low risk" }, { value: "medium", label: "Medium risk" }, { value: "high", label: "High risk" }] as const;

export default function History() {
  const [persisted, setPersisted] = useState<PersistedRecord[]>([]);
  const [query, setQuery] = useState("");
  const [riskFilter, setSelectedRiskFilter] = useState<"all" | "low" | "medium" | "high">("all");
  const [scrollTop, setScrollTop] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const setRiskFilter = (value: string) => setSelectedRiskFilter(value as typeof riskFilter);
  useEffect(() => { let mounted = true; void window.viai?.background.snapshot().then((value) => { if (mounted && value) setPersisted((value as BackgroundSnapshot).history ?? []); }); return window.viai?.background.onChanged((value) => { if (mounted && value) setPersisted((value as BackgroundSnapshot).history ?? []); }); }, []);
  const records = persisted.map((record) => ({ ...record, risk: risk(record.riskScore), score: record.riskScore ?? 0, trust: record.trustScore, rules: record.matchedRules ?? [] })).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const results = records.filter((item) => `${item.filePath ?? ""} ${item.detail}`.toLowerCase().includes(deferredQuery.toLowerCase()) && (riskFilter === "all" || item.risk === riskFilter));
  const exportJson = () => { const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "viai-analysis-history.json"; anchor.click(); URL.revokeObjectURL(url); };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const last = Math.min(results.length, first + 18);
  const visible = results.slice(first, last);
  const selectedRiskLabel = riskOptions.find((option) => option.value === riskFilter)?.label ?? "All risk levels";
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><p className="eyebrow">LOCAL RECORDS</p><h2>Analysis history</h2><p>Full local reports, recommendations, trust evidence, and rule matches remain available for review.</p></div><Button onClick={exportJson} disabled={!results.length}><Download size={16} />Export JSON</Button></div><Panel className="history-panel"><div className="toolbar"><div className="history-filters"><label className="search-box"><Search size={17} /><span className="sr-only">Search analysis history</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and local events" /></label><DropdownMenu ariaLabel="Filter by risk level" label={selectedRiskLabel} value={riskFilter} options={riskOptions} onChange={setRiskFilter} icon={SlidersHorizontal} /></div><span>{results.length} record{results.length === 1 ? "" : "s"}</span></div>{results.length ? <div className="history-viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div className="history-virtual-list" style={{ height: results.length * rowHeight }}>{visible.map((item, offset) => <div className="history-row" key={item.id} style={{ transform: `translateY(${(first + offset) * rowHeight}px)` }}><FileJson size={18} className="file-icon" /><div className="file-cell"><strong title={item.filePath}>{item.filePath?.split(/[\\/]/).pop() ?? item.detail}</strong><span>{new Date(item.occurredAt).toLocaleString()} - {item.recommendation ?? "Local event"} - trust {item.trust ?? 0}</span><span>{item.rules.length ? `Rules: ${item.rules.join(", ")}` : item.detail}</span></div><RiskBadge risk={item.risk} /><strong className="score-cell">{item.score}</strong><Link className="text-link" to={`/details/${item.id}`}>View details</Link></div>)}</div></div> : <div className="empty-state"><FileJson size={30} /><div><strong>No matching local records</strong><p>Completed analyses and realtime events will appear here.</p></div></div>}</Panel></motion.div>;
}

function risk(score: number | undefined): "low" | "medium" | "high" { return (score ?? 0) <= 25 ? "low" : (score ?? 0) <= 60 ? "medium" : "high"; }