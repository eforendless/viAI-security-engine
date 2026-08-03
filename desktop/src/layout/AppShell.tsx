import { Activity, BookOpen, Gauge, History, LayoutDashboard, Maximize2, Minus, ScanSearch, Settings, Usb, X, Zap } from "lucide-react";
import { Suspense, useEffect, useRef } from "react";
import { Link, NavLink, useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useSecurityStore } from "../store/securityStore";

const navigation = [
  ["/", "Dashboard", LayoutDashboard], ["/quick-scan", "Quick Scan", ScanSearch], ["/full-scan", "Full Scan", Gauge],
  ["/realtime", "Realtime Protection", Activity], ["/device-security", "Device Security", Usb], ["/history", "History", History], ["/settings", "Settings", Settings], ["/about", "About", BookOpen],
] as const;
const appIcon = `${import.meta.env.BASE_URL}viai-logodone.png`;
const pageOrder = navigation.map(([path]) => path);

function pageIndex(pathname: string): number {
  const direct = pageOrder.indexOf(pathname as typeof pageOrder[number]);
  return direct >= 0 ? direct : pathname.startsWith("/details/") ? pageOrder.indexOf("/history") : 0;
}

function NavigationSkeleton() {
  return <motion.div className="navigation-skeleton" role="status" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
    <div className="skeleton navigation-skeleton-heading" />
    <div className="navigation-skeleton-grid"><div className="skeleton" /><div className="skeleton" /></div>
    <div className="skeleton navigation-skeleton-panel" />
  </motion.div>;
}

export function AppShell() {
  const engineOnline = useSecurityStore((state) => state.engineOnline);
  const monitoringActive = useSecurityStore((state) => state.downloadMonitoring || state.usbMonitoring || state.executableMonitoring);
  const controls = window.viai?.windowControls;
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();
  const previousPath = useRef(location.pathname);
  const direction = pageIndex(location.pathname) >= pageIndex(previousPath.current) ? 1 : -1;
  useEffect(() => { previousPath.current = location.pathname; }, [location.pathname]);
  const pageTransition = reduceMotion ? { duration: 0.12 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };
  const pageVariants = {
    initial: (travel: number) => reduceMotion ? { opacity: 0 } : { opacity: 0, x: travel * 14, scale: 0.992 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: (travel: number) => reduceMotion ? { opacity: 0 } : { opacity: 0, x: travel * -8, scale: 0.996 },
  };
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
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><img src={appIcon} alt="" /></span><span>viAI security</span></div><nav aria-label="Primary navigation">{navigation.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>{({ isActive }) => <><Icon size={18} /><span>{label}</span>{isActive && <motion.i className="nav-active-indicator" layoutId="active-navigation" transition={pageTransition} aria-hidden="true" />}</>}</NavLink>)}</nav><div className="sidebar-bottom"><div className="engine-pill"><span className={engineOnline ? "status-dot ready" : "status-dot"} />{engineOnline ? "Engine connected" : "Engine offline"}</div><p>Local protection, private by design.</p><div className="sidebar-legal"><Link to="/legal/terms">Terms of Service</Link><Link to="/legal/privacy">Privacy Policy</Link></div></div></aside>
    <main className="main-content"><header className="topbar"><div><p className="eyebrow">SECURITY CENTER</p><h1>viAI Local Security</h1></div><div className="topbar-status"><Zap size={16} /><span>{engineOnline && monitoringActive ? "Realtime protection active" : "Protection needs review"}</span></div></header><div className="page-container route-transition"><AnimatePresence initial={false} mode="popLayout" custom={direction}><motion.div key={location.pathname} className="route-page" custom={direction} variants={pageVariants} initial="initial" animate="animate" exit="exit" transition={pageTransition}><Suspense fallback={<NavigationSkeleton />}>{outlet}</Suspense></motion.div></AnimatePresence></div></main>
    </div>
  </div>;
}