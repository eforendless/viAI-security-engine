import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { DeviceSecurityService, type DeviceRecord, type DeviceSecuritySnapshot, type DeviceStorageScanTrigger } from "./deviceSecurity";
import { BackgroundService, type BackgroundSnapshot, type EngineMonitoringUpdate, type PersistedScanState } from "./backgroundService";
import { ScanService, type ScanEventName, type ScanOrigin } from "./scanService";
import type { ScanController } from "./scanController";
import { notificationForAnalysis } from "./analysisNotification";
import { StartupManager, type StartupProgress } from "./startup";
import { collectSystemOverview } from "./systemOverview";
import { UpdateService } from "./updater";
import { isNotificationTarget, type NativeNotificationPayload, type NotificationTarget, WindowsNotificationService } from "./windowsNotificationService";
import { DesktopPersistence, type ScanReport } from "./persistence/repositories";
import { importLegacyJson } from "./persistence/legacyJsonImporter";
import { APPLICATION_NAME, configureApplicationIdentity } from "./applicationIdentity";
import { legacyUserDataPath, migrateLegacyUserData } from "./userDataMigration";

const execFileAsync = promisify(execFile);
configureApplicationIdentity(app);
const isPrimaryInstance = app.requestSingleInstanceLock();
let engineProcess: ReturnType<typeof execFile> | undefined;
let deviceSecurity: DeviceSecurityService | undefined;
let backgroundService: BackgroundService | undefined;
let persistence: DesktopPersistence | undefined;
let scanService: ScanService | undefined;
let mainWindow: BrowserWindow | undefined;
let splashWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let engineEventTimer: NodeJS.Timeout | undefined;
let disposing = false;
let dashboardLoad: Promise<void> | undefined;
let startupManager: StartupManager | undefined;
let startupComplete = false;
let startupRunning = false;
let restoreAfterStartup = false;
let startupSnapshot: BackgroundSnapshot | undefined;
let updateService: UpdateService | undefined;
let engineEventsSince = new Date().toISOString();
let rendererReady = false;
let pendingNotificationTarget: NotificationTarget | undefined;
const scanReportUpdateTimers = new Map<string, NodeJS.Timeout>();
const pendingScanReportUpdates = new Map<string, Omit<PersistedScanState, "pendingFiles">>();
const scanReportUpdateIntervalMs = 400;
const launchedInBackground = process.argv.includes("--viai-background");
const launchedMinimized = process.argv.includes("--viai-minimized");

if (!isPrimaryInstance) app.quit();
if (isPrimaryInstance) {

const windowsNotifications = new WindowsNotificationService({
  supported: () => Notification.isSupported(),
  deliver: deliverNativeNotification,
  diagnostic: (message) => { if (!app.isPackaged) console.debug(`[viAI notifications] ${message}`); },
});

function publishDeviceSecurity(snapshot: DeviceSecuritySnapshot, events: readonly DeviceSecuritySnapshot["history"][number][]): void {
  void backgroundService?.setRuntimeMonitor("device-security", snapshot.monitoringActive);
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("device-security:changed", { snapshot, events });
  void recordDeviceEvents(snapshot, events);
  if (snapshot.monitoringState === "degraded") notifyProtectionFailure();
}

function publishBackground(snapshot: BackgroundSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("background:changed", snapshot);
  applyStartup(snapshot.settings);
}

function publishScan(event: ScanEventName, scan: Omit<PersistedScanState, "pendingFiles">): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("scan:event", { event, scan });
  if (scan.mode === "full") queueScanReportUpdate(event, scan);
  if (event === "scanCompleted") notifyScanCompleted(scan);
}

function queueScanReportUpdate(event: ScanEventName, scan: Omit<PersistedScanState, "pendingFiles">): void {
  const immediate = event !== "scanProgress";
  pendingScanReportUpdates.set(scan.id, scan);
  const timer = scanReportUpdateTimers.get(scan.id);
  if (immediate && timer) { clearTimeout(timer); scanReportUpdateTimers.delete(scan.id); }
  if (immediate) { void publishQueuedScanReport(scan.id, event); return; }
  if (timer) return;
  const scheduled = setTimeout(() => { scanReportUpdateTimers.delete(scan.id); void publishQueuedScanReport(scan.id, "scanProgress"); }, scanReportUpdateIntervalMs);
  scheduled.unref();
  scanReportUpdateTimers.set(scan.id, scheduled);
}

async function publishQueuedScanReport(scanId: string, event: ScanEventName): Promise<void> {
  const scan = pendingScanReportUpdates.get(scanId);
  if (!scan) return;
  pendingScanReportUpdates.delete(scanId);
  const terminal = event === "scanCompleted" || event === "scanCancelled" || event === "scanFailed";
  const report = terminal || event === "scanPaused"
    ? await backgroundService?.scanReport(scanId)
    : await backgroundService?.runtimeScanReport(scan);
  if (!report) return;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("scan-report:updated", { event, report });
}

function enginePaths(): { entry: string; workingDirectory: string } {
  if (app.isPackaged) {
    const workingDirectory = join(process.resourcesPath, "engine");
    return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
  }
  const workingDirectory = join(__dirname, "..", "..");
  return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
}

function engineVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(join(enginePaths().workingDirectory, "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "Unavailable";
  } catch {
    return "Unavailable";
  }
}

async function startEngine(): Promise<void> {
  if (quitting || disposing || process.env.VITE_DEV_SERVER_URL) return;
  if (engineProcess && !engineProcess.killed) return;
  const { entry, workingDirectory } = enginePaths();
  if (!existsSync(entry)) {
    throw new Error(`viAI engine entry point was not found: ${entry}`);
  }
  await terminateOrphanedEngines(entry);
  if (quitting || disposing) return;
  const child = execFile(process.execPath, [entry], {
    cwd: workingDirectory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VIAI_DEVICE_SECURITY: "1", VIAI_DB_PATH: persistence?.database.filePath ?? "" },
    windowsHide: true,
  });
  engineProcess = child;
  child.on("error", (error) => console.error("Unable to start viAI engine", error));
  child.stderr?.on("data", (output) => console.error(`viAI engine error: ${String(output).trim()}`));
  child.once("exit", () => { if (engineProcess === child) engineProcess = undefined; });
}

async function terminateOrphanedEngines(entry: string): Promise<void> {
  if (process.platform !== "win32") return;
  const escapedEntry = entry.replaceAll("'", "''");
  const script = `$entry = '${escapedEntry}'; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*$entry*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 }); } catch { /* A stale engine is best-effort cleanup after an ungraceful termination. */ }
}

function showMainWindow(): void {
  if (!startupComplete) {
    restoreAfterStartup = true;
    splashWindow?.show();
    splashWindow?.focus();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(true); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  deliverPendingNavigation();
}

function createWindow(show = true): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (show && startupComplete) showMainWindow();
    return mainWindow;
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: APPLICATION_NAME,
    show: false,
    backgroundColor: "#101820",
    frame: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  rendererReady = false;
  dashboardLoad = new Promise<void>((resolve, reject) => {
    window.webContents.once("did-finish-load", () => resolve());
    window.webContents.once("did-fail-load", (_event, _errorCode, errorDescription) => reject(new Error(`Dashboard could not load: ${errorDescription}`)));
  });
  window.once("ready-to-show", () => { if (show && startupComplete && !window.isDestroyed()) window.show(); });
  window.on("close", (event) => {
    const scanIsRunning = backgroundService?.currentScan()?.status === "running";
    if (!quitting && (backgroundService?.snapshot().settings.runAfterWindowCloses === true || scanIsRunning)) { event.preventDefault(); window.hide(); }
  });
  window.on("minimize", () => {
    if (backgroundService?.snapshot().settings.minimizeToTray === true) window.hide();
  });
  window.on("closed", () => { if (mainWindow === window) { mainWindow = undefined; rendererReady = false; } });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
  return window;
}

async function createSplashWindow(): Promise<void> {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  const window = new BrowserWindow({
    width: 540,
    height: 430,
    minWidth: 540,
    minHeight: 430,
    maxWidth: 540,
    maxHeight: 430,
    center: true,
    show: false,
    frame: false,
    transparent: process.platform === "win32",
    hasShadow: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    title: APPLICATION_NAME,
    backgroundColor: "#101820",
    webPreferences: { preload: join(__dirname, "splashPreload.js"), contextIsolation: true, nodeIntegration: false },
  });
  splashWindow = window;
  window.once("ready-to-show", () => { if (!quitting && !disposing) window.show(); });
  window.on("closed", () => { if (splashWindow === window) splashWindow = undefined; });
  const loaded = new Promise<void>((resolve, reject) => {
    window.webContents.once("did-finish-load", () => { publishStartupProgress(startupManager?.progress.snapshot()); resolve(); });
    window.webContents.once("did-fail-load", (_event, _errorCode, errorDescription) => reject(new Error(`Startup screen could not load: ${errorDescription}`)));
  });
  void window.loadFile(join(__dirname, "splash.html"));
  await loaded;
}

function publishStartupProgress(progress: StartupProgress | undefined): void {
  if (progress && splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send("startup:progress", progress);
}

async function prepareDashboard(): Promise<void> {
  createWindow(false);
  await dashboardLoad;
}

function announceStartupReady(): void {
  if (startupComplete || quitting || disposing) return;
  startupComplete = true;
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send("startup:ready");
  else completeStartupTransition();
}

async function waitForEngineReady(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probeEngine()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The local analysis engine did not become ready within 10 seconds.");
}

async function probeEngine(): Promise<boolean> {
  try { return (await fetch("http://127.0.0.1:4117/health")).ok; } catch { return false; }
}

function configureStartup(): StartupManager {
  if (startupManager) return startupManager;
  const manager = new StartupManager();
  manager.progress.subscribe(publishStartupProgress);
  manager.register([
    { id: "configuration", name: "Loading application configuration", weight: 5, execute: async () => { if (!process.env.VITE_DEV_SERVER_URL && !existsSync(enginePaths().entry)) throw new Error("The packaged local engine is missing."); } },
    { id: "persistence", name: "Loading user settings and local persistence", weight: 20, dependencies: ["configuration"], execute: async () => { const userDataPath = app.getPath("userData"); await migrateLegacyUserData({ legacyUserDataPath: legacyUserDataPath(app.getPath("appData")), userDataPath }); persistence = new DesktopPersistence(join(userDataPath, "viai.db")); await importLegacyJson(persistence, { userDataPath, engineDataPath: join(enginePaths().workingDirectory, "database") }); backgroundService = new BackgroundService(persistence, applyEngineMonitoring, publishBackground, engineVersion()); startupSnapshot = await backgroundService.initialize(); applyStartup(startupSnapshot.settings); } },
    { id: "engine", name: "Initializing analysis, rules, and trust engines", weight: 25, dependencies: ["persistence"], execute: async () => { await startEngine(); await waitForEngineReady(); } },
    { id: "recovery", name: "Checking persisted scan recovery", weight: 10, dependencies: ["persistence"], execute: async () => { if (!backgroundService) throw new Error("Background persistence is unavailable."); scanService = new ScanService(backgroundService, (filePath, scanType, _classification, signal, origin, scanId) => analyzeEngineFile(filePath, scanType, engineAnalysisTimeoutMs, signal, origin, scanId), publishScan, undefined, resumePersistedDiscovery); await scanService.recover(); } },
    { id: "devices", name: "Loading device cache and USB monitoring", weight: 15, dependencies: ["recovery"], execute: async () => { if (!persistence) throw new Error("Local persistence is unavailable."); deviceSecurity = new DeviceSecurityService(persistence, publishDeviceSecurity, () => { const settings = backgroundService?.snapshot().settings; const enabled = settings?.backgroundProtection === true; return { monitorUsbStorage: enabled && settings?.monitorUsbStorage === true, monitorUsbInsertion: enabled && settings?.monitorUsbInsertion === true, automaticallyScanUsb: enabled && settings?.automaticallyScanUsb === true }; }, requestRemovableStorageScan); await deviceSecurity.start(); } },
    { id: "notifications", name: "Preparing local notifications", weight: 5, dependencies: ["persistence"], execute: async () => { Notification.isSupported(); } },
    { id: "tray", name: "Creating secure system tray service", weight: 5, dependencies: ["persistence"], execute: async () => { createTray(); } },
    { id: "dashboard", name: "Preparing secure dashboard", weight: 15, dependencies: ["persistence"], execute: async () => { await prepareDashboard(); announceStartupReady(); } },
  ]);
  startupManager = manager;
  return manager;
}

async function runStartup(): Promise<void> {
  if (startupRunning || quitting || disposing) return;
  startupRunning = true;
  try {
    const manager = configureStartup();
    await manager.start();
    announceStartupReady();
  } catch (error) {
    console.error("viAI startup failed", error);
    if (!splashWindow && !quitting && !disposing) await createSplashWindow();
  } finally {
    startupRunning = false;
  }
}

function completeStartupTransition(): void {
  if (!startupComplete || quitting || disposing) return;
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  const startHidden = launchedInBackground && (startupSnapshot?.settings.startSilently === true || launchedMinimized);
  if (!startHidden || restoreAfterStartup) showMainWindow();
  deliverPendingNavigation();
  startEngineEventPolling();
  void backgroundService?.loadHistory().catch((error) => console.error("Could not load deferred local history", error));
}

app.on("second-instance", () => { if (app.isReady()) showMainWindow(); });

ipcMain.on("renderer:ready", (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return;
  rendererReady = true;
  deliverPendingNavigation();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  updateService = new UpdateService();
  updateService.initialize();
  if (!launchedInBackground) await createSplashWindow();
  await runStartup();
  app.on("activate", () => showMainWindow());
});

app.on("window-all-closed", () => {
  const scanIsRunning = backgroundService?.currentScan()?.status === "running";
  if (!backgroundService?.snapshot().settings.runAfterWindowCloses && !scanIsRunning && process.platform !== "darwin") { quitting = true; app.quit(); }
});

app.on("before-quit", () => { quitting = true; disposeMainResources(); });
app.on("will-quit", disposeMainResources);

ipcMain.handle("startup:retry", () => runStartup());
ipcMain.handle("startup:exit", () => { quitting = true; app.quit(); });
ipcMain.handle("startup:complete-transition", () => completeStartupTransition());
ipcMain.handle("application:version", () => app.getVersion());
ipcMain.handle("engine:version", () => engineVersion());
ipcMain.handle("system:overview", () => collectSystemOverview(persistence?.getOrCreateSystemDeviceId() ?? "Not Available"));
ipcMain.handle("updates:snapshot", () => updateService?.current());
ipcMain.handle("updates:check", () => updateService?.check());
ipcMain.handle("updates:download", () => updateService?.download());
ipcMain.handle("updates:install", () => updateService?.install());

ipcMain.handle("dialog:pick-file", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "All files", extensions: ["*"] }] });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("window-controls:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window-controls:maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.handle("window-controls:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("background:snapshot", () => backgroundService?.loadHistory());
ipcMain.handle("background:history-record", async (_event, id: string) => {
  if (typeof id !== "string" || id.length > 128) throw new Error("Invalid history record request");
  return backgroundService?.historyRecord(id);
});
ipcMain.handle("background:history-page", async (_event, query: { page?: unknown; pageSize?: unknown; search?: unknown; category?: unknown; scanId?: unknown }) => {
  if (!backgroundService || !query || typeof query !== "object") throw new Error("Invalid history query");
  const page = typeof query.page === "number" && Number.isInteger(query.page) && query.page >= 0 ? query.page : 0;
  const pageSize = typeof query.pageSize === "number" && Number.isInteger(query.pageSize) && query.pageSize > 0 && query.pageSize <= 500 ? query.pageSize : 100;
  const search = typeof query.search === "string" && query.search.length <= 512 ? query.search : undefined;
  const category = query.category === "needs-investigation" || query.category === "monitoring" || query.category === "no-action" || query.category === "all" ? query.category : "all";
  const scanId = typeof query.scanId === "string" && query.scanId.length > 0 && query.scanId.length <= 128 ? query.scanId : undefined;
  return backgroundService.historyPage({ page, pageSize, search, category, scanId });
});
ipcMain.handle("background:scan-report-page", async (_event, query: { page?: unknown; pageSize?: unknown; search?: unknown; status?: unknown; performanceMode?: unknown }) => {
  if (!backgroundService || !query || typeof query !== "object") throw new Error("Invalid scan report query");
  const page = typeof query.page === "number" && Number.isInteger(query.page) && query.page >= 0 ? query.page : 0;
  const pageSize = typeof query.pageSize === "number" && Number.isInteger(query.pageSize) && query.pageSize > 0 && query.pageSize <= 200 ? query.pageSize : 50;
  const search = typeof query.search === "string" && query.search.length <= 512 ? query.search : undefined;
  const status = query.status === "running" || query.status === "paused" || query.status === "completed" || query.status === "cancelled" || query.status === "failed" ? query.status : "all";
  const performanceMode = query.performanceMode === "light" || query.performanceMode === "balanced" || query.performanceMode === "deep" ? query.performanceMode : "all";
  return backgroundService.scanReportPage({ page, pageSize, search, status, performanceMode });
});
ipcMain.handle("background:scan-report", async (_event, scanId: unknown) => {
  if (!backgroundService || typeof scanId !== "string" || !scanId.length || scanId.length > 128) throw new Error("Invalid scan report identifier");
  return backgroundService.scanReport(scanId);
});
ipcMain.handle("background:dashboard-summary", async () => {
  if (!backgroundService) throw new Error("Background service is not ready");
  return backgroundService.dashboardSummary();
});
ipcMain.handle("background:assessment-trend", async (_event, period: unknown) => {
  if (!backgroundService || (period !== "24h" && period !== "7d" && period !== "30d")) throw new Error("Invalid dashboard trend period");
  return backgroundService.assessmentTrend(period);
});
ipcMain.handle("background:recent-assessments", async (_event, query: { limit?: unknown; search?: unknown; category?: unknown }) => {
  if (!backgroundService || !query || typeof query !== "object") throw new Error("Invalid dashboard recent query");
  const limit = typeof query.limit === "number" && Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 50 ? query.limit : 8;
  const search = typeof query.search === "string" && query.search.length <= 512 ? query.search : undefined;
  const category = query.category === "needs-investigation" || query.category === "monitoring" || query.category === "no-action" || query.category === "legacy" || query.category === "all" ? query.category : "all";
  return backgroundService.recentAssessments({ limit, search, category });
});
async function applyBackgroundSettings(snapshot: Awaited<ReturnType<BackgroundService["snapshot"]>> | undefined): Promise<void> {
  if (!snapshot) return;
  applyStartup(snapshot.settings);
  await deviceSecurity?.applyMonitoringPolicy();
}

ipcMain.handle("background:update", async (_event, changes: Record<string, unknown>) => {
  if (!changes || typeof changes !== "object") throw new Error("Invalid background settings update");
  const snapshot = await backgroundService?.update(changes);
  await applyBackgroundSettings(snapshot);
  return snapshot;
});
ipcMain.handle("background:restore-recommended", async () => {
  const snapshot = await backgroundService?.restoreRecommended();
  await applyBackgroundSettings(snapshot);
  return snapshot;
});
ipcMain.handle("background:restore-factory", async () => {
  const snapshot = await backgroundService?.restoreFactory();
  await applyBackgroundSettings(snapshot);
  return snapshot;
});
ipcMain.handle("background:export", () => backgroundService?.exportSettings());
ipcMain.handle("background:import", async (_event, serialized: string) => {
  if (typeof serialized !== "string" || serialized.length > 256_000) throw new Error("Invalid settings import");
  const snapshot = await backgroundService?.importSettings(serialized);
  await applyBackgroundSettings(snapshot);
  return snapshot;
});
ipcMain.handle("background:clear-history", async (_event, scope: "all" | "low" | "medium" | "high" = "all") => {
  if (!backgroundService || !["all", "low", "medium", "high"].includes(scope)) throw new Error("Invalid history clear scope");
  await backgroundService.clearHistory(scope);
});
ipcMain.handle("background:remove-history", async (_event, ids: unknown) => {
  if (!backgroundService || !Array.isArray(ids) || ids.length > 500 || !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) throw new Error("Invalid history removal request");
  return backgroundService.removeHistory(ids);
});
ipcMain.handle("background:remove-history-matching", async (_event, query: { search?: unknown; category?: unknown }, excludedIds: unknown) => {
  if (!backgroundService || !query || typeof query !== "object" || !Array.isArray(excludedIds) || excludedIds.length > 500 || !excludedIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) throw new Error("Invalid history removal request");
  const search = typeof query.search === "string" && query.search.length <= 512 ? query.search : undefined;
  const category = query.category === "needs-investigation" || query.category === "monitoring" || query.category === "no-action" || query.category === "all" ? query.category : "all";
  return backgroundService.removeHistoryMatching({ search, category }, excludedIds);
});
ipcMain.handle("application:clear-local-data", async () => {
  await scanService?.cancelAndWait();
  await backgroundService?.clearAllData();
  await deviceSecurity?.clearData();
  const response = await fetch("http://127.0.0.1:4117/data/reset", { method: "POST" });
  if (!response.ok) throw new Error("Could not reset local engine data");
});

ipcMain.handle("scan:start", async (_event, mode: "quick" | "full" | "folder", target?: string) => {
  if (!scanService || !backgroundService || !["quick", "full", "folder"].includes(mode)) throw new Error("Scan service is not ready");
  const settings = backgroundService.snapshot().settings;
  let files: string[];
  if (mode === "quick") {
    if (typeof target !== "string" || !existsSync(target)) throw new Error("Choose an existing file to scan");
    files = [target];
  } else if (mode === "folder") {
    if (typeof target !== "string" || !existsSync(target)) throw new Error("Choose an existing folder to scan");
    const folderTarget = target;
    const performanceMode = settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced";
    const parallel = scanConcurrency(performanceMode);
    const scan = await scanService.start(mode, target, [], parallel, false, undefined, performanceMode);
    void scanService.discover(scan.id, (controller, onBatch) => streamCandidates([folderTarget], false, controller, onBatch));
    return scan;
  } else {
    const home = homedir();
    const performanceMode = settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced";
    target = performanceMode === "deep" ? "All accessible PC files" : performanceMode === "light" ? "Important Windows locations" : "Common Windows locations";
    const parallel = scanConcurrency(performanceMode);
    const scan = await scanService.start(mode, target, [], parallel, false, undefined, performanceMode);
    void scanService.discover(scan.id, async (controller, onBatch) => {
      const roots = fullScanRoots(performanceMode, home, await fixedDrives(), await removableDrives()).filter(existsSync);
      await streamCandidates(roots, performanceMode === "deep", controller, onBatch);
    });
    return scan;
  }
  const performanceMode = settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced";
  const parallel = scanConcurrency(performanceMode);
  return scanService.start(mode, target ?? "", files, parallel, true, undefined, performanceMode);
});
ipcMain.handle("scan:pause", () => scanService?.pause());
ipcMain.handle("scan:resume", () => scanService?.resume());
ipcMain.handle("scan:continue", async (_event, scanId: unknown) => {
  if (typeof scanId !== "string" || !scanId.length || scanService?.controllerFor(scanId)?.state !== "paused") throw new Error("This paused scan is no longer available to continue");
  await scanService.resume();
});
ipcMain.handle("scan:cancel", () => scanService?.cancel());

ipcMain.handle("device-security:snapshot", () => deviceSecurity?.snapshot() ?? { devices: [], history: [], policies: {}, monitoringActive: false, monitoringState: "disabled" });
ipcMain.handle("device-security:set-trust", async (_event, deviceId: string, trusted: boolean) => {
  if (typeof deviceId !== "string" || typeof trusted !== "boolean") throw new Error("Invalid device trust request");
  await deviceSecurity?.setTrust(deviceId, trusted);
});
ipcMain.handle("device-security:scan", async (_event, deviceId: string) => {
  if (typeof deviceId !== "string") throw new Error("Invalid device scan request");
  await deviceSecurity?.requestStorageScan(deviceId);
});

ipcMain.handle("shell:open-path", async (_event, filePath: string) => shell.openPath(filePath));

ipcMain.handle("scan:list-files", async (_event, roots: string[], maxFiles = 2500) => {
  return collectCandidates(roots.filter(existsSync), maxFiles);
});

ipcMain.handle("scan:system-roots", async () => {
  const home = homedir();
  const roots = [
    "C:\\", "C:\\Windows\\Temp",
    join(home, "Downloads"), join(home, "Desktop"), join(home, "Documents"),
    join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"),
    "C:\\ProgramData", "C:\\Program Files", "C:\\Program Files (x86)",
    ...await removableDrives(),
  ];
  return [...new Set(roots.filter(existsSync))];
});

const engineUrl = "http://127.0.0.1:4117/analyze";
const engineHealthUrl = "http://127.0.0.1:4117/health";
const engineAnalysisTimeoutMs = 120_000;
const engineAnalysisConcurrency = 2;

ipcMain.handle("engine:analyze", async (_event, filePath: string) => analyzeEngineFile(filePath));

async function analyzeEngineFile(filePath: string, scanType: "quick" | "full" | "folder" | "single-file" | "realtime" = "single-file", timeoutMs = engineAnalysisTimeoutMs, signal?: AbortSignal, origin?: ScanOrigin, scanId?: string): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  try {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(engineAnalysisTimeoutMs, timeoutMs)))]): AbortSignal.timeout(Math.max(1, Math.min(engineAnalysisTimeoutMs, timeoutMs)));
    const response = await fetch(engineUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: filePath, ...(origin ? { source: origin.source } : {}) }),
      signal: requestSignal,
    });
    const responseText = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      const detail = responseText.trim() || "empty response body";
      throw new Error(`Engine returned an invalid response (${response.status}): ${detail}`);
    }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Engine analysis failed (${response.status})`);
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    const assessmentId = await backgroundService?.recordAnalysis(body, scanType, Date.now() - startedAt, scanType === "quick" || scanType === "full" || scanType === "folder", origin, scanId);
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    notifyAnalysis(body, assessmentId);
    return body;
  } catch (error) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("Local analysis timed out after 2 minutes; the file was skipped.");
    throw error;
  }
}

ipcMain.handle("engine:probe", async () => {
  try {
    const response = await fetch(engineHealthUrl);
    return response.ok;
  } catch {
    return false;
  }
});

ipcMain.handle("engine:events", async () => {
  const response = await fetch("http://127.0.0.1:4117/events");
  if (!response.ok) throw new Error(`Engine events request failed (${response.status})`);
  const body = await response.json() as { analyses?: unknown[] };
  return body.analyses ?? [];
});

ipcMain.handle("engine:monitoring", async () => {
  const response = await fetch("http://127.0.0.1:4117/monitoring");
  if (!response.ok) throw new Error(`Engine monitoring request failed (${response.status})`);
  return response.json();
});

ipcMain.handle("engine:set-monitoring", async (_event, updates: Record<string, boolean | string[]>) => {
  const response = await fetch("http://127.0.0.1:4117/monitoring", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(updates),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Engine monitoring update failed (${response.status})`);
  return body;
});

async function removableDrives(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    const script = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object -ExpandProperty DeviceID | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 });
    const drives = JSON.parse(stdout) as string | string[] | null;
    return (Array.isArray(drives) ? drives : drives ? [drives] : []).map((drive) => `${drive}\\`);
  } catch {
    return [];
  }
}

async function fixedDrives(): Promise<string[]> {
  if (process.platform !== "win32") return ["C:\\"];
  try {
    const script = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID | ConvertTo-Json -Compress";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 });
    const drives = JSON.parse(stdout) as string | string[] | null;
    return (Array.isArray(drives) ? drives : drives ? [drives] : []).map((drive) => `${drive}\\`);
  } catch {
    return ["C:\\"];
  }
}

function fullScanRoots(mode: "light" | "balanced" | "deep", home: string, fixed: string[], removable: string[]): string[] {
  const important = [join(home, "Downloads"), join(home, "Desktop"), join(home, "Documents"), join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"), "C:\\ProgramData"];
  if (mode === "light") return [...new Set(important)];
  if (mode === "deep") return [...new Set([...fixed, ...removable])];
  return [...new Set(["C:\\Windows\\Temp", ...important, join(home, "AppData"), "C:\\Program Files", "C:\\Program Files (x86)", ...removable])];
}

function scanConcurrency(mode: "light" | "balanced" | "deep"): number {
  return mode === "light" ? 1 : engineAnalysisConcurrency;
}

async function resumePersistedDiscovery(scan: PersistedScanState, controller: ScanController, onBatch: (files: string[]) => Promise<void>): Promise<void> {
  if (scan.mode === "folder") return streamCandidates([scan.target], false, controller, onBatch);
  if (scan.mode === "full") {
    const mode = scan.performanceMode === "light" || scan.performanceMode === "deep" ? scan.performanceMode : "balanced";
    const roots = fullScanRoots(mode, homedir(), await fixedDrives(), await removableDrives()).filter(existsSync);
    return streamCandidates(roots, mode === "deep", controller, onBatch);
  }
  await onBatch([]);
}

async function requestRemovableStorageScan(device: DeviceRecord, trigger: DeviceStorageScanTrigger): Promise<void> {
  if (!scanService || !backgroundService || !device.mountPoint) throw new Error("The scan service is not ready");
  const root = device.mountPoint.endsWith("\\") ? device.mountPoint : `${device.mountPoint}\\`;
  if (!existsSync(root)) throw new Error("The removable storage is no longer available");
  const settings = backgroundService.snapshot().settings;
  const performanceMode = settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced";
  const scan = await scanService.start("folder", root, [], scanConcurrency(performanceMode), false, { source: "removable-media", id: device.id, volume: root, trigger });
  void scanService.discover(scan.id, (controller, onBatch) => streamCandidates([root], false, controller, onBatch));
}

function collectCandidates(roots: string[], maxFiles: number, includeAllFiles = false): Promise<string[]> {
  return new Promise((resolve) => {
    const files: string[] = [];
    const workers = roots.map((root) => new Worker(join(__dirname, "scanWorker.js"), { workerData: { root, includeAllFiles } }));
    let completed = 0;
    const settledWorkers = new Set<Worker>();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      workers.forEach((worker) => void worker.terminate());
      resolve(files);
    };
    const settleWorker = (worker: Worker) => {
      if (settledWorkers.has(worker) || finished) return;
      settledWorkers.add(worker);
      completed += 1;
      if (completed === workers.length) finish();
    };
    if (workers.length === 0) finish();
    for (const worker of workers) {
      worker.on("message", (message: unknown) => {
        if (finished) return;
        if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete") { settleWorker(worker); return; }
        if (typeof message !== "string") return;
        files.push(message);
        if (files.length >= maxFiles) finish();
      });
      worker.once("error", () => settleWorker(worker));
      worker.once("exit", () => settleWorker(worker));
    }
  });
}

async function applyEngineMonitoring(updates: EngineMonitoringUpdate): Promise<Record<string, unknown>> {
  const response = await fetch("http://127.0.0.1:4117/monitoring", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(updates) });
  if (!response.ok) throw new Error(`Could not apply protection monitoring (${response.status})`);
  return await response.json() as Record<string, unknown>;
}

function applyStartup(settings: Record<string, unknown>): void {
  app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup === true, args: ["--viai-background", ...(settings.startMinimized === true ? ["--viai-minimized"] : [])] });
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return;
  tray = undefined;
  const iconPath = join(app.getAppPath(), "public", "viai-logodone.png");
  tray = new Tray(existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip(APPLICATION_NAME);
  tray.on("double-click", () => showMainWindow());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open viAI Security", click: () => createWindow() },
    { label: "Quick Scan", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "quick-scan"); } },
    { type: "separator" },
    { label: "Pause Monitoring", click: () => void backgroundService?.update({ backgroundProtection: false }) },
    { label: "Resume Monitoring", click: () => void backgroundService?.update({ backgroundProtection: true }) },
    { label: "Open Realtime Protection", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "realtime"); } },
    { label: "Open History", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "history"); } },
    { label: "Settings", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "settings"); } },
    { type: "separator" },
    { label: "Exit viAI Security", click: () => { quitting = true; app.quit(); } },
  ]));
}

function deliverNativeNotification(payload: NativeNotificationPayload): void {
  const notification = new Notification({ title: payload.title, body: payload.body, silent: payload.silent });
  notification.on("click", () => activateNotificationTarget(payload.target));
  notification.show();
}

function activateNotificationTarget(target: unknown): void {
  if (!isNotificationTarget(target)) return;
  pendingNotificationTarget = target;
  showMainWindow();
  deliverPendingNavigation();
}

function deliverPendingNavigation(): void {
  if (!pendingNotificationTarget || !rendererReady || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("notification:navigate", pendingNotificationTarget);
  pendingNotificationTarget = undefined;
}

function notifyAnalysis(body: Record<string, unknown>, assessmentId?: string): void {
  const settings = backgroundService?.snapshot().settings;
  if (!settings) return;
  const notification = notificationForAnalysis(body);
  windowsNotifications.notify(settings, {
    category: "assessment",
    setting: notification.setting,
    title: notification.title,
    body: notification.body,
    target: assessmentId ? { route: "history-detail", assessmentId } : { route: "history" },
    dedupeKey: notification.dedupeKey,
  });
}

function notifyScanCompleted(scan: Omit<PersistedScanState, "pendingFiles">): void {
  const settings = backgroundService?.snapshot().settings;
  if (!settings) return;
  const label = scan.mode === "full" ? "Full scan" : scan.mode === "quick" ? "Quick scan" : "Folder scan";
  const attention = scan.investigationCount > 0 ? ` ${scan.investigationCount} item${scan.investigationCount === 1 ? "" : "s"} need your attention.` : " No items need your attention.";
  windowsNotifications.notify(settings, {
    category: "scan",
    setting: "notifyScanCompleted",
    title: `${label} completed`,
    body: `${scan.filesCompleted.toLocaleString()} files processed.${attention}`,
    target: { route: "full-scan", scanId: scan.id },
    dedupeKey: `scan:${scan.id}`,
  });
}

function notifyProtectionFailure(): void {
  const settings = backgroundService?.snapshot().settings;
  if (!settings || settings.backgroundProtection !== true) return;
  windowsNotifications.notify(settings, {
    category: "protection",
    setting: "notifyProtectionFailures",
    title: "viAI Protection",
    body: "Realtime protection needs attention. One or more monitoring components could not start.",
    target: { route: "realtime" },
    dedupeKey: "protection:device-security-degraded",
    dedupeWindowMs: 300_000,
  });
}

async function recordDeviceEvents(snapshot: DeviceSecuritySnapshot, events: readonly DeviceSecuritySnapshot["history"][number][]): Promise<void> {
  const settings = backgroundService?.snapshot().settings;
  if (!settings || events.length === 0) return;
  for (const event of events) {
    const device = snapshot.devices.find((entry) => entry.id === event.deviceId);
    if (!device?.isStorageDevice) continue;
    await backgroundService?.recordEvent(`Device Security: ${event.detail}`);
    const notify = event.type === "device-connected" ? settings.notifyUsbConnected === true
      : event.type === "device-removed" ? settings.notifyUsbRemoved === true : false;
    if (!notify) continue;
    const connected = event.type === "device-connected";
    windowsNotifications.notify(settings, {
      category: "device",
      setting: connected ? "notifyUsbConnected" : "notifyUsbRemoved",
      title: "viAI Device Security",
      body: connected ? `Removable storage connected: ${device.friendlyName}` : `Removable storage removed: ${device.friendlyName}`,
      target: { route: "device-security", deviceId: device.id },
      dedupeKey: `device:${event.type}:${device.id}`,
    });
  }
}

function startEngineEventPolling(): void {
  if (engineEventTimer) return;
  void syncEngineEvents();
  engineEventTimer = setInterval(() => void syncEngineEvents(), 5_000);
}

async function syncEngineEvents(): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:4117/events?since=${encodeURIComponent(engineEventsSince)}`);
    if (!response.ok) return;
    const body = await response.json() as { analyses?: unknown[]; observations?: unknown[] };
    let newestEventAt = Date.parse(engineEventsSince);
    for (const analysis of body.analyses ?? []) {
      if (!analysis || typeof analysis !== "object") continue;
      const record = analysis as { analyzedAt?: unknown; evidenceStore?: { file?: { source?: unknown } } };
      const analyzedAt = record.analyzedAt;
      if (typeof analyzedAt === "string") newestEventAt = Math.max(newestEventAt, Date.parse(analyzedAt));
      const source = record.evidenceStore?.file?.source;
      const assessmentId = await backgroundService?.recordAnalysis({ analysis }, source === "download" || source === "filesystem" || source === "removable-media" ? "realtime" : "single-file");
      notifyAnalysis({ analysis }, assessmentId);
    }
    for (const observation of body.observations ?? []) {
      if (!observation || typeof observation !== "object") continue;
      const record = observation as { id?: unknown; detail?: unknown; category?: unknown; timestamp?: unknown };
      if (typeof record.timestamp === "string") newestEventAt = Math.max(newestEventAt, Date.parse(record.timestamp));
      if (typeof record.id === "string" && typeof record.detail === "string") await backgroundService?.recordEvent(`Engine ${typeof record.category === "string" ? `${record.category}: ` : ""}${record.detail}`, `engine:${record.id}`);
    }
    if (Number.isFinite(newestEventAt)) engineEventsSince = new Date(newestEventAt).toISOString();
  } catch {
    // The local engine may not have completed startup yet.
  }
}

function disposeMainResources(): void {
  if (disposing) return;
  disposing = true;
  if (engineEventTimer) clearInterval(engineEventTimer);
  engineEventTimer = undefined;
  deviceSecurity?.stop();
  deviceSecurity = undefined;
  if (tray) {
    tray.removeAllListeners();
    tray.destroy();
    tray = undefined;
  }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = undefined;
  if (engineProcess && !engineProcess.killed) engineProcess.kill();
  engineProcess = undefined;
  persistence?.database.close();
  persistence = undefined;
}
}

function abortError(): Error {
  const error = new Error("Scan cancelled");
  error.name = "AbortError";
  return error;
}

function streamCandidates(roots: string[], includeAllFiles: boolean, controller: ScanController | undefined, onBatch: (files: string[]) => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const signal = controller?.signal;
    const workers = roots.map((root) => new Worker(join(__dirname, "scanWorker.js"), { workerData: { root, includeAllFiles } }));
    let completed = 0;
    const settledWorkers = new Set<Worker>();
    let pending: string[] = [];
    let delivery = Promise.resolve();
    let queuedBatches = 0;
    let paused = false;
    let finished = false;
    const pauseLimit = 8;
    const resumeLimit = 3;
    const setPaused = (next: boolean) => {
      if (paused === next) return;
      paused = next;
      for (const worker of workers) worker.postMessage(next ? "pause" : "resume");
    };
    const syncPause = () => setPaused(controller?.state !== "running" || queuedBatches >= pauseLimit);
    const flush = () => {
      if (signal?.aborted) return;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      queuedBatches += 1;
      syncPause();
      delivery = delivery.then(() => signal?.aborted ? undefined : onBatch(batch)).finally(() => {
        queuedBatches -= 1;
        if (paused && queuedBatches <= resumeLimit) syncPause();
      });
    };
    const unsubscribe = controller?.onStateChange(syncPause);
    const finish = () => { if (finished) return; finished = true; signal?.removeEventListener("abort", abort); unsubscribe?.(); flush(); void delivery.then(resolve, resolve); };
    const abort = () => { workers.forEach((worker) => void worker.terminate()); finish(); };
    const settleWorker = (worker: Worker) => {
      if (settledWorkers.has(worker) || finished) return;
      settledWorkers.add(worker);
      completed += 1;
      if (completed === workers.length) finish();
    };
    signal?.addEventListener("abort", abort, { once: true });
    syncPause();
    if (workers.length === 0) finish();
    for (const worker of workers) {
      worker.on("message", (message: unknown) => {
        if (signal?.aborted || finished) return;
        if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete") { settleWorker(worker); return; }
        if (typeof message !== "string") return;
        pending.push(message);
        if (pending.length >= 64) flush();
      });
      worker.once("error", () => settleWorker(worker));
      worker.once("exit", () => settleWorker(worker));
    }
  });
}