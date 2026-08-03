import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { pageMotion } from "../animations/motion";
import { useSecurityStore } from "../store/securityStore";
import { DeviceInformationCard, HardwareCard, ProtectionCard, QuickActions, RecentActivity, ScanQueueCard, SecuritySummary, StatisticsCard, StorageCard, needsInvestigation, type AnalysisItem, type SystemOverview } from "../components/dashboard/OverviewCards";

const systemOverviewTimeoutMs = 5_000;
const DashboardCharts = lazy(() => import("../components/dashboard/DashboardCharts"));

export default function DashboardLive() {
  const navigate = useNavigate();
  const { history, scan, engineOnline, cacheEntries, downloadMonitoring, usbMonitoring, executableMonitoring } = useSecurityStore();
  const [system, setSystem] = useState<SystemOverview>();
  const [version, setVersion] = useState("Not Available");
  const [query, setQuery] = useState("");
  const [assessmentFilter, setAssessmentFilter] = useState("all");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const overview = await Promise.race([
          window.viai?.system.overview(),
          new Promise<undefined>((resolve) => window.setTimeout(resolve, systemOverviewTimeoutMs)),
        ]);
        if (active && overview) setSystem(overview as SystemOverview);
      } catch { /* Unavailable system details remain explicitly unavailable. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    void window.viai?.application.version().then((next) => { if (active) setVersion(next); });
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const aggregates = useMemo(() => buildAggregates(history as AnalysisItem[], cacheEntries, scan.cacheSkipped, scan.active), [history, cacheEntries, scan.cacheSkipped, scan.active]);
  const latest = history[0] as AnalysisItem | undefined;
  const protectionActive = engineOnline && (downloadMonitoring || usbMonitoring || executableMonitoring);
  const startFileScan = async () => { const path = await window.viai?.chooseFile(); if (path) await window.viai?.scans.start("quick", path); };
  const startFolderScan = async () => { const path = await window.viai?.chooseFolder(); if (path) await window.viai?.scans.start("folder", path); };

  return <motion.div {...pageMotion} className="page-stack security-overview-page">
    <header className="security-overview-heading"><div><p className="eyebrow">LOCAL SECURITY CONTROL CENTER</p><h2>Security Overview</h2><p>Offline endpoint visibility, local evidence, and practical next actions for this computer.</p></div><span className={protectionActive ? "overview-status healthy" : "overview-status warning"}>{protectionActive ? "Protection active" : "Protection needs review"}</span></header>
    <SecuritySummary active={protectionActive} investigations={aggregates.stats.investigated} lastScan={latest?.analyzedAt} />
    <section className="overview-primary-grid"><DeviceInformationCard system={system} /><ProtectionCard engineOnline={engineOnline} protectionEnabled={protectionActive} version={version} lastScan={latest?.analyzedAt} /></section>
    <StatisticsCard stats={aggregates.stats} />
    <Suspense fallback={null}><DashboardCharts activity={aggregates.activity} distribution={aggregates.distribution} /></Suspense>
    <section className="overview-secondary-grid"><StorageCard storage={system?.storage} /><HardwareCard system={system} /><ScanQueueCard scan={scan} /></section>
    <QuickActions onScanFile={() => void startFileScan()} onScanFolder={() => void startFolderScan()} onUpdate={() => void window.viai?.updates.check()} />
    <RecentActivity items={history as AnalysisItem[]} query={deferredQuery} onQuery={setQuery} assessmentFilter={assessmentFilter} onAssessmentFilter={setAssessmentFilter} onOpen={(id) => navigate(`/details/${id}`)} />
  </motion.div>;
}

function buildAggregates(history: AnalysisItem[], cached: number, activeSkipped: number | undefined, scanActive: boolean) {
  const extensions = { executables: new Set([".exe", ".com", ".scr", ".msi", ".msp", ".appx"]), dlls: new Set([".dll", ".ocx", ".cpl"]), drivers: new Set([".sys", ".drv"]), scripts: new Set([".ps1", ".bat", ".cmd", ".js", ".vbs", ".py", ".hta"]), documents: new Set([".doc", ".docx", ".docm", ".xls", ".xlsx", ".xlsm", ".ppt", ".pptx", ".pdf"]), archives: new Set([".zip", ".rar", ".7z", ".tar", ".gz"]), media: new Set([".mp3", ".mp4", ".mkv", ".avi", ".jpg", ".jpeg", ".png", ".gif"]) };
  const count = (group: Set<string>) => history.filter((item) => group.has(item.metadata.extension?.toLowerCase() ?? "")).length;
  const canonical = history.filter((item) => item.assessment);
  const requiresReview = canonical.filter(needsInvestigation).length;
  const stats = { total: history.length, executables: count(extensions.executables), dlls: count(extensions.dlls), drivers: count(extensions.drivers), scripts: count(extensions.scripts), documents: count(extensions.documents), archives: count(extensions.archives), media: count(extensions.media), requiresReview, investigated: requiresReview, skipped: scanActive ? activeSkipped : undefined, cached };
  const verdicts = [{ name: "LIKELY_BENIGN", color: "#3f9d72" }, { name: "SUSPICIOUS", color: "#d99b31" }, { name: "LIKELY_MALICIOUS", color: "#d35c63" }, { name: "MALICIOUS", color: "#a83953" }, { name: "UNKNOWN", color: "#8291a8" }];
  const distribution = [...verdicts.map(({ name, color }) => ({ name, value: canonical.filter((item) => item.assessment?.verdict === name).length, color })), { name: "LEGACY", value: history.length - canonical.length, color: "#8291a8" }].filter((item) => item.value > 0);
  const activity = Array.from({ length: 30 }, (_, index) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (29 - index)); return { day: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: history.filter((item) => new Date(item.analyzedAt).toDateString() === date.toDateString()).length }; });
  return { stats, distribution, activity };
}