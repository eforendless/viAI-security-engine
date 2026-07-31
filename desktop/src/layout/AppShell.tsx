import { Activity, BookOpen, Gauge, History, LayoutDashboard, ScanSearch, Settings, ShieldCheck, Zap } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { useSecurityStore } from "../store/securityStore";

const navigation = [
  ["/", "Dashboard", LayoutDashboard], ["/quick-scan", "Quick Scan", ScanSearch], ["/full-scan", "Full Scan", Gauge],
  ["/realtime", "Realtime Protection", Activity], ["/history", "History", History], ["/settings", "Settings", Settings], ["/about", "About", BookOpen],
] as const;

export function AppShell() {
  const engineOnline = useSecurityStore((state) => state.engineOnline);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><ShieldCheck size={22} /></span><span>viAI <em>Desktop</em></span></div><nav aria-label="Primary navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom"><div className="engine-pill"><span className={engineOnline ? "status-dot ready" : "status-dot"} />{engineOnline ? "Engine connected" : "Engine offline"}</div><p>Local protection, private by design.</p></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">SECURITY CENTER</p><h1>viAI Local Security</h1></div><div className="topbar-status"><Zap size={16} /><span>Realtime protection active</span></div></header><motion.div className="page-container" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Outlet /></motion.div></main>
  </div>;
}