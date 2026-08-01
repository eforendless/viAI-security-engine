import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("viaiStartup", {
  onProgress: (listener: (progress: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress);
    ipcRenderer.on("startup:progress", handler);
    return () => ipcRenderer.removeListener("startup:progress", handler);
  },
  onReady: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("startup:ready", handler);
    return () => ipcRenderer.removeListener("startup:ready", handler);
  },
  retry: () => ipcRenderer.invoke("startup:retry") as Promise<void>,
  exit: () => ipcRenderer.invoke("startup:exit") as Promise<void>,
  completeTransition: () => ipcRenderer.invoke("startup:complete-transition") as Promise<void>,
});