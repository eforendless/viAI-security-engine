import { useDeferredValue, useState } from "react";
import { Download, FileJson, Search } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button, Panel, RiskBadge } from "../components/ui";
import { useSecurityStore } from "../store/securityStore";
import { pageMotion } from "../animations/motion";

export default function History() {
  const history = useSecurityStore((state) => state.history);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const results = history.filter((item) => item.filePath.toLowerCase().includes(deferredQuery.toLowerCase()));
  const exportJson = () => { const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "viai-analysis-history.json"; anchor.click(); URL.revokeObjectURL(url); };
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><p className="eyebrow">LOCAL RECORDS</p><h2>Analysis history</h2><p>Review evidence collected by the local engine. Records stay on this device.</p></div><Button onClick={exportJson} disabled={!history.length}><Download size={16} />Export JSON</Button></div><Panel className="history-panel"><div className="toolbar"><label className="search-box"><Search size={17} /><span className="sr-only">Search analysis history</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and folders" /></label><span>{results.length} result{results.length === 1 ? "" : "s"}</span></div>{results.length ? <div className="history-table">{results.map((item) => <div className="history-row" key={item.id}><FileJson size={18} className="file-icon" /><div className="file-cell"><strong>{item.filePath.split(/[\\/]/).pop()}</strong><span>{new Date(item.analyzedAt).toLocaleString()}</span></div><RiskBadge risk={item.riskLevel} /><strong className="score-cell">{item.finalRiskScore}</strong><Link className="text-link" to="/details">View details</Link></div>)}</div> : <div className="empty-state"><FileJson size={30} /><div><strong>No matching local records</strong><p>Completed analyses will appear here with exportable evidence.</p></div></div>}</Panel></motion.div>;
}