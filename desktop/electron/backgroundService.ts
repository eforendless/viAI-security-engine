import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
}

export interface BackgroundSnapshot {
  settings: BackgroundSettings;
  history: BackgroundHistoryRecord[];
  activeMonitors: string[];
}

interface StoredBackgroundState { settings?: unknown; history?: unknown; }

export const recommendedSettings: BackgroundSettings = Object.freeze({
  backgroundProtection: true, runAfterWindowCloses: true, launchOnStartup: true, startMinimized: false, startSilently: false, openDashboardAfterStartup: true, minimizeToTray: true, windowsNotifications: true, soundNotifications: false,
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
  private activeMonitors: string[] = [];

  constructor(private readonly dataPath: string, private readonly applyEngineMonitoring: (updates: EngineMonitoringUpdate) => Promise<void>, private readonly onChanged: (snapshot: BackgroundSnapshot) => void) {}

  async initialize(): Promise<BackgroundSnapshot> {
    const stored = await this.read();
    this.settings = validateSettings(stored.settings);
    this.history = validateHistory(stored.history);
    await this.apply();
    return this.snapshot();
  }

  snapshot(): BackgroundSnapshot { return { settings: { ...this.settings }, history: [...this.history], activeMonitors: [...this.activeMonitors] }; }
  async update(changes: Record<string, unknown>): Promise<BackgroundSnapshot> { this.settings = validateSettings({ ...this.settings, ...changes }); await this.apply(); await this.persist(); this.onChanged(this.snapshot()); return this.snapshot(); }
  async restoreRecommended(): Promise<BackgroundSnapshot> { this.settings = { ...recommendedSettings }; await this.apply(); await this.persist(); this.onChanged(this.snapshot()); return this.snapshot(); }
  async restoreFactory(): Promise<BackgroundSnapshot> { this.settings = { ...factorySettings }; await this.apply(); await this.persist(); this.onChanged(this.snapshot()); return this.snapshot(); }
  exportSettings(): string { return JSON.stringify(this.settings, null, 2); }
  async importSettings(serialized: string): Promise<BackgroundSnapshot> { this.settings = validateSettings(JSON.parse(serialized)); await this.apply(); await this.persist(); this.onChanged(this.snapshot()); return this.snapshot(); }
  async clearHistory(): Promise<void> { this.history = []; await this.persist(); this.onChanged(this.snapshot()); }

  async recordAnalysis(body: unknown): Promise<void> {
    const analysis = analysisRecord(body);
    if (!analysis) return;
    const matchedRules = Array.isArray(analysis.staticAnalysisReport?.matchedRules) ? (analysis.staticAnalysisReport.matchedRules as unknown[]).map((entry: unknown) => typeof entry === "object" && entry && typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id : undefined).filter((id: string | undefined): id is string => Boolean(id)) : [];
    this.history = [{ id: crypto.randomUUID(), kind: "scan", occurredAt: typeof analysis.analyzedAt === "string" ? analysis.analyzedAt : new Date().toISOString(), fileHash: analysis.hashes?.sha256, filePath: analysis.filePath, riskScore: analysis.finalRiskScore, trustScore: analysis.trustScore, recommendation: analysis.recommendation, matchedRules, engineVersion: "0.1.5", detail: `Static analysis completed: ${analysis.recommendation ?? "MONITOR"}` }, ...this.history.filter((record) => !(record.kind === "scan" && record.fileHash === analysis.hashes?.sha256 && record.occurredAt === analysis.analyzedAt))];
    await this.persist();
    this.onChanged(this.snapshot());
  }

  async recordEvent(detail: string, id: string = crypto.randomUUID()): Promise<void> { if (this.history.some((record) => record.id === id)) return; this.history = [{ id, kind: "realtime-event", occurredAt: new Date().toISOString(), engineVersion: "0.1.5", detail }, ...this.history]; await this.persist(); this.onChanged(this.snapshot()); }

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

  private async persist(): Promise<void> { await mkdir(dirname(this.dataPath), { recursive: true }); const temporary = `${this.dataPath}.tmp`; await writeFile(temporary, JSON.stringify({ settings: this.settings, history: this.history }, null, 2), "utf8"); await rename(temporary, this.dataPath); }
  private async read(): Promise<StoredBackgroundState> { if (!existsSync(this.dataPath)) return {}; try { return JSON.parse(await readFile(this.dataPath, "utf8")) as StoredBackgroundState; } catch { return {}; } }
}

function validateSettings(value: unknown): BackgroundSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result: BackgroundSettings = { ...recommendedSettings };
  for (const [key, fallback] of Object.entries(recommendedSettings)) {
    const candidate = source[key];
    if (typeof fallback === "boolean" && typeof candidate === "boolean") result[key] = candidate;
    else if (typeof fallback === "string" && typeof candidate === "string" && validEnum(key, candidate)) result[key] = candidate;
    else if (typeof fallback === "number" && typeof candidate === "number" && [0, 1, 2, 4, 8].includes(candidate)) result[key] = candidate;
    else if (Array.isArray(fallback) && Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string")) result[key] = [...candidate] as string[];
  }
  return result;
}

function validEnum(key: string, value: string): boolean { return key === "mediumRiskAction" ? ["ignore", "notify", "sandbox", "ai"].includes(value) : key === "highRiskAction" ? ["notify", "sandbox", "ai"].includes(value) : key === "performanceMode" ? ["low", "balanced", "high"].includes(value) : key === "scanPriority" ? ["low", "normal", "high"].includes(value) : false; }
function validateHistory(value: unknown): BackgroundHistoryRecord[] { return Array.isArray(value) ? value.filter((entry): entry is BackgroundHistoryRecord => Boolean(entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { detail?: unknown }).detail === "string")) : []; }
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