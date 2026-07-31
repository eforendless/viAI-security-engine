import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("viai", {
  chooseFile: () => ipcRenderer.invoke("dialog:pick-file") as Promise<string | undefined>,
  chooseFolder: () => ipcRenderer.invoke("dialog:pick-folder") as Promise<string | undefined>,
  openPath: (filePath: string) => ipcRenderer.invoke("shell:open-path", filePath) as Promise<string>,
  listFiles: (roots: string[], maxFiles?: number) => ipcRenderer.invoke("scan:list-files", roots, maxFiles) as Promise<string[]>,
  systemRoots: () => ipcRenderer.invoke("scan:system-roots") as Promise<string[]>,
  analyzeFile: (filePath: string) => ipcRenderer.invoke("engine:analyze", filePath) as Promise<unknown>,
  probeEngine: () => ipcRenderer.invoke("engine:probe") as Promise<boolean>,
});