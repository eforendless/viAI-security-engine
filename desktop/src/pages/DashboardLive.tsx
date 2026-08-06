import { lazy, Suspense, useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { pageMotion } from "../animations/motion";
import { useSecurityStore } from "../store/securityStore";
import { assessmentHistoryFilters } from "../assessmentPresentation";
import { DeviceInformationCard, HardwareCard, ProtectionCard, QuickActions, RecentActivity, ScanQueueCard, SecuritySummary, StatisticsCard, StorageCard, type AnalysisItem, type SystemOverview } from "../components/dashboard/OverviewCards";

const systemOverviewTimeoutMs = 5_000;
const DashboardCharts = lazy(() => import("../components/dashboard/DashboardCharts"));
type TrendPeriod = "24h" | "7d" | "30d";
type RecentCategory = "all" | "needs-investigation" | "monitoring" | "no-action" | "legacy";
interface DashboardSummary { totalAssessments: number; categories: Record<Exclude<RecentCategory, "all">, number>; fileTypes: { executables: number; dlls: number; drivers: number; scripts: number; documents: number; archives: number; media: number }; cacheEntries: number; lastAssessmentAt?: string; }
interface DashboardTrendBucket { bucket: string; total: number; needsInvestigation: number; monitoring: number; noAction: number; legacy: number; }
interface DashboardRecentAssessment { id: string; occurredAt: string; filePath?: string; detail: string; recommendation?: string; assessment?: AnalysisItem["assessment"]; }
const emptySummary: DashboardSummary = { totalAssessments: 0, categories: { "needs-investigation": 0, monitoring: 0, "no-action": 0, legacy: 0 }, fileTypes: { executables: 0, dlls: 0, drivers: 0, scripts: 0, documents: 0, archives: 0, media: 0 }, cacheEntries: 0 };

export default function DashboardLive() {
  const navigate = useNavigate();
  const { scan, engineOnline, downloadMonitoring, usbMonitoring, executableMonitoring } = useSecurityStore();
  const [system, setSystem] = useState<SystemOverview>();
  const [version, setVersion] = useState("Not Available");
  const [query, setQuery] = useState("");
  const [assessmentFilter, setAssessmentFilter] = useState<RecentCategory>("all");
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [trend, setTrend] = useState<DashboardTrendBucket[]>([]);
  const [recent, setRecent] = useState<DashboardRecentAssessment[]>([]);
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("30d");
  const [revision, setRevision] = useState(0);
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

  useEffect(() => window.viai?.background.onChanged(() => setRevision((current) => current + 1)), []);
  useEffect(() => { let active = true; void window.viai?.background.dashboardSummary().then((value) => { if (active && value) setSummary(value as DashboardSummary); }); return () => { active = false; }; }, [revision]);
  useEffect(() => { let active = true; void window.viai?.background.assessmentTrend(trendPeriod).then((value) => { if (active && Array.isArray(value)) setTrend(value as DashboardTrendBucket[]); }); return () => { active = false; }; }, [revision, trendPeriod]);
  useEffect(() => { let active = true; void window.viai?.background.recentAssessments({ limit: 8, search: deferredQuery, category: assessmentFilter }).then((value) => { if (active && Array.isArray(value)) setRecent(value as DashboardRecentAssessment[]); }); return () => { active = false; }; }, [revision, deferredQuery, assessmentFilter]);

  const stats = { total: summary.totalAssessments, ...summary.fileTypes, requiresReview: summary.categories["needs-investigation"], investigated: summary.categories["needs-investigation"], skipped: scan.active ? scan.cacheSkipped : undefined, cached: summary.cacheEntries };
  const distribution = categoryDistribution(summary);
  const activity = trend.map((bucket) => ({ day: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: trendPeriod === "24h" ? "numeric" : undefined }).format(new Date(bucket.bucket)), value: bucket.total }));
  const recentItems: AnalysisItem[] = recent.map((item) => ({ id: item.id, filePath: item.filePath ?? item.detail, analyzedAt: item.occurredAt, finalRiskScore: 0, riskLevel: "low", recommendation: item.recommendation ?? "MONITOR", assessment: item.assessment, metadata: {} }));
  const protectionActive = engineOnline && (downloadMonitoring || usbMonitoring || executableMonitoring);
  const startFileScan = async () => { const path = await window.viai?.chooseFile(); if (path) await window.viai?.scans.start("quick", path); };
  const startFolderScan = async () => { const path = await window.viai?.chooseFolder(); if (path) await window.viai?.scans.start("folder", path); };

  return <motion.div {...pageMotion} className="page-stack security-overview-page">
    <header className="security-overview-heading"><div><p className="eyebrow">LOCAL SECURITY CONTROL CENTER</p><h2>Security Overview</h2><p>Offline endpoint visibility, local evidence, and practical next actions for this computer.</p></div><span className={protectionActive ? "overview-status healthy" : "overview-status warning"}>{protectionActive ? "Protection active" : "Protection needs review"}</span></header>
    <SecuritySummary active={protectionActive} investigations={stats.investigated} lastScan={summary.lastAssessmentAt} />
    <section className="overview-primary-grid"><DeviceInformationCard system={system} /><ProtectionCard engineOnline={engineOnline} protectionEnabled={protectionActive} version={version} lastScan={summary.lastAssessmentAt} /></section>
    <StatisticsCard stats={stats} />
    <Suspense fallback={null}><DashboardCharts activity={activity} distribution={distribution} period={trendPeriod} onPeriodChange={setTrendPeriod} /></Suspense>
    <section className="overview-secondary-grid"><StorageCard storage={system?.storage} /><HardwareCard system={system} /><ScanQueueCard scan={scan} /></section>
    <QuickActions onScanFile={() => void startFileScan()} onScanFolder={() => void startFolderScan()} onUpdate={() => void window.viai?.updates.check()} />
    <RecentActivity items={recentItems} query={deferredQuery} onQuery={setQuery} assessmentFilter={assessmentFilter} onAssessmentFilter={(value) => setAssessmentFilter(value as RecentCategory)} onOpen={(id) => navigate(`/details/${id}`)} />
  </motion.div>;
}

function categoryDistribution(summary: DashboardSummary): Array<{ name: string; value: number; color: string }> {
  const labels = new Map(assessmentHistoryFilters.map((filter) => [filter.value, filter.label]));
  return [
    { category: "no-action" as const, color: "#3f9d72" },
    { category: "monitoring" as const, color: "#397ec1" },
    { category: "needs-investigation" as const, color: "#d35c63" },
    { category: "legacy" as const, color: "#8291a8" },
  ].map(({ category, color }) => ({ name: category === "legacy" ? "Earlier reports" : labels.get(category) ?? "Assessment", value: summary.categories[category], color })).filter((entry) => entry.value > 0);
}