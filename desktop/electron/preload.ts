import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("viai", {
  application: {
    version: () => ipcRenderer.invoke("application:version") as Promise<string>,
  },
  updates: {
    snapshot: () => ipcRenderer.invoke("updates:snapshot") as Promise<unknown>,
    check: () => ipcRenderer.invoke("updates:check") as Promise<unknown>,
    download: () => ipcRenderer.invoke("updates:download") as Promise<unknown>,
    install: () => ipcRenderer.invoke("updates:install") as Promise<void>,
    onChanged: (listener: (update: unknown) => void) => { const handler = (_event: Electron.IpcRendererEvent, update: unknown) => listener(update); ipcRenderer.on("updates:changed", handler); return () => ipcRenderer.removeListener("updates:changed", handler); },
  },
  background: {
    snapshot: () => ipcRenderer.invoke("background:snapshot") as Promise<unknown>,
    update: (changes: Record<string, unknown>) => ipcRenderer.invoke("background:update", changes) as Promise<unknown>,
    restoreRecommended: () => ipcRenderer.invoke("background:restore-recommended") as Promise<unknown>,
    restoreFactory: () => ipcRenderer.invoke("background:restore-factory") as Promise<unknown>,
    exportSettings: () => ipcRenderer.invoke("background:export") as Promise<string | undefined>,
    importSettings: (serialized: string) => ipcRenderer.invoke("background:import", serialized) as Promise<unknown>,
    clearHistory: () => ipcRenderer.invoke("background:clear-history") as Promise<void>,
    onChanged: (listener: (snapshot: unknown) => void) => { const handler = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot); ipcRenderer.on("background:changed", handler); return () => ipcRenderer.removeListener("background:changed", handler); },
    onCommand: (listener: (command: "quick-scan" | "realtime" | "history" | "settings") => void) => { const handler = (_event: Electron.IpcRendererEvent, command: "quick-scan" | "realtime" | "history" | "settings") => listener(command); ipcRenderer.on("background:command", handler); return () => ipcRenderer.removeListener("background:command", handler); },
  },
  deviceSecurity: {
    snapshot: () => ipcRenderer.invoke("device-security:snapshot") as Promise<unknown>,
    setTrust: (deviceId: string, trusted: boolean) => ipcRenderer.invoke("device-security:set-trust", deviceId, trusted) as Promise<void>,
    block: (deviceId: string) => ipcRenderer.invoke("device-security:block", deviceId) as Promise<void>,
    scan: (deviceId: string) => ipcRenderer.invoke("device-security:scan", deviceId) as Promise<void>,
    onChanged: (listener: (update: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, update: unknown) => listener(update);
      ipcRenderer.on("device-security:changed", handler);
      return () => ipcRenderer.removeListener("device-security:changed", handler);
    },
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("window-controls:minimize") as Promise<void>,
    maximize: () => ipcRenderer.invoke("window-controls:maximize") as Promise<void>,
    close: () => ipcRenderer.invoke("window-controls:close") as Promise<void>,
  },
  chooseFile: () => ipcRenderer.invoke("dialog:pick-file") as Promise<string | undefined>,
  chooseFolder: () => ipcRenderer.invoke("dialog:pick-folder") as Promise<string | undefined>,
  openPath: (filePath: string) => ipcRenderer.invoke("shell:open-path", filePath) as Promise<string>,
  scans: {
    start: (mode: "quick" | "full" | "folder", target?: string) => ipcRenderer.invoke("scan:start", mode, target) as Promise<unknown>,
    pause: () => ipcRenderer.invoke("scan:pause") as Promise<void>,
    resume: () => ipcRenderer.invoke("scan:resume") as Promise<void>,
    cancel: () => ipcRenderer.invoke("scan:cancel") as Promise<void>,
    onEvent: (listener: (update: unknown) => void) => { const handler = (_event: Electron.IpcRendererEvent, update: unknown) => listener(update); ipcRenderer.on("scan:event", handler); return () => ipcRenderer.removeListener("scan:event", handler); },
  },
  listFiles: (roots: string[], maxFiles?: number) => ipcRenderer.invoke("scan:list-files", roots, maxFiles) as Promise<string[]>,
  systemRoots: () => ipcRenderer.invoke("scan:system-roots") as Promise<string[]>,
  analyzeFile: (filePath: string) => ipcRenderer.invoke("engine:analyze", filePath) as Promise<unknown>,
  probeEngine: () => ipcRenderer.invoke("engine:probe") as Promise<boolean>,
  engineEvents: () => ipcRenderer.invoke("engine:events") as Promise<unknown[]>,
  monitoringStatus: () => ipcRenderer.invoke("engine:monitoring") as Promise<unknown>,
  setMonitoring: (updates: Record<string, boolean | string[]>) => ipcRenderer.invoke("engine:set-monitoring", updates) as Promise<unknown>,
});