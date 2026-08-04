import { Clock3, Cpu, Database, Gauge, Layers3, Pause, Play, Square, TimerReset, Zap } from "lucide-react";
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
  const [insightTab, setInsightTab] = useState<"scheduler" | "performance">("scheduler");
  const [now, setNow] = useState(Date.now());
  const [showCancellationNotice, setShowCancellationNotice] = useState(false);
  useEffect(() => { if (!scan.active) return; const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => window.clearInterval(timer); }, [scan.active]);
  useEffect(() => {
    if (scan.status !== "cancelled" && !scan.cancelled) return;
    setShowCancellationNotice(true);
    const timer = window.setTimeout(() => setShowCancellationNotice(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [scan.cancelled, scan.status]);
  const isCompleted = scan.status === "completed";
  const isCancelled = scan.status === "cancelled" || scan.cancelled;
  const isFailed = scan.status === "failed";
  const hasSummary = scan.active || isCompleted || isCancelled || isFailed;
  const progress = isCompleted ? 100 : hasSummary && scan.total ? (scan.completed / scan.total) * 100 : 0;
  const elapsed = isCompleted ? scan.elapsedMs ?? scanElapsed(scan, scan.completedAt ?? now) : scan.active ? scanElapsed(scan, now) : 0;
  const cacheTotal = hasSummary ? (scan.cacheHits ?? 0) + (scan.cacheMisses ?? 0) : 0;
  const cacheHitRate = cacheTotal ? `${Math.round(((scan.cacheHits ?? 0) / cacheTotal) * 100)}%` : "-";
  const remaining = isCompleted ? 0 : hasSummary && scan.total ? Math.max(0, scan.total - scan.completed) : 0;
  const isPausing = scan.status === "pausing";
  const isPaused = scan.status === "paused";
  const isResuming = scan.status === "resuming";
  const isCancelling = scan.status === "cancelling";
  const scanState = isCompleted ? "Scan completed" : isFailed ? "Scan failed" : isCancelled ? "Scan cancelled" : isCancelling ? "Cancelling scan" : isPausing ? "Pausing scan" : isPaused ? "Scan paused" : isResuming ? "Resuming scan" : scan.active ? "Local engine is analyzing" : showCancellationNotice ? "Scan cancelled" : "Ready when you are";
  return <motion.div {...pageMotion} className="page-stack">
    <div className="page-title split-title">
      <div><p className="eyebrow">SYSTEM-WIDE REVIEW</p><h2>Full system scan</h2><p>{performanceDescription(performanceMode)}</p></div>
      {!scan.active && <Button className="primary" onClick={() => void fullScan()}><Play size={17} />{isCompleted ? "Scan again" : "Scan entire computer"}</Button>}
    </div>
    <Panel className="full-scan-panel">
      <Radar progress={progress} active={scan.active && !isPaused && !isPausing && !isCancelling} />
      <div className="scan-center">
        <div className="scan-state"><span className={scan.active && !isPaused && !isCancelling ? "pulse-dot" : "status-dot"} />{scanState}</div>
        <h3>{hasSummary ? scan.currentPath || "Preparing local analysis" : "System locations are ready for review"}</h3>
        <p>{scan.stage ?? (scan.active ? "Analysis continues independently from this window." : isCompleted ? "Final scan results are retained until you start another scan." : performanceDescription(performanceMode))}</p>
        <div className="progress-track"><motion.span animate={{ scaleX: progress / 100 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} /></div>
        <div className="scan-stats"><span><strong>{hasSummary ? scan.completed.toLocaleString() : "0"}</strong> files scanned</span><span><strong>{hasSummary ? scan.investigationCount : 0}</strong> need investigation</span><span><strong>{remaining.toLocaleString()}</strong> remaining</span></div>
        <div className="scan-controls">
          {scan.active ? <>{!isCancelling && <Button disabled={isPausing || isResuming} onClick={() => void (isPaused ? window.viai?.scans.resume() : window.viai?.scans.pause())}>{isPaused ? <Play size={16} /> : <Pause size={16} />}{isPaused ? "Resume" : isPausing ? "Pausing..." : isResuming ? "Resuming..." : "Pause"}</Button>}<Button className="danger" disabled={isCancelling} onClick={() => void window.viai?.scans.cancel()}><Square size={15} />{isCancelling ? "Cancelling..." : "Cancel scan"}</Button></> : <Button className="primary" onClick={() => void fullScan()}><Play size={16} />{isCompleted ? "Scan again" : "Start full scan"}</Button>}
        </div>
      </div>
    </Panel>
    <section className="scan-meta-grid">
      <Meta icon={Clock3} label="Elapsed time" value={scan.startedAt && (scan.active || isCompleted) ? formatDuration(elapsed) : "-"} />
      <Meta icon={TimerReset} label="Estimated remaining" value={isCompleted ? "Completed" : isCancelled ? "Cancelled" : isFailed ? "Unavailable" : scan.active && scan.estimatedRemainingMs !== undefined ? formatDuration(scan.estimatedRemainingMs) : "-"} />
      <Meta icon={Cpu} label="Process CPU" value={scan.active ? `${scan.cpuPercent ?? 0}%` : "-"} />
      <Meta icon={Database} label="Process memory" value={scan.active ? formatBytes(scan.memoryBytes ?? 0) : "-"} />
      <Meta icon={Gauge} label="Current throughput" value={scan.active ? `${scan.throughputPerSecond ?? 0} files/s` : "-"} />
    </section>
    <Panel className="scan-insights-panel">
      <div className="scan-insights-header">
        <div>
          <div className="scan-state">{insightTab === "scheduler" ? <Database size={16} /> : <Gauge size={16} />}{insightTab === "scheduler" ? "Intelligent scheduler" : "Performance level"}</div>
          <h3>{insightTab === "scheduler" ? "Live queue and analysis capacity" : `${performanceLabel(performanceMode)} scan profile`}</h3>
        </div>
        <div className="scan-insight-tabs" role="tablist" aria-label="Full scan insights">
          <button type="button" className={insightTab === "scheduler" ? "active" : ""} role="tab" aria-selected={insightTab === "scheduler"} onClick={() => setInsightTab("scheduler")}><Layers3 size={15} />Scheduler</button>
          <button type="button" className={insightTab === "performance" ? "active" : ""} role="tab" aria-selected={insightTab === "performance"} onClick={() => setInsightTab("performance")}><Zap size={15} />Performance</button>
        </div>
      </div>
      {insightTab === "scheduler" ? <div className="scheduler-insights" role="tabpanel">
        <dl className="scheduler-metrics">
          <div><dt>Workers</dt><dd>{scan.active ? scan.workersActive ?? 0 : 0} <span>/ {hasSummary ? scan.workersTotal ?? 0 : 0} active</span></dd></div>
          <div><dt>Cache hit rate</dt><dd>{cacheHitRate}</dd></div>
          <div><dt>Unchanged skipped</dt><dd>{hasSummary ? scan.cacheSkipped ?? 0 : 0}</dd></div>
          <div><dt>Forensic analyzed</dt><dd>{hasSummary ? scan.forensicCount ?? 0 : 0}</dd></div>
          <div><dt>Unavailable files</dt><dd>{hasSummary ? scan.errorCount ?? 0 : 0}</dd></div>
        </dl>
        <div className="priority-queue" aria-label="Priority queue">
          <span><i className="critical" />Critical <strong>{hasSummary ? scan.priorityRemaining?.critical ?? 0 : 0}</strong></span>
          <span><i className="high" />High <strong>{hasSummary ? scan.priorityRemaining?.high ?? 0 : 0}</strong></span>
          <span><i className="medium" />Medium <strong>{hasSummary ? scan.priorityRemaining?.medium ?? 0 : 0}</strong></span>
          <span><i className="low" />Low and inventory <strong>{hasSummary ? (scan.priorityRemaining?.low ?? 0) + (scan.priorityRemaining?.inventory ?? 0) : 0}</strong></span>
        </div>
      </div> : <div className="performance-insights" role="tabpanel">
        <div className={`performance-emblem ${performanceMode}`}><Gauge size={25} /></div>
        <div className="performance-copy"><span>Active profile</span><strong>{performanceLabel(performanceMode)}</strong><p>{performanceDescription(performanceMode)}</p></div>
        <dl className="performance-details">
          <div><dt>Scan depth</dt><dd>{performanceMode === "light" ? "Focused locations" : performanceMode === "deep" ? "All accessible files" : "Common locations"}</dd></div>
          <div><dt>Worker allocation</dt><dd>{performanceMode === "light" ? "1 worker" : performanceMode === "deep" ? "Up to 8 workers" : "Up to 4 workers"}</dd></div>
        </dl>
      </div>}
    </Panel>
  </motion.div>;
}

function Meta({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <Panel className="meta-card"><Icon size={18} /><div><span>{label}</span><strong>{value}</strong></div></Panel>; }
function scanElapsed(scan: { startedAt?: number; pausedDurationMs?: number; pausedAt?: number }, now: number): number { return scan.startedAt ? Math.max(0, now - scan.startedAt - (scan.pausedDurationMs ?? 0) - (scan.pausedAt ? Math.max(0, now - scan.pausedAt) : 0)) : 0; }
function performanceLabel(mode: "light" | "balanced" | "deep"): string { return mode.charAt(0).toUpperCase() + mode.slice(1); }
function performanceDescription(mode: "light" | "balanced" | "deep"): string { return mode === "light" ? "Light mode reviews important user, startup, and program-data locations." : mode === "deep" ? "Deep mode reviews every accessible file on fixed and removable drives, including AppData." : "Balanced mode reviews common user, AppData, system, and installed-program locations."; }
function formatDuration(milliseconds: number): string { const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000)); const hours = Math.floor(totalSeconds / 3_600); const minutes = Math.floor(totalSeconds % 3_600 / 60); const seconds = totalSeconds % 60; return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`; }
function formatBytes(bytes: number): string { return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "-"; }