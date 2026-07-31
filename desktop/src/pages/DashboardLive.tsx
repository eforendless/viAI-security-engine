import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowRight, Files, Radar, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Panel, RiskBadge } from "../components/ui";
import { pageMotion } from "../animations/motion";
import { motion } from "framer-motion";
import { useSecurityStore } from "../store/securityStore";

export default function DashboardLive() {
  const { history, engineOnline, downloadMonitoring, usbMonitoring, executableMonitoring } = useSecurityStore();
  const investigation = history.filter((item) => item.finalRiskScore > 25).length;
  const distribution = [
    { name: "Low", value: history.filter((item) => item.riskLevel === "low").length, color: "#4ca577" },
    { name: "Medium", value: history.filter((item) => item.riskLevel === "medium").length, color: "#e2a23d" },
    { name: "High", value: history.filter((item) => item.riskLevel === "high").length, color: "#d85d68" },
  ];
  const activity = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - offset));
    return { day: date.toLocaleDateString(undefined, { weekday: "short" }), value: history.filter((item) => new Date(item.analyzedAt).toDateString() === date.toDateString()).length };
  });
  const enabledSensors = [downloadMonitoring, usbMonitoring, executableMonitoring].filter(Boolean).length;

  return <motion.div {...pageMotion} className="page-stack">
    <section className="hero-strip"><div><p className="eyebrow">PROTECTION OVERVIEW</p><h2>{engineOnline ? "Your device is being watched." : "Connect the local engine to begin."}</h2><p>viAI evaluates local evidence to decide when deeper investigation is justified.</p></div><Link className="button primary" to="/quick-scan">Run quick scan <ArrowRight size={16} /></Link></section>
    <section className="metrics-grid"><Metric icon={ShieldCheck} label="Protection" value={engineOnline ? "Active" : "Offline"} detail={engineOnline ? "Local engine connected" : "Start the local engine service"} tone={engineOnline ? "success" : "warning"} /><Metric icon={Files} label="Files analyzed" value={history.length.toString()} detail="Stored locally in this session" tone="blue" /><Metric icon={TriangleAlert} label="Needs investigation" value={investigation.toString()} detail="Evidence warrants a closer look" tone={investigation ? "warning" : "success"} /><Metric icon={Radar} label="Monitoring" value={`${enabledSensors} / 3`} detail={`${enabledSensors} sensors enabled`} tone="indigo" /></section>
    <section className="dashboard-grid"><Panel className="chart-panel"><div className="panel-heading"><div><h3>Analysis activity</h3><p>Last seven days</p></div><span className="subtle-value">{history.length} files</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={activity}><defs><linearGradient id="activityGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#377bd6" stopOpacity={0.32} /><stop offset="100%" stopColor="#377bd6" stopOpacity={0} /></linearGradient></defs><Tooltip /><Area type="monotone" dataKey="value" stroke="#377bd6" strokeWidth={2.5} fill="url(#activityGradient)" /></AreaChart></ResponsiveContainer></div></Panel><Panel className="distribution-panel"><div className="panel-heading"><div><h3>Risk distribution</h3><p>Local analysis results</p></div></div><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={distribution} dataKey="value" innerRadius={48} outerRadius={70} paddingAngle={4} stroke="none">{distribution.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer><div className="donut-label"><strong>{history.length}</strong><span>results</span></div></div><div className="legend">{distribution.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div></Panel></section>
    <Panel className="recent-panel"><div className="panel-heading"><div><h3>Recent analyses</h3><p>Evidence is retained locally for review.</p></div><Link to="/history" className="text-link">View history <ArrowRight size={15} /></Link></div>{history.length === 0 ? <div className="empty-state"><ShieldCheck size={30} /><div><strong>No analyses yet</strong><p>Run a quick scan or wait for a monitored executable to start building local history.</p></div></div> : <div className="table-list">{history.slice(0, 4).map((item) => <div className="history-row" key={item.id}><div className="file-dot">{item.metadata.extension?.slice(1, 4) || "file"}</div><div className="file-cell"><strong>{item.filePath.split(/[\\/]/).pop()}</strong><span>{item.filePath}</span></div><RiskBadge risk={item.riskLevel} /><strong className="score-cell">{item.finalRiskScore}</strong></div>)}</div>}</Panel>
  </motion.div>;
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof ShieldCheck; label: string; value: string; detail: string; tone: string }) {
  return <motion.div className="metric-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></motion.div>;
}