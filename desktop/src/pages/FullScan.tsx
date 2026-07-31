import { Clock3, Cpu, Pause, Play, Square, TimerReset } from "lucide-react";
import { motion } from "framer-motion";
import { Button, Panel } from "../components/ui";
import { Radar } from "../components/Radar";
import { useScan } from "../hooks/useScan";
import { useSecurityStore } from "../store/securityStore";
import { pageMotion } from "../animations/motion";

export default function FullScan() {
  const { fullScan } = useScan();
  const { scan, pauseScan, resumeScan, cancelScan } = useSecurityStore();
  const progress = scan.total ? (scan.completed / scan.total) * 100 : 0;
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title split-title"><div><p className="eyebrow">SYSTEM-WIDE REVIEW</p><h2>Full system scan</h2><p>Candidate executables are collected from Windows locations and analyzed by the local engine.</p></div>{!scan.active && <Button className="primary" onClick={() => void fullScan()}><Play size={17} />Scan entire computer</Button>}</div><Panel className="full-scan-panel"><Radar progress={progress} active={scan.active && !scan.paused} /><div className="scan-center"><div className="scan-state"><span className={scan.active ? "pulse-dot" : "status-dot"} />{scan.active ? scan.paused ? "Scan paused" : "Local engine is analyzing" : "Ready when you are"}</div><h3>{scan.currentPath || "System locations are ready for review"}</h3><p>{scan.active ? "Analysis runs asynchronously through the local engine API." : "Protected Windows locations and unsupported files are excluded."}</p><div className="progress-track"><motion.span animate={{ width: `${progress}%` }} transition={{ ease: "easeOut" }} /></div><div className="scan-stats"><span><strong>{scan.completed.toLocaleString()}</strong> files scanned</span><span><strong>{scan.investigationCount}</strong> need investigation</span><span><strong>{scan.total ? Math.max(0, scan.total - scan.completed) : "-"}</strong> remaining</span></div><div className="scan-controls">{scan.active ? <><Button onClick={scan.paused ? resumeScan : pauseScan}>{scan.paused ? <Play size={16} /> : <Pause size={16} />}{scan.paused ? "Resume" : "Pause"}</Button><Button className="danger" onClick={cancelScan}><Square size={15} />Cancel scan</Button></> : <Button className="primary" onClick={() => void fullScan()}><Play size={16} />Start full scan</Button>}</div></div></Panel><section className="scan-meta-grid"><Meta icon={Clock3} label="Elapsed time" value={scan.active ? "In progress" : "-"} /><Meta icon={TimerReset} label="Estimated remaining" value={scan.active ? "Calculating" : "-"} /><Meta icon={Cpu} label="Performance mode" value="Balanced" /></section></motion.div>;
}

function Meta({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <Panel className="meta-card"><Icon size={18} /><div><span>{label}</span><strong>{value}</strong></div></Panel>; }