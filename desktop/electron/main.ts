import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } from "electron";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { DeviceSecurityService, type DeviceSecuritySnapshot } from "./deviceSecurity";
import { BackgroundService, type BackgroundSnapshot, type EngineMonitoringUpdate } from "./backgroundService";

const execFileAsync = promisify(execFile);
let engineProcess: ReturnType<typeof execFile> | undefined;
let deviceSecurity: DeviceSecurityService | undefined;
let backgroundService: BackgroundService | undefined;
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let engineEventTimer: NodeJS.Timeout | undefined;

function publishDeviceSecurity(snapshot: DeviceSecuritySnapshot, events: readonly DeviceSecuritySnapshot["history"][number][]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("device-security:changed", { snapshot, events });
  void recordDeviceEvents(snapshot, events);
}

function publishBackground(snapshot: BackgroundSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("background:changed", snapshot);
  applyStartup(snapshot.settings);
}

function enginePaths(): { entry: string; workingDirectory: string } {
  if (app.isPackaged) {
    const workingDirectory = join(process.resourcesPath, "engine");
    return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
  }
  const workingDirectory = join(__dirname, "..", "..");
  return { entry: join(workingDirectory, "dist", "src", "index.js"), workingDirectory };
}

function startEngine(): void {
  if (process.env.VITE_DEV_SERVER_URL) return;
  const { entry, workingDirectory } = enginePaths();
  if (!existsSync(entry)) {
    console.error(`viAI engine entry point was not found: ${entry}`);
    return;
  }
  engineProcess = execFile(process.execPath, [entry], {
    cwd: workingDirectory,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", VIAI_DEVICE_SECURITY: "1" },
    windowsHide: true,
  });
  engineProcess.on("error", (error) => console.error("Unable to start viAI engine", error));
  engineProcess.stderr?.on("data", (output) => console.error(`viAI engine error: ${String(output).trim()}`));
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); return; }
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "viAI Desktop",
    backgroundColor: "#f5f8ff",
    frame: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.on("close", (event) => {
    if (!quitting && backgroundService?.snapshot().settings.runAfterWindowCloses === true) { event.preventDefault(); window.hide(); }
  });
  window.on("minimize", () => {
    if (backgroundService?.snapshot().settings.minimizeToTray === true) window.hide();
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = undefined; });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  startEngine();
  backgroundService = new BackgroundService(join(app.getPath("userData"), "background-settings.json"), applyEngineMonitoring, publishBackground);
  void backgroundService.initialize().then((snapshot) => {
    applyStartup(snapshot.settings);
    createTray();
    if (!(process.argv.includes("--viai-background") && snapshot.settings.startSilently === true)) {
      createWindow();
      if (process.argv.includes("--viai-minimized") && snapshot.settings.startMinimized === true) mainWindow?.minimize();
    }
    if (snapshot.settings.notifyBackgroundStarted === true) showNotification(snapshot.settings, "viAI background protection", "Local monitoring is running.");
    startEngineEventPolling();
  });
  deviceSecurity = new DeviceSecurityService(join(app.getPath("userData"), "device-security.json"), publishDeviceSecurity, () => {
    const settings = backgroundService?.snapshot().settings;
    return { monitorUsbStorage: settings?.monitorUsbStorage === true, monitorUsbInsertion: settings?.monitorUsbInsertion === true, automaticallyScanUsb: settings?.automaticallyScanUsb === true };
  });
  void deviceSecurity.start();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => { if (!backgroundService?.snapshot().settings.runAfterWindowCloses && process.platform !== "darwin") { quitting = true; app.quit(); } });

app.on("before-quit", () => { quitting = true; engineProcess?.kill(); if (engineEventTimer) clearInterval(engineEventTimer); });
app.on("before-quit", () => deviceSecurity?.stop());

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

ipcMain.handle("engine:analyze", async (_event, filePath: string) => {
  const response = await fetch(engineUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: filePath }),
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
  await backgroundService?.recordAnalysis(body);
  notifyAnalysis(body);
  return body;
});

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

function collectCandidates(roots: string[], maxFiles: number): Promise<string[]> {
  return new Promise((resolve) => {
    const files: string[] = [];
    const workers = roots.map((root) => new Worker(join(__dirname, "scanWorker.js"), { workerData: { root } }));
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
  if (tray) return;
  const iconPath = join(app.getAppPath(), "public", "icon.ico");
  tray = new Tray(existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip("viAI Local Security Engine");
  tray.on("double-click", () => createWindow());
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