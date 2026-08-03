import { Activity, BookOpen, Gauge, History, LayoutDashboard, Maximize2, Minus, ScanSearch, Settings, Usb, X, Zap } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { motion } from "framer-motion";
import { useSecurityStore } from "../store/securityStore";

const navigation = [
  ["/", "Dashboard", LayoutDashboard], ["/quick-scan", "Quick Scan", ScanSearch], ["/full-scan", "Full Scan", Gauge],
  ["/realtime", "Realtime Protection", Activity], ["/device-security", "Device Security", Usb], ["/history", "History", History], ["/settings", "Settings", Settings], ["/about", "About", BookOpen],
] as const;
const appIcon = `${import.meta.env.BASE_URL}viai-logodone.png`;

export function AppShell() {
  const engineOnline = useSecurityStore((state) => state.engineOnline);
  const monitoringActive = useSecurityStore((state) => state.downloadMonitoring || state.usbMonitoring || state.executableMonitoring);
  const controls = window.viai?.windowControls;
  return <div className="desktop-window">
    <header className="window-titlebar">
      <div className="window-titlebar-brand"><span className="window-titlebar-mark"><img src={appIcon} alt="" /></span><span>viAI security</span></div>
      <div className="window-controls" aria-label="Window controls">
        <button type="button" className="window-control" aria-label="Minimize window" title="Minimize" onClick={() => void controls?.minimize()}><Minus size={16} strokeWidth={1.8} /></button>
        <button type="button" className="window-control" aria-label="Maximize or restore window" title="Maximize or restore" onClick={() => void controls?.maximize()}><Maximize2 size={14} strokeWidth={1.8} /></button>
        <button type="button" className="window-control close" aria-label="Close window" title="Close" onClick={() => void controls?.close()}><X size={17} strokeWidth={1.8} /></button>
      </div>
    </header>
    <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><img src={appIcon} alt="" /></span><span>viAI security</span></div><nav aria-label="Primary navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}><Icon size={18} /><span>{label}</span></NavLink>)}</nav><div className="sidebar-bottom"><div className="engine-pill"><span className={engineOnline ? "status-dot ready" : "status-dot"} />{engineOnline ? "Engine connected" : "Engine offline"}</div><p>Local protection, private by design.</p><div className="sidebar-legal"><Link to="/legal/terms">Terms of Service</Link><Link to="/legal/privacy">Privacy Policy</Link></div></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">SECURITY CENTER</p><h1>viAI Local Security</h1></div><div className="topbar-status"><Zap size={16} /><span>{engineOnline && monitoringActive ? "Realtime protection active" : "Protection needs review"}</span></div></header><motion.div className="page-container" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Outlet /></motion.div></main>
    </div>
  </div>;
}