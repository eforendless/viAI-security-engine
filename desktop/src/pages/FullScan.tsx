import { Clock3, Cpu, Pause, Play, Square, TimerReset } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button, Panel } from "../components/ui";
import { Radar } from "../components/Radar";
import { useScan } from "../hooks/useScan";
import { useSecurityStore } from "../store/securityStore";
import { pageMotion } from "../animations/motion";

export default function FullScan() {
  const { fullScan } = useScan();
  const scan = useSecurityStore((state) => state.scan);
  const performanceMode = useSecurityStore((state) => state.performanceMode);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!scan.active) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [scan.active]);
  const progress = scan.total ? (scan.completed / scan.total) * 100 : 0;
  const elapsed = scan.startedAt ? Math.max(0, now - scan.startedAt - (scan.pausedDurationMs ?? 0)) : 0;
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><p className="eyebrow">SYSTEM-WIDE REVIEW</p><h2>Full system scan</h2><p>{performanceDescription(performanceMode)}</p></div>{!scan.active && <Button className="primary" onClick={() => void fullScan()}><Play size={17} />Scan entire computer</Button>}</div><Panel className="full-scan-panel"><Radar progress={progress} active={scan.active && !scan.paused} /><div className="scan-center"><div className="scan-state"><span className={scan.active ? "pulse-dot" : "status-dot"} />{scan.active ? scan.paused ? "Scan paused" : "Local engine is analyzing" : "Ready when you are"}</div><h3>{scan.currentPath || "System locations are ready for review"}</h3><p>{scan.stage ?? (scan.active ? "Analysis continues independently from this window." : performanceDescription(performanceMode))}</p><div className="progress-track"><motion.span animate={{ width: `${progress}%` }} transition={{ ease: "easeOut" }} /></div><div className="scan-stats"><span><strong>{scan.completed.toLocaleString()}</strong> files scanned</span><span><strong>{scan.investigationCount}</strong> need investigation</span><span><strong>{scan.total ? Math.max(0, scan.total - scan.completed) : "-"}</strong> remaining</span></div><div className="scan-controls">{scan.active ? <><Button onClick={() => void (scan.paused ? window.viai?.scans.resume() : window.viai?.scans.pause())}>{scan.paused ? <Play size={16} /> : <Pause size={16} />}{scan.paused ? "Resume" : "Pause"}</Button><Button className="danger" onClick={() => void window.viai?.scans.cancel()}><Square size={15} />Cancel scan</Button></> : <Button className="primary" onClick={() => void fullScan()}><Play size={16} />Start full scan</Button>}</div></div></Panel><section className="scan-meta-grid"><Meta icon={Clock3} label="Elapsed time" value={scan.active ? formatDuration(elapsed) : "-"} /><Meta icon={TimerReset} label="Estimated remaining" value={scan.active && scan.estimatedRemainingMs !== undefined ? formatDuration(scan.estimatedRemainingMs) : "Calculating"} /><Meta icon={Cpu} label="Performance mode" value={performanceMode[0].toUpperCase() + performanceMode.slice(1)} /></section></motion.div>;
}

function Meta({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <Panel className="meta-card"><Icon size={18} /><div><span>{label}</span><strong>{value}</strong></div></Panel>; }
function performanceDescription(mode: "light" | "balanced" | "deep"): string { return mode === "light" ? "Light mode reviews important user, startup, and program-data locations." : mode === "deep" ? "Deep mode reviews every accessible file on fixed and removable drives, including AppData." : "Balanced mode reviews common user, AppData, system, and installed-program locations."; }
function formatDuration(milliseconds: number): string { const total = Math.floor(milliseconds / 1_000); return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`; }