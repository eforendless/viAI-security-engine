import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ScanCacheEntry } from "./fileClassification";

type SettingValue = boolean | string | number | string[];
export type BackgroundSettings = Record<string, SettingValue>;
export type EngineMonitoringUpdate = Record<string, boolean | readonly string[]>;

export interface BackgroundHistoryRecord {
  id: string;
  kind: "scan" | "realtime-event" | "trust-evaluation" | "rule-match";
  occurredAt: string;
  fileHash?: string;
  filePath?: string;
  riskScore?: number;
  trustScore?: number;
  recommendation?: string;
  matchedRules?: string[];
  engineVersion: string;
  detail: string;
  report?: Record<string, unknown>;
  trustIndicators?: string[];
  scanDurationMs?: number;
  scanType?: "quick" | "full" | "folder" | "single-file" | "realtime";
}

export type ScanStatus = "running" | "paused" | "completed" | "cancelled" | "failed";

export interface PersistedScanState {
  id: string;
  mode: "quick" | "full" | "folder";
  target: string;
  startedAt: string;
  updatedAt: string;
  currentFile: string;
  filesCompleted: number;
  filesRemaining: number;
  totalFiles: number;
  progress: number;
  currentStage: string;
  status: ScanStatus;
  investigationCount: number;
  pausedAt?: string;
  pausedDurationMs: number;
  estimatedRemainingMs?: number;
  forensicCount?: number;
  inventoryCount?: number;
  errorCount?: number;
  cacheHits?: number;
  cacheMisses?: number;
  cacheSkipped?: number;
  workersActive?: number;
  workersTotal?: number;
  peakQueueLength?: number;
  throughputPerSecond?: number;
  cpuPercent?: number;
  memoryBytes?: number;
  priorityRemaining?: Partial<Record<"critical" | "high" | "medium" | "low" | "inventory", number>>;
  pendingFiles: string[];
}

export interface BackgroundSnapshot {
  settings: BackgroundSettings;
  history: BackgroundHistoryRecord[];
  activeMonitors: string[];
  activeScan?: Omit<PersistedScanState, "pendingFiles">;
}

interface StoredBackgroundState { settings?: unknown; history?: unknown; activeScan?: unknown; }
export interface SaveScanOptions { persist?: boolean; publish?: boolean; }
export type HistoryClearScope = "all" | "low" | "medium" | "high";

export const recommendedSettings: BackgroundSettings = Object.freeze({
  backgroundProtection: true, runAfterWindowCloses: true, launchOnStartup: true, startMinimized: false, startSilently: false, openDashboardAfterStartup: true, minimizeToTray: true, windowsNotifications: true, soundNotifications: false, desktopDarkMode: false,
  monitorFileCreation: true, monitorFileModification: true, monitorFileRename: true, monitorFileDeletion: false, monitorDownloads: true, monitorDesktop: false, monitorDocuments: false, monitorUsbStorage: true, monitorNetworkShares: false,
  scanExecutables: true, scanDlls: true, scanScripts: true, scanOfficeDocuments: false, scanArchives: false, scanPdfs: false, scanInstallers: true, scanShortcuts: false, scanBatchFiles: true, scanPowerShellScripts: true, scanJavaScriptFiles: true, scanPythonScripts: false, scanUnknownFileTypes: false,
  automaticDownloadScan: true, scanBrowserDownloads: true, scanTorrentDownloads: false, scanCompressedDownloads: false, delayExecutionUntilScanCompletes: false,
  monitorUsbInsertion: true, automaticallyScanUsb: true, monitorExternalSsd: true, monitorExternalHdd: true, monitorSdCards: true, monitorSmartphones: false, monitorUnknownUsbDevices: true,
  monitorNewProcesses: false, monitorChildProcesses: false, monitorSuspiciousCommandLines: false, monitorPowerShell: false, monitorCmd: false, monitorWScript: false, monitorMshta: false,
  monitorStartupFolder: false, monitorScheduledTasks: false, monitorRegistryRunKeys: false, monitorServices: false, monitorDrivers: false,
  notifySafeScan: false, notifyMediumRisk: true, notifyHighRisk: true, notifyUsbConnected: true, notifyUsbRemoved: true, notifyBackgroundStarted: true, notifyBackgroundStopped: false, notifyEngineUpdates: true, notifyScanCompleted: true,
  mediumRiskAction: "sandbox", highRiskAction: "ai", performanceMode: "balanced", scanPriority: "normal", maximumParallelScans: 0,
  customFolders: [], excludedFolders: [], excludedFiles: [], excludedExtensions: [], excludedProcesses: [],
});

export const factorySettings: BackgroundSettings = Object.freeze({ ...recommendedSettings, backgroundProtection: false, runAfterWindowCloses: false, launchOnStartup: false, minimizeToTray: false, automaticDownloadScan: false, automaticallyScanUsb: false, windowsNotifications: false });

export class BackgroundService {
  private settings: BackgroundSettings = { ...recommendedSettings };
  private history: BackgroundHistoryRecord[] = [];
  private legacyHistory: BackgroundHistoryRecord[] = [];
  private historyLoaded = false;
  private activeMonitors: string[] = [];
  private activeScan?: PersistedScanState;
  private mutation: Promise<void> = Promise.resolve();
  private readonly historyPath: string;
  private readonly scanCachePath: string;
  private readonly scanCache = new Map<string, ScanCacheEntry>();
  private scanCacheDirty = false;
  private historyDirty = false;
  private historyFlushTimer: NodeJS.Timeout | undefined;

  constructor(private readonly dataPath: string, private readonly applyEngineMonitoring: (updates: EngineMonitoringUpdate) => Promise<void>, private readonly onChanged: (snapshot: BackgroundSnapshot) => void) { this.historyPath = join(dirname(dataPath), "background-history.json"); this.scanCachePath = join(dirname(dataPath), "scan-cache.json"); }

  async initialize(): Promise<BackgroundSnapshot> {
    const stored = await this.read();
    this.settings = validateSettings(stored.settings);
    this.legacyHistory = validateHistory(stored.history);
    this.activeScan = validateScan(stored.activeScan);
    await this.loadScanCache();
    await this.apply();
    return this.snapshot();
  }

  snapshot(): BackgroundSnapshot { return { settings: { ...this.settings }, history: [...this.history], activeMonitors: [...this.activeMonitors], activeScan: this.activeScan ? publicScan(this.activeScan) : undefined }; }
  currentScan(): PersistedScanState | undefined { return this.activeScan ? { ...this.activeScan, pendingFiles: [...this.activeScan.pendingFiles] } : undefined; }
  async update(changes: Record<string, unknown>): Promise<BackgroundSnapshot> { return this.enqueue(async () => { this.settings = validateSettings({ ...this.settings, ...changes }); await this.apply(); await this.persist(); return this.publish(); }); }
  async restoreRecommended(): Promise<BackgroundSnapshot> { return this.enqueue(async () => { this.settings = { ...recommendedSettings }; await this.apply(); await this.persist(); return this.publish(); }); }
  async restoreFactory(): Promise<BackgroundSnapshot> { return this.enqueue(async () => { this.settings = { ...factorySettings }; await this.apply(); await this.persist(); return this.publish(); }); }
  exportSettings(): string { return JSON.stringify(this.settings, null, 2); }
  async importSettings(serialized: string): Promise<BackgroundSnapshot> { return this.enqueue(async () => { this.settings = validateSettings(JSON.parse(serialized)); await this.apply(); await this.persist(); return this.publish(); }); }
  async clearHistory(scope: HistoryClearScope = "all"): Promise<void> { await this.enqueue(async () => { await this.ensureHistoryLoaded(); this.history = scope === "all" ? [] : this.history.filter((record) => riskLevel(record.riskScore) !== scope); await this.persistHistory(); this.publish(); }); }
  async clearAllData(): Promise<void> { await this.enqueue(async () => { this.settings = { ...factorySettings }; this.history = []; this.legacyHistory = []; this.historyLoaded = true; this.historyDirty = false; this.activeScan = undefined; this.scanCache.clear(); this.scanCacheDirty = false; await this.apply(); await rm(this.dataPath, { force: true }); await rm(this.historyPath, { force: true }); await rm(this.scanCachePath, { force: true }); this.publish(); }); }
  async loadHistory(): Promise<BackgroundSnapshot> { return this.enqueue(async () => { await this.ensureHistoryLoaded(); await this.persist(); return this.publish(); }); }
  async saveScan(scan: PersistedScanState | undefined, options: SaveScanOptions = {}): Promise<BackgroundSnapshot> { return this.enqueue(async () => { this.activeScan = scan ? { ...scan, pendingFiles: [...scan.pendingFiles] } : undefined; if (options.persist !== false) await this.persist(); return options.publish === false ? this.snapshot() : this.publish(); }); }
  scanCacheEntry(filePath: string): ScanCacheEntry | undefined { return this.scanCache.get(cacheKey(filePath)); }
  recordScanCache(filePath: string, entry: ScanCacheEntry): void { this.scanCache.set(cacheKey(filePath), entry); this.scanCacheDirty = true; }
  async flushScanCache(): Promise<void> { await this.enqueue(async () => { if (!this.scanCacheDirty) return; await mkdir(dirname(this.scanCachePath), { recursive: true }); const temporary = `${this.scanCachePath}.tmp`; await writeFile(temporary, JSON.stringify(Object.fromEntries(this.scanCache)), "utf8"); await rename(temporary, this.scanCachePath); this.scanCacheDirty = false; }); }

  async recordAnalysis(body: unknown, scanType: BackgroundHistoryRecord["scanType"] = "single-file", scanDurationMs?: number, deferPersistence = false): Promise<void> {
    const analysis = analysisRecord(body);
    if (!analysis) return;
    await this.enqueue(async () => {
      await this.ensureHistoryLoaded();
      const matchedRules = Array.isArray(analysis.staticAnalysisReport?.matchedRules) ? (analysis.staticAnalysisReport.matchedRules as unknown[]).map((entry: unknown) => typeof entry === "object" && entry && typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : undefined).filter((id: string | undefined): id is string => Boolean(id)) : [];
      const report = cloneRecord(analysis);
      const trustIndicators = [typeof analysis.signatureStatus === "string" ? `Signature status: ${analysis.signatureStatus}` : undefined, typeof analysis.signaturePublisher === "string" ? `Publisher: ${analysis.signaturePublisher}` : undefined].filter((value): value is string => Boolean(value));
      this.history = [{ id: crypto.randomUUID(), kind: "scan", occurredAt: typeof analysis.analyzedAt === "string" ? analysis.analyzedAt : new Date().toISOString(), fileHash: analysis.hashes?.sha256, filePath: analysis.filePath, riskScore: analysis.finalRiskScore, trustScore: analysis.trustScore, recommendation: analysis.recommendation, matchedRules, engineVersion: "0.1.6", detail: `Static analysis completed: ${analysis.recommendation ?? "MONITOR"}`, report, trustIndicators, scanType, scanDurationMs }, ...this.history.filter((record) => !(record.kind === "scan" && record.fileHash === analysis.hashes?.sha256 && record.occurredAt === analysis.analyzedAt))];
      if (deferPersistence) {
        this.historyDirty = true;
        this.scheduleHistoryFlush();
      } else {
        await this.persistHistory();
        this.publish();
      }
    });
  }

  async flushHistory(publish = true): Promise<void> {
    if (this.historyFlushTimer) {
      clearTimeout(this.historyFlushTimer);
      this.historyFlushTimer = undefined;
    }
    await this.enqueue(async () => {
      if (this.historyDirty) {
        await this.persistHistory();
        this.historyDirty = false;
      }
      if (publish) this.publish();
    });
  }

  async recordEvent(detail: string, id: string = crypto.randomUUID()): Promise<void> { await this.enqueue(async () => { await this.ensureHistoryLoaded(); if (this.history.some((record) => record.id === id)) return; this.history = [{ id, kind: "realtime-event", occurredAt: new Date().toISOString(), engineVersion: "0.1.6", detail }, ...this.history]; await this.persistHistory(); this.publish(); }); }

  private async apply(): Promise<void> {
    const enabled = this.settings.backgroundProtection === true;
    const downloads = enabled && this.settings.monitorDownloads === true && this.settings.automaticDownloadScan === true;
    const directories = monitoredDirectories(this.settings);
    const extensions = monitoredExtensions(this.settings);
    const eventMonitoring = this.settings.monitorFileCreation === true || this.settings.monitorFileModification === true || this.settings.monitorFileRename === true;
    const filesystem = enabled && directories.length > 0 && (extensions.length > 0 || this.settings.scanUnknownFileTypes === true) && eventMonitoring;
    await this.applyEngineMonitoring({
      downloadMonitoring: downloads,
      executableMonitoring: filesystem,
      usbMonitoring: false,
      executableDirectories: directories,
      executableExtensions: extensions,
      excludedFolders: strings(this.settings.excludedFolders),
      excludedFiles: strings(this.settings.excludedFiles),
      excludedExtensions: strings(this.settings.excludedExtensions),
      scanUnknownFileTypes: this.settings.scanUnknownFileTypes === true,
      reportCreated: this.settings.monitorFileCreation === true || this.settings.monitorFileRename === true,
      reportModified: this.settings.monitorFileModification === true,
      processMonitoring: this.settings.monitorNewProcesses === true || this.settings.monitorChildProcesses === true || this.settings.monitorSuspiciousCommandLines === true || this.settings.monitorPowerShell === true || this.settings.monitorCmd === true || this.settings.monitorWScript === true || this.settings.monitorMshta === true,
      monitorNewProcesses: this.settings.monitorNewProcesses === true,
      monitorChildProcesses: this.settings.monitorChildProcesses === true,
      monitorSuspiciousCommandLines: this.settings.monitorSuspiciousCommandLines === true,
      monitorPowerShell: this.settings.monitorPowerShell === true,
      monitorCmd: this.settings.monitorCmd === true,
      monitorWScript: this.settings.monitorWScript === true,
      monitorMshta: this.settings.monitorMshta === true,
      excludedProcesses: strings(this.settings.excludedProcesses),
      windowsMonitoring: this.settings.monitorScheduledTasks === true || this.settings.monitorRegistryRunKeys === true || this.settings.monitorServices === true || this.settings.monitorDrivers === true,
      monitorScheduledTasks: this.settings.monitorScheduledTasks === true,
      monitorRegistryRunKeys: this.settings.monitorRegistryRunKeys === true,
      monitorServices: this.settings.monitorServices === true,
      monitorDrivers: this.settings.monitorDrivers === true,
    });
    this.activeMonitors = enabled ? [
      ...(downloads ? ["download-files"] : []),
      ...(filesystem ? ["filesystem-candidates"] : []),
      ...(this.settings.monitorUsbStorage === true ? ["device-security"] : []),
      ...(this.settings.monitorNewProcesses === true || this.settings.monitorChildProcesses === true || this.settings.monitorSuspiciousCommandLines === true || this.settings.monitorPowerShell === true || this.settings.monitorCmd === true || this.settings.monitorWScript === true || this.settings.monitorMshta === true ? ["process-observation"] : []),
      ...(this.settings.monitorStartupFolder === true ? ["windows-startup-folder"] : []),
      ...(this.settings.monitorScheduledTasks === true || this.settings.monitorRegistryRunKeys === true || this.settings.monitorServices === true || this.settings.monitorDrivers === true ? ["windows-configuration-observation"] : []),
    ] : [];
  }

  private publish(): BackgroundSnapshot { const snapshot = this.snapshot(); this.onChanged(snapshot); return snapshot; }
  private async enqueue<T>(operation: () => Promise<T>): Promise<T> { const result = this.mutation.then(operation, operation); this.mutation = result.then(() => undefined, () => undefined); return result; }
  private scheduleHistoryFlush(): void {
    if (this.historyFlushTimer) return;
    this.historyFlushTimer = setTimeout(() => {
      this.historyFlushTimer = undefined;
      void this.flushHistory(false);
    }, 500);
  }
  private async ensureHistoryLoaded(): Promise<void> {
    if (this.historyLoaded) return;
    if (existsSync(this.historyPath)) {
      try { this.history = validateHistory(JSON.parse(await readFile(this.historyPath, "utf8"))); } catch { this.history = []; }
    } else {
      this.history = this.legacyHistory;
      await this.persistHistory();
    }
    this.legacyHistory = [];
    this.historyLoaded = true;
  }
  private async persist(): Promise<void> { await mkdir(dirname(this.dataPath), { recursive: true }); const temporary = `${this.dataPath}.tmp`; const legacy = !this.historyLoaded && this.legacyHistory.length ? { history: this.legacyHistory } : {}; await writeFile(temporary, JSON.stringify({ settings: this.settings, activeScan: this.activeScan, ...legacy }, null, 2), "utf8"); await rename(temporary, this.dataPath); }
  private async persistHistory(): Promise<void> { await mkdir(dirname(this.historyPath), { recursive: true }); const temporary = `${this.historyPath}.tmp`; await writeFile(temporary, JSON.stringify(this.history, null, 2), "utf8"); await rename(temporary, this.historyPath); }
  private async loadScanCache(): Promise<void> { if (!existsSync(this.scanCachePath)) return; try { const stored = JSON.parse(await readFile(this.scanCachePath, "utf8")) as Record<string, unknown>; for (const [filePath, value] of Object.entries(stored)) { const entry = validateScanCacheEntry(value); if (entry) this.scanCache.set(filePath, entry); } } catch { this.scanCache.clear(); } }
  private async read(): Promise<StoredBackgroundState> { if (!existsSync(this.dataPath)) return {}; try { return JSON.parse(await readFile(this.dataPath, "utf8")) as StoredBackgroundState; } catch { return {}; } }
}

function validateSettings(value: unknown): BackgroundSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: BackgroundSettings = { ...recommendedSettings };
  for (const [key, fallback] of Object.entries(recommendedSettings)) {
    const candidate = key === "performanceMode" ? legacyPerformanceMode(source[key]) : source[key];
    if (typeof fallback === "boolean" && typeof candidate === "boolean") result[key] = candidate;
    else if (typeof fallback === "string" && typeof candidate === "string" && validEnum(key, candidate)) result[key] = candidate;
    else if (typeof fallback === "number" && typeof candidate === "number" && [0, 1, 2, 4, 8].includes(candidate)) result[key] = candidate;
    else if (Array.isArray(fallback) && Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string")) result[key] = [...candidate] as string[];
  }
  return result;
}

function validEnum(key: string, value: string): boolean { return key === "mediumRiskAction" ? ["ignore", "notify", "sandbox", "ai"].includes(value) : key === "highRiskAction" ? ["notify", "sandbox", "ai"].includes(value) : key === "performanceMode" ? ["light", "balanced", "deep"].includes(value) : key === "scanPriority" ? ["low", "normal", "high"].includes(value) : false; }
function riskLevel(score: number | undefined): Exclude<HistoryClearScope, "all"> { return (score ?? 0) <= 25 ? "low" : (score ?? 0) <= 60 ? "medium" : "high"; }
function legacyPerformanceMode(value: unknown): unknown { return value === "low" ? "light" : value === "high" ? "deep" : value; }
function validateHistory(value: unknown): BackgroundHistoryRecord[] { return Array.isArray(value) ? value.filter((entry): entry is BackgroundHistoryRecord => Boolean(entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { detail?: unknown }).detail === "string")) : []; }
function cacheKey(filePath: string): string { return filePath.replaceAll("/", "\\").toLowerCase(); }
function validateScanCacheEntry(value: unknown): ScanCacheEntry | undefined { if (!value || typeof value !== "object") return undefined; const entry = value as Partial<ScanCacheEntry>; return typeof entry.size === "number" && Number.isFinite(entry.size) && typeof entry.mtimeMs === "number" && Number.isFinite(entry.mtimeMs) && typeof entry.analyzedAt === "string" && typeof entry.priorityScore === "number" && Number.isFinite(entry.priorityScore) ? { size: entry.size, mtimeMs: entry.mtimeMs, analyzedAt: entry.analyzedAt, priorityScore: entry.priorityScore, signatureStatus: typeof entry.signatureStatus === "string" ? entry.signatureStatus : undefined } : undefined; }
function validateScan(value: unknown): PersistedScanState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const scan = value as Partial<PersistedScanState>;
  if (typeof scan.id !== "string" || !["quick", "full", "folder"].includes(scan.mode ?? "") || !["running", "paused", "completed", "cancelled", "failed"].includes(scan.status ?? "") || !Array.isArray(scan.pendingFiles) || !scan.pendingFiles.every((file) => typeof file === "string")) return undefined;
  const number = (candidate: unknown, fallback = 0) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : fallback;
  const priorityRemaining = scan.priorityRemaining && typeof scan.priorityRemaining === "object" ? Object.fromEntries(["critical", "high", "medium", "low", "inventory"].map((band) => [band, number((scan.priorityRemaining as Record<string, unknown>)[band])])) : undefined;
  return {
    id: scan.id,
    mode: scan.mode as PersistedScanState["mode"],
    target: typeof scan.target === "string" ? scan.target : "",
    startedAt: typeof scan.startedAt === "string" ? scan.startedAt : new Date().toISOString(),
    updatedAt: typeof scan.updatedAt === "string" ? scan.updatedAt : new Date().toISOString(),
    currentFile: typeof scan.currentFile === "string" ? scan.currentFile : "",
    filesCompleted: number(scan.filesCompleted), filesRemaining: number(scan.filesRemaining), totalFiles: number(scan.totalFiles), progress: Math.min(100, number(scan.progress)), currentStage: typeof scan.currentStage === "string" ? scan.currentStage : "Preparing", status: scan.status as ScanStatus, investigationCount: number(scan.investigationCount), pausedAt: typeof scan.pausedAt === "string" ? scan.pausedAt : undefined, pausedDurationMs: number(scan.pausedDurationMs), estimatedRemainingMs: typeof scan.estimatedRemainingMs === "number" ? number(scan.estimatedRemainingMs) : undefined,
    forensicCount: number(scan.forensicCount), inventoryCount: number(scan.inventoryCount), errorCount: number(scan.errorCount), cacheHits: number(scan.cacheHits), cacheMisses: number(scan.cacheMisses), cacheSkipped: number(scan.cacheSkipped), workersActive: number(scan.workersActive), workersTotal: number(scan.workersTotal), peakQueueLength: number(scan.peakQueueLength), throughputPerSecond: number(scan.throughputPerSecond), cpuPercent: number(scan.cpuPercent), memoryBytes: number(scan.memoryBytes), priorityRemaining, pendingFiles: [...scan.pendingFiles],
  };
}
function publicScan(scan: PersistedScanState): Omit<PersistedScanState, "pendingFiles"> { const { pendingFiles: _pendingFiles, ...publicState } = scan; return publicState; }
function cloneRecord(value: Record<string, any>): Record<string, unknown> { return JSON.parse(JSON.stringify(value)) as Record<string, unknown>; }
function strings(value: SettingValue | undefined): readonly string[] { return Array.isArray(value) ? value : []; }
function analysisRecord(value: unknown): Record<string, any> | undefined { return value && typeof value === "object" && "analysis" in value && (value as { analysis?: unknown }).analysis && typeof (value as { analysis: unknown }).analysis === "object" ? (value as { analysis: Record<string, any> }).analysis : undefined; }

function monitoredDirectories(settings: BackgroundSettings): string[] {
  return [...new Set([
    ...(settings.monitorDesktop === true ? [join(homedir(), "Desktop")] : []),
    ...(settings.monitorDocuments === true ? [join(homedir(), "Documents")] : []),
    ...(settings.monitorStartupFolder === true ? [join(homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup")] : []),
    ...strings(settings.customFolders),
  ])];
}

function monitoredExtensions(settings: BackgroundSettings): string[] {
  const groups: Array<[string, string[]]> = [
    ["scanExecutables", [".exe", ".scr", ".com"]], ["scanDlls", [".dll", ".ocx", ".cpl"]], ["scanInstallers", [".msi", ".msp", ".appx"]],
    ["scanScripts", [".vbs", ".vbe", ".wsf"]], ["scanBatchFiles", [".bat", ".cmd"]], ["scanPowerShellScripts", [".ps1", ".psm1", ".psd1"]],
    ["scanJavaScriptFiles", [".js", ".jse", ".hta"]], ["scanPythonScripts", [".py", ".pyw"]], ["scanOfficeDocuments", [".doc", ".docm", ".docx", ".xls", ".xlsm", ".xlsx", ".ppt", ".pptm", ".pptx"]],
    ["scanArchives", [".zip", ".rar", ".7z"]], ["scanPdfs", [".pdf"]], ["scanShortcuts", [".lnk", ".url"]],
  ];
  return groups.flatMap(([setting, extensions]) => settings[setting] === true ? extensions : []);
}