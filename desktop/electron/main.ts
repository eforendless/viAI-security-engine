import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";

const execFileAsync = promisify(execFile);
let engineProcess: ReturnType<typeof execFile> | undefined;

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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  engineProcess.on("error", (error) => console.error("Unable to start viAI engine", error));
  engineProcess.stderr?.on("data", (output) => console.error(`viAI engine error: ${String(output).trim()}`));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "viAI Desktop",
    backgroundColor: "#f5f8ff",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  startEngine();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => engineProcess?.kill());

ipcMain.handle("dialog:pick-file", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "All files", extensions: ["*"] }] });
  return result.canceled ? undefined : result.filePaths[0];
});

ipcMain.handle("dialog:pick-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? undefined : result.filePaths[0];
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

ipcMain.handle("engine:set-monitoring", async (_event, updates: Record<string, boolean>) => {
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