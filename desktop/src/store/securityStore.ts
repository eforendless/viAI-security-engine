import { create } from "zustand";
import type { EngineAnalysis, HistoryItem } from "../types";

export interface ScanState {
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
  status?: "running" | "paused" | "completed" | "cancelled" | "failed";
  stage?: string;
  estimatedRemainingMs?: number;
  pausedDurationMs?: number;
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
  hydrateBackground(settings: Record<string, unknown>, scan?: Record<string, unknown>, history?: unknown[], activeMonitors?: unknown[], scanCacheEntries?: unknown): void;
}

const idleScan: ScanState = { active: false, paused: false, cancelled: false, mode: "quick", target: "", total: 0, completed: 0, investigationCount: 0, currentPath: "" };

export const useSecurityStore = create<SecurityState>((set) => ({
  engineOnline: false,
  history: [],
  cacheEntries: 0,
  scan: idleScan,
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
  pauseScan: () => set((state) => ({ scan: { ...state.scan, paused: true } })),
  resumeScan: () => set((state) => ({ scan: { ...state.scan, paused: false } })),
  cancelScan: () => set((state) => ({ scan: { ...state.scan, cancelled: true, paused: false } })),
  finishScan: () => set((state) => ({ scan: { ...state.scan, active: false, paused: false, currentPath: state.scan.cancelled ? "Scan cancelled" : "Local analysis complete" } })),
  toggleMonitoring: (key) => set((state) => ({ [key]: !state[key] })),
  setMonitoringStatus: (status) => set(status),
  setDarkMode: (darkMode) => set({ darkMode }),
  setPerformanceMode: (performanceMode) => set({ performanceMode }),
  setThreadCount: (threadCount) => set({ threadCount }),
  hydrateBackground: (settings, remoteScan, persistedHistory, activeMonitors, scanCacheEntries) => set((state) => {
    const status = typeof remoteScan?.status === "string" ? remoteScan.status : undefined;
    const mode = remoteScan?.mode === "quick" || remoteScan?.mode === "full" || remoteScan?.mode === "folder" ? remoteScan.mode : state.scan.mode;
    const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const scanActive = status === "running" || status === "paused";
    const monitors = new Set(Array.isArray(activeMonitors) ? activeMonitors.filter((monitor): monitor is string => typeof monitor === "string") : []);
    return {
      darkMode: "desktopDarkMode" in settings ? settings.desktopDarkMode === true : state.darkMode,
      performanceMode: "performanceMode" in settings ? settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced" : state.performanceMode,
      threadCount: "maximumParallelScans" in settings ? number(settings.maximumParallelScans, 0) || 4 : state.threadCount,
      history: persistedHistory ? historyFromBackground(persistedHistory) : state.history,
      cacheEntries: number(scanCacheEntries, state.cacheEntries),
      downloadMonitoring: Array.isArray(activeMonitors) ? monitors.has("download-files") : state.downloadMonitoring,
      usbMonitoring: Array.isArray(activeMonitors) ? monitors.has("device-security") : state.usbMonitoring,
      executableMonitoring: Array.isArray(activeMonitors) ? monitors.has("filesystem-candidates") : state.executableMonitoring,
      scan: remoteScan ? status === "cancelled" ? { ...idleScan } : { active: scanActive, paused: status === "paused", cancelled: false, mode, target: typeof remoteScan.target === "string" ? remoteScan.target : "", total: number(remoteScan.totalFiles, 0), completed: number(remoteScan.filesCompleted, 0), investigationCount: number(remoteScan.investigationCount, 0), currentPath: typeof remoteScan.currentFile === "string" ? remoteScan.currentFile : "", startedAt: typeof remoteScan.startedAt === "string" ? Date.parse(remoteScan.startedAt) : undefined, status: status as ScanState["status"], stage: typeof remoteScan.currentStage === "string" ? remoteScan.currentStage : undefined, estimatedRemainingMs: typeof remoteScan.estimatedRemainingMs === "number" ? remoteScan.estimatedRemainingMs : undefined, pausedDurationMs: number(remoteScan.pausedDurationMs, 0), forensicCount: number(remoteScan.forensicCount, 0), inventoryCount: number(remoteScan.inventoryCount, 0), errorCount: number(remoteScan.errorCount, 0), cacheHits: number(remoteScan.cacheHits, 0), cacheMisses: number(remoteScan.cacheMisses, 0), cacheSkipped: number(remoteScan.cacheSkipped, 0), workersActive: number(remoteScan.workersActive, 0), workersTotal: number(remoteScan.workersTotal, 0), throughputPerSecond: number(remoteScan.throughputPerSecond, 0), cpuPercent: number(remoteScan.cpuPercent, 0), memoryBytes: number(remoteScan.memoryBytes, 0), priorityRemaining: priorityBuckets(remoteScan.priorityRemaining) } : state.scan,
    };
  }),
}));

function priorityBuckets(value: unknown): ScanState["priorityRemaining"] {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const count = (band: string) => typeof source[band] === "number" && Number.isFinite(source[band]) ? Math.max(0, source[band]) : 0;
  return { critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low"), inventory: count("inventory") };
}

function historyFromBackground(records: unknown[]): HistoryItem[] {
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const source = record as { id?: unknown; kind?: unknown; occurredAt?: unknown; filePath?: unknown; fileHash?: unknown; fileExtension?: unknown; riskScore?: unknown; trustScore?: unknown; recommendation?: unknown };
    if (source.kind !== "scan" || typeof source.id !== "string" || typeof source.filePath !== "string" || typeof source.occurredAt !== "string" || typeof source.riskScore !== "number") return [];
    const extension = typeof source.fileExtension === "string" ? source.fileExtension : source.filePath.match(/\.[^\\/.]+$/)?.[0] ?? "";
    return [{ id: source.id, filePath: source.filePath, analyzedAt: source.occurredAt, finalRiskScore: source.riskScore, trustScore: typeof source.trustScore === "number" ? source.trustScore : 0, recommendation: typeof source.recommendation === "string" ? source.recommendation : "MONITOR", hashes: { sha256: typeof source.fileHash === "string" ? source.fileHash : "", sha1: "", md5: "" }, fileType: "", metadata: { size: 0, extension, createdAt: "", modifiedAt: "", isExecutableCandidate: false }, signatureStatus: "unknown", entropy: 0, packer: { detected: false, names: [], reasons: [] }, peMetadata: { isPe: false, imports: [], suspiciousImports: [], sections: [] }, heuristicScore: 0, reputationScore: 0, overallScore: source.riskScore, confidence: 0, riskLevel: source.riskScore <= 25 ? "low" : source.riskScore <= 60 ? "medium" : "high", decision: "", evidence: [] }];
  });
}