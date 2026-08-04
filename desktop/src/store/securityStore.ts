import { create } from "zustand";
import type { EngineAnalysis, HistoryItem } from "../types";

export interface ScanState {
  id?: string;
  active: boolean;
  paused: boolean;
  cancelled: boolean;
  mode: "quick" | "full" | "folder";
  target: string;
  total: number;
  completed: number;
  investigationCount: number;
  currentPath: string;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  status?: "starting" | "running" | "pausing" | "paused" | "resuming" | "cancelling" | "completed" | "cancelled" | "failed";
  stage?: string;
  estimatedRemainingMs?: number;
  pausedDurationMs?: number;
  pausedAt?: number;
  forensicCount?: number;
  inventoryCount?: number;
  errorCount?: number;
  cacheHits?: number;
  cacheMisses?: number;
  cacheSkipped?: number;
  workersActive?: number;
  workersTotal?: number;
  throughputPerSecond?: number;
    cpuPercent?: number;
    memoryBytes?: number;
  priorityRemaining?: Partial<Record<"critical" | "high" | "medium" | "low" | "inventory", number>>;
}

interface SecurityState {
  engineOnline: boolean;
  history: HistoryItem[];
  cacheEntries: number;
  scan: ScanState;
  lastCompletedScan?: ScanState;
  downloadMonitoring: boolean;
  usbMonitoring: boolean;
  executableMonitoring: boolean;
  darkMode: boolean;
  performanceMode: "light" | "balanced" | "deep";
  threadCount: number;
  setEngineOnline(online: boolean): void;
  addHistory(analysis: EngineAnalysis): void;
  beginScan(mode: ScanState["mode"], target: string, total: number): void;
  setProgress(completed: number, currentPath: string, investigationCount: number): void;
  pauseScan(): void;
  resumeScan(): void;
  cancelScan(): void;
  finishScan(): void;
  toggleMonitoring(key: "downloadMonitoring" | "usbMonitoring" | "executableMonitoring"): void;
  setMonitoringStatus(status: Pick<SecurityState, "downloadMonitoring" | "usbMonitoring" | "executableMonitoring">): void;
  setDarkMode(value: boolean): void;
  setPerformanceMode(value: SecurityState["performanceMode"]): void;
  setThreadCount(value: number): void;
  hydrateBackground(settings: Record<string, unknown>, scan?: Record<string, unknown>, history?: unknown[], activeMonitors?: unknown[], scanCacheEntries?: unknown, lastCompletedScan?: Record<string, unknown>): void;
}

function idleScan(): ScanState { return { active: false, paused: false, cancelled: false, mode: "quick", target: "", total: 0, completed: 0, investigationCount: 0, currentPath: "", elapsedMs: 0, pausedDurationMs: 0, forensicCount: 0, inventoryCount: 0, errorCount: 0, cacheHits: 0, cacheMisses: 0, cacheSkipped: 0, workersActive: 0, workersTotal: 0, throughputPerSecond: 0 }; }

export const useSecurityStore = create<SecurityState>((set) => ({
  engineOnline: false,
  history: [],
  cacheEntries: 0,
  scan: idleScan(),
  lastCompletedScan: undefined,
  downloadMonitoring: false,
  usbMonitoring: false,
  executableMonitoring: false,
  darkMode: false,
  performanceMode: "balanced",
  threadCount: 4,
  setEngineOnline: (engineOnline) => set({ engineOnline }),
  addHistory: (analysis) => set((state) => state.history.some((item) => item.hashes.sha256 === analysis.hashes.sha256 && item.analyzedAt === analysis.analyzedAt) ? state : ({ history: [{ ...analysis, id: crypto.randomUUID() }, ...state.history].slice(0, 500) })),
  beginScan: (mode, target, total) => set({ scan: { active: true, paused: false, cancelled: false, mode, target, total, completed: 0, investigationCount: 0, currentPath: "Preparing local analysis...", startedAt: Date.now(), status: "running" } }),
  setProgress: (completed, currentPath, investigationCount) => set((state) => ({ scan: { ...state.scan, completed, currentPath, investigationCount } })),
  pauseScan: () => set((state) => ({ scan: { ...state.scan, status: "pausing" } })),
  resumeScan: () => set((state) => ({ scan: { ...state.scan, status: "resuming" } })),
  cancelScan: () => set((state) => ({ scan: { ...state.scan, status: "cancelling" } })),
  finishScan: () => set((state) => ({ scan: { ...state.scan, active: false, paused: false, currentPath: state.scan.cancelled ? "Scan cancelled" : "Local analysis complete" } })),
  toggleMonitoring: (key) => set((state) => ({ [key]: !state[key] })),
  setMonitoringStatus: (status) => set(status),
  setDarkMode: (darkMode) => set({ darkMode }),
  setPerformanceMode: (performanceMode) => set({ performanceMode }),
  setThreadCount: (threadCount) => set({ threadCount }),
  hydrateBackground: (settings, remoteScan, persistedHistory, activeMonitors, scanCacheEntries, remoteLastCompletedScan) => set((state) => {
    const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const monitors = new Set(Array.isArray(activeMonitors) ? activeMonitors.filter((monitor): monitor is string => typeof monitor === "string") : []);
    const incomingScan = remoteScan ? scanFromBackground(remoteScan, state.scan, number) : undefined;
    const incomingCompleted = incomingScan?.status === "completed" ? incomingScan : undefined;
    const hydratedCompleted = remoteLastCompletedScan ? scanFromBackground(remoteLastCompletedScan, state.lastCompletedScan ?? state.scan, number) : incomingCompleted ?? state.lastCompletedScan;
    const archivedScanId = hydratedCompleted?.id;
    const resetToIdle = incomingScan?.status === "completed" || incomingScan?.id === archivedScanId || (!incomingScan && (Boolean(remoteLastCompletedScan) || state.scan.status === "completed"));
    const hydratedScan = resetToIdle ? idleScan() : incomingScan ?? state.scan;
    return {
      darkMode: "desktopDarkMode" in settings ? settings.desktopDarkMode === true : state.darkMode,
      performanceMode: "performanceMode" in settings ? settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced" : state.performanceMode,
      threadCount: "maximumParallelScans" in settings ? number(settings.maximumParallelScans, 0) || 4 : state.threadCount,
      history: persistedHistory ? historyFromBackground(persistedHistory) : state.history,
      cacheEntries: number(scanCacheEntries, state.cacheEntries),
      downloadMonitoring: Array.isArray(activeMonitors) ? monitors.has("download-files") : state.downloadMonitoring,
      usbMonitoring: Array.isArray(activeMonitors) ? monitors.has("device-security") : state.usbMonitoring,
      executableMonitoring: Array.isArray(activeMonitors) ? monitors.has("filesystem-candidates") : state.executableMonitoring,
      scan: hydratedScan,
      lastCompletedScan: hydratedCompleted,
    };
  }),
}));

function scanFromBackground(remoteScan: Record<string, unknown>, fallback: ScanState, number: (value: unknown, fallback: number) => number): ScanState {
  const status = isScanStatus(remoteScan.status) ? remoteScan.status : undefined;
  const mode = remoteScan.mode === "quick" || remoteScan.mode === "full" || remoteScan.mode === "folder" ? remoteScan.mode : fallback.mode;
  const active = status === "starting" || status === "running" || status === "pausing" || status === "paused" || status === "resuming" || status === "cancelling";
  return { id: typeof remoteScan.id === "string" ? remoteScan.id : undefined, active, paused: status === "paused", cancelled: status === "cancelled", mode, target: typeof remoteScan.target === "string" ? remoteScan.target : "", total: number(remoteScan.totalFiles, 0), completed: number(remoteScan.filesCompleted, 0), investigationCount: number(remoteScan.investigationCount, 0), currentPath: typeof remoteScan.currentFile === "string" ? remoteScan.currentFile : "", startedAt: dateValue(remoteScan.startedAt), completedAt: dateValue(remoteScan.completedAt), elapsedMs: typeof remoteScan.elapsedMs === "number" ? number(remoteScan.elapsedMs, 0) : undefined, status, stage: typeof remoteScan.currentStage === "string" ? remoteScan.currentStage : undefined, estimatedRemainingMs: typeof remoteScan.estimatedRemainingMs === "number" ? number(remoteScan.estimatedRemainingMs, 0) : undefined, pausedDurationMs: number(remoteScan.pausedDurationMs, 0), pausedAt: dateValue(remoteScan.pausedAt), forensicCount: number(remoteScan.forensicCount, 0), inventoryCount: number(remoteScan.inventoryCount, 0), errorCount: number(remoteScan.errorCount, 0), cacheHits: number(remoteScan.cacheHits, 0), cacheMisses: number(remoteScan.cacheMisses, 0), cacheSkipped: number(remoteScan.cacheSkipped, 0), workersActive: number(remoteScan.workersActive, 0), workersTotal: number(remoteScan.workersTotal, 0), throughputPerSecond: number(remoteScan.throughputPerSecond, 0), cpuPercent: number(remoteScan.cpuPercent, 0), memoryBytes: number(remoteScan.memoryBytes, 0), priorityRemaining: priorityBuckets(remoteScan.priorityRemaining) };
}

function isScanStatus(value: unknown): value is NonNullable<ScanState["status"]> { return value === "starting" || value === "running" || value === "pausing" || value === "paused" || value === "resuming" || value === "cancelling" || value === "completed" || value === "cancelled" || value === "failed"; }
function dateValue(value: unknown): number | undefined { const parsed = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }

function priorityBuckets(value: unknown): ScanState["priorityRemaining"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const count = (band: string) => typeof source[band] === "number" && Number.isFinite(source[band]) ? Math.max(0, source[band]) : 0;
  return { critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low"), inventory: count("inventory") };
}

function historyFromBackground(records: unknown[]): HistoryItem[] {
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const source = record as { id?: unknown; kind?: unknown; occurredAt?: unknown; filePath?: unknown; fileHash?: unknown; fileExtension?: unknown; riskScore?: unknown; trustScore?: unknown; recommendation?: unknown; assessment?: unknown; baselineState?: unknown };
    const assessment = assessmentFromSummary(source.assessment);
    if (source.kind !== "scan" || typeof source.id !== "string" || typeof source.filePath !== "string" || typeof source.occurredAt !== "string" || (typeof source.riskScore !== "number" && !assessment)) return [];
    const extension = typeof source.fileExtension === "string" ? source.fileExtension : source.filePath.match(/\.[^\\/.]+$/)?.[0] ?? "";
    const score = typeof source.riskScore === "number" ? source.riskScore : assessment?.suspicion.score ?? 0;
    return [{ id: source.id, filePath: source.filePath, analyzedAt: source.occurredAt, finalRiskScore: score, trustScore: typeof source.trustScore === "number" ? source.trustScore : assessment?.trust.score ?? 0, recommendation: assessment?.recommendation ?? (typeof source.recommendation === "string" ? source.recommendation : "MONITOR"), assessment, baselineState: typeof source.baselineState === "string" ? source.baselineState : undefined, hashes: { sha256: typeof source.fileHash === "string" ? source.fileHash : "", sha1: "", md5: "" }, fileType: "", metadata: { size: 0, extension, createdAt: "", modifiedAt: "", isExecutableCandidate: false }, signatureStatus: "unknown", entropy: 0, packer: { detected: false, names: [], reasons: [] }, peMetadata: { isPe: false, imports: [], suspiciousImports: [], sections: [] }, heuristicScore: 0, reputationScore: 0, overallScore: score, confidence: assessment?.confidence.score ?? 0, riskLevel: score <= 25 ? "low" : score <= 60 ? "medium" : "high", decision: "", evidence: [] }];
  });
}

function assessmentFromSummary(value: unknown): import("../types").AssessmentSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const assessment = value as Record<string, unknown>;
  const component = (key: string) => { const value = assessment[key]; return value && typeof value === "object" && typeof (value as Record<string, unknown>).score === "number" && typeof (value as Record<string, unknown>).level === "string" ? { score: (value as Record<string, unknown>).score as number, level: (value as Record<string, unknown>).level as string } : undefined; };
  const suspicion = component("suspicion"); const trust = component("trust"); const confidence = component("confidence");
  return assessment.schemaVersion === "0.3" && typeof assessment.verdict === "string" && typeof assessment.investigationPriority === "string" && typeof assessment.recommendation === "string" && suspicion && trust && confidence ? { schemaVersion: "0.3", verdict: assessment.verdict, suspicion, trust, confidence, investigationPriority: assessment.investigationPriority, recommendation: assessment.recommendation } : undefined;
}