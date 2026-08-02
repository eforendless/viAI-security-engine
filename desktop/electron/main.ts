import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { DeviceSecurityService, type DeviceSecuritySnapshot } from "./deviceSecurity";
import { BackgroundService, type BackgroundSnapshot, type EngineMonitoringUpdate, type PersistedScanState } from "./backgroundService";
import { ScanService, type ScanEventName } from "./scanService";
import { StartupManager, type StartupProgress } from "./startup";
import { UpdateService } from "./updater";

const execFileAsync = promisify(execFile);
const isPrimaryInstance = app.requestSingleInstanceLock();
let engineProcess: ReturnType<typeof execFile> | undefined;
let deviceSecurity: DeviceSecurityService | undefined;
let backgroundService: BackgroundService | undefined;
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
const launchedInBackground = process.argv.includes("--viai-background");

if (!isPrimaryInstance) app.quit();
if (isPrimaryInstance) {

function publishDeviceSecurity(snapshot: DeviceSecuritySnapshot, events: readonly DeviceSecuritySnapshot["history"][number][]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("device-security:changed", { snapshot, events });
  void recordDeviceEvents(snapshot, events);
}

function publishBackground(snapshot: BackgroundSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("background:changed", snapshot);
  applyStartup(snapshot.settings);
}

function publishScan(event: ScanEventName, scan: Omit<PersistedScanState, "pendingFiles">): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("scan:event", { event, scan });
}

function enginePaths(): { entry: string; workingDirectory: string } {
  if (app.isPackaged) {
    const workingDirectory = join(process.resourcesPath, "engine");
    return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
  }
  const workingDirectory = join(__dirname, "..", "..");
  return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VIAI_DEVICE_SECURITY: "1" },
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
    title: "viAI security",
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
  window.on("closed", () => { if (mainWindow === window) mainWindow = undefined; });

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
    skipTaskbar: false,
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
    { id: "engine", name: "Initializing analysis, rules, and trust engines", weight: 25, dependencies: ["configuration"], execute: async () => { await startEngine(); await waitForEngineReady(); } },
    { id: "persistence", name: "Loading user settings and local persistence", weight: 20, dependencies: ["engine"], execute: async () => { backgroundService = new BackgroundService(join(app.getPath("userData"), "background-settings.json"), applyEngineMonitoring, publishBackground); startupSnapshot = await backgroundService.initialize(); applyStartup(startupSnapshot.settings); } },
    { id: "devices", name: "Loading device cache and USB monitoring", weight: 15, dependencies: ["persistence"], execute: async () => { deviceSecurity = new DeviceSecurityService(join(app.getPath("userData"), "device-security.json"), publishDeviceSecurity, () => { const settings = backgroundService?.snapshot().settings; return { monitorUsbStorage: settings?.monitorUsbStorage === true, monitorUsbInsertion: settings?.monitorUsbInsertion === true, automaticallyScanUsb: settings?.automaticallyScanUsb === true }; }); await deviceSecurity.start(); } },
    { id: "recovery", name: "Checking persisted scan recovery", weight: 10, dependencies: ["persistence"], execute: async () => { if (!backgroundService) throw new Error("Background persistence is unavailable."); scanService = new ScanService(backgroundService, (filePath, scanType) => analyzeEngineFile(filePath, scanType), publishScan); await scanService.recover(); } },
    { id: "notifications", name: "Preparing local notifications", weight: 5, dependencies: ["persistence"], execute: async () => { Notification.isSupported(); } },
    { id: "tray", name: "Creating secure system tray service", weight: 5, dependencies: ["persistence"], execute: async () => { createTray(); } },
    { id: "dashboard", name: "Preparing secure dashboard", weight: 15, dependencies: ["devices", "recovery", "notifications", "tray"], execute: prepareDashboard },
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
    startupComplete = true;
    if (startupSnapshot?.settings.notifyBackgroundStarted === true) showNotification(startupSnapshot.settings, "viAI background protection", "Local monitoring is running.");
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send("startup:ready");
    else completeStartupTransition();
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
  const startSilently = launchedInBackground && startupSnapshot?.settings.startSilently === true;
  if (!startSilently || restoreAfterStartup) showMainWindow();
  startEngineEventPolling();
  void backgroundService?.loadHistory().catch((error) => console.error("Could not load deferred local history", error));
}

app.on("second-instance", () => { if (app.isReady()) showMainWindow(); });

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

ipcMain.handle("background:snapshot", () => backgroundService?.snapshot());
ipcMain.handle("background:update", async (_event, changes: Record<string, unknown>) => {
  if (!changes || typeof changes !== "object") throw new Error("Invalid background settings update");
  return backgroundService?.update(changes);
});
ipcMain.handle("background:restore-recommended", () => backgroundService?.restoreRecommended());
ipcMain.handle("background:restore-factory", () => backgroundService?.restoreFactory());
ipcMain.handle("background:export", () => backgroundService?.exportSettings());
ipcMain.handle("background:import", async (_event, serialized: string) => {
  if (typeof serialized !== "string" || serialized.length > 256_000) throw new Error("Invalid settings import");
  return backgroundService?.importSettings(serialized);
});
ipcMain.handle("background:clear-history", () => backgroundService?.clearHistory());

ipcMain.handle("scan:start", async (_event, mode: "quick" | "full" | "folder", target?: string) => {
  if (!scanService || !backgroundService || !["quick", "full", "folder"].includes(mode)) throw new Error("Scan service is not ready");
  const settings = backgroundService.snapshot().settings;
  let files: string[];
  if (mode === "quick") {
    if (typeof target !== "string" || !existsSync(target)) throw new Error("Choose an existing file to scan");
    files = [target];
  } else if (mode === "folder") {
    if (typeof target !== "string" || !existsSync(target)) throw new Error("Choose an existing folder to scan");
    files = await collectCandidates([target], 1_000);
  } else {
    const home = homedir();
    const performanceMode = settings.performanceMode === "light" || settings.performanceMode === "deep" ? settings.performanceMode : "balanced";
    const roots = fullScanRoots(performanceMode, home, await fixedDrives(), await removableDrives());
    files = await collectCandidates(roots.filter(existsSync), Infinity, performanceMode === "deep");
    target = performanceMode === "deep" ? "All accessible PC files" : performanceMode === "light" ? "Important Windows locations" : "Common Windows locations";
  }
  const configuredParallel = typeof settings.maximumParallelScans === "number" ? settings.maximumParallelScans : 0;
  const parallel = configuredParallel || (settings.performanceMode === "light" ? 1 : settings.performanceMode === "deep" ? 8 : 4);
  return scanService.start(mode, target ?? "", files, parallel);
});
ipcMain.handle("scan:pause", () => scanService?.pause());
ipcMain.handle("scan:resume", () => scanService?.resume());
ipcMain.handle("scan:cancel", () => scanService?.cancel());

ipcMain.handle("device-security:snapshot", () => deviceSecurity?.snapshot() ?? { devices: [], history: [], scans: [], policies: {} });
ipcMain.handle("device-security:set-trust", async (_event, deviceId: string, trusted: boolean) => {
  if (typeof deviceId !== "string" || typeof trusted !== "boolean") throw new Error("Invalid device trust request");
  await deviceSecurity?.setTrust(deviceId, trusted);
});
ipcMain.handle("device-security:block", async (_event, deviceId: string) => {
  if (typeof deviceId !== "string") throw new Error("Invalid device block request");
  await deviceSecurity?.block(deviceId);
});
ipcMain.handle("device-security:scan", async (_event, deviceId: string) => {
  if (typeof deviceId !== "string") throw new Error("Invalid device scan request");
  await deviceSecurity?.scanDevice(deviceId);
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

ipcMain.handle("engine:analyze", async (_event, filePath: string) => analyzeEngineFile(filePath));

async function analyzeEngineFile(filePath: string, scanType: "quick" | "full" | "folder" | "single-file" | "realtime" = "single-file"): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  try {
    const response = await fetch(engineUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: filePath }),
      signal: AbortSignal.timeout(engineAnalysisTimeoutMs),
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
    await backgroundService?.recordAnalysis(body, scanType, Date.now() - startedAt, scanType === "quick" || scanType === "full" || scanType === "folder");
    notifyAnalysis(body);
    return body;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("Local analysis timed out after 2 minutes; the file was skipped.");
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

function collectCandidates(roots: string[], maxFiles: number, includeAllFiles = false): Promise<string[]> {
  return new Promise((resolve) => {
    const files: string[] = [];
    const workers = roots.map((root) => new Worker(join(__dirname, "scanWorker.js"), { workerData: { root, includeAllFiles } }));
    let completed = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      workers.forEach((worker) => void worker.terminate());
      resolve(files);
    };
    if (workers.length === 0) finish();
    for (const worker of workers) {
      worker.on("message", (filePath: string) => {
        if (finished) return;
        files.push(filePath);
        if (files.length >= maxFiles) finish();
      });
      worker.once("error", () => undefined);
      worker.once("exit", () => {
        completed += 1;
        if (completed === workers.length) finish();
      });
    }
  });
}

async function applyEngineMonitoring(updates: EngineMonitoringUpdate): Promise<void> {
  try { await fetch("http://127.0.0.1:4117/monitoring", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(updates) }); } catch { /* The child engine may still be starting. */ }
}

function applyStartup(settings: Record<string, unknown>): void {
  app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup === true, args: ["--viai-background", ...(settings.startMinimized === true ? ["--viai-minimized"] : [])] });
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return;
  tray = undefined;
  const iconPath = join(app.getAppPath(), "public", "icon.ico");
  tray = new Tray(existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip("viAI Local Security Engine");
  tray.on("double-click", () => showMainWindow());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open viAI", click: () => createWindow() },
    { label: "Quick Scan", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "quick-scan"); } },
    { type: "separator" },
    { label: "Pause Monitoring", click: () => void backgroundService?.update({ backgroundProtection: false }) },
    { label: "Resume Monitoring", click: () => void backgroundService?.update({ backgroundProtection: true }) },
    { label: "Open Realtime Protection", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "realtime"); } },
    { label: "Open History", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "history"); } },
    { label: "Settings", click: () => { createWindow(); mainWindow?.webContents.send("background:command", "settings"); } },
    { type: "separator" },
    { label: "Exit", click: () => { quitting = true; app.quit(); } },
  ]));
}

function showNotification(settings: Record<string, unknown>, title: string, body: string): void {
  if (settings.windowsNotifications === true && Notification.isSupported()) new Notification({ title, body, silent: settings.soundNotifications !== true }).show();
}

function notifyAnalysis(body: Record<string, unknown>): void {
  const settings = backgroundService?.snapshot().settings;
  if (!settings) return;
  const riskScore = typeof body.riskScore === "number" ? body.riskScore : 0;
  const enabled = riskScore >= 61 ? settings.notifyHighRisk === true : riskScore >= 26 ? settings.notifyMediumRisk === true : settings.notifySafeScan === true;
  if (enabled) showNotification(settings, riskScore >= 61 ? "viAI high-risk evidence" : "viAI scan complete", `Local static analysis returned risk score ${riskScore}.`);
}

async function recordDeviceEvents(snapshot: DeviceSecuritySnapshot, events: readonly DeviceSecuritySnapshot["history"][number][]): Promise<void> {
  const settings = backgroundService?.snapshot().settings;
  if (!settings || events.length === 0) return;
  for (const event of events) {
    const device = snapshot.devices.find((entry) => entry.id === event.deviceId);
    if (device?.connectionType !== "usb" && !device?.isStorageDevice) continue;
    await backgroundService?.recordEvent(`Device Security: ${event.detail}`);
    const notify = event.type === "device-connected" ? settings.notifyUsbConnected === true
      : event.type === "device-removed" ? settings.notifyUsbRemoved === true
        : event.type === "scan-finished" ? settings.notifyScanCompleted === true
          : event.type === "threat-detected" ? settings.notifyHighRisk === true
            : false;
    if (notify) showNotification(settings, event.type === "threat-detected" ? "viAI removable media alert" : "viAI Device Security", event.detail);
  }
}

function startEngineEventPolling(): void {
  if (engineEventTimer) return;
  void syncEngineEvents();
  engineEventTimer = setInterval(() => void syncEngineEvents(), 5_000);
}

async function syncEngineEvents(): Promise<void> {
  try {
    const response = await fetch("http://127.0.0.1:4117/events");
    if (!response.ok) return;
    const body = await response.json() as { analyses?: unknown[]; observations?: unknown[] };
    for (const analysis of body.analyses ?? []) if (analysis && typeof analysis === "object") await backgroundService?.recordAnalysis({ analysis });
    for (const observation of body.observations ?? []) {
      if (!observation || typeof observation !== "object") continue;
      const record = observation as { id?: unknown; detail?: unknown; category?: unknown };
      if (typeof record.id === "string" && typeof record.detail === "string") await backgroundService?.recordEvent(`Engine ${typeof record.category === "string" ? `${record.category}: ` : ""}${record.detail}`, `engine:${record.id}`);
    }
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
}
}