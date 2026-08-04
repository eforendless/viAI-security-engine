import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

export type UpdateStatus = "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";

export interface UpdateSnapshot {
  status: UpdateStatus;
  currentVersion: string;
  version?: string;
  percent?: number;
  message: string;
}

export class UpdateService {
  private snapshotValue: UpdateSnapshot = { status: app.isPackaged ? "idle" : "unsupported", currentVersion: app.getVersion(), message: app.isPackaged ? "Ready to check for updates." : "Updates are available in installed releases." };

  initialize(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () => this.publish({ status: "checking", message: "Checking GitHub releases..." }));
    autoUpdater.on("update-available", (info) => this.publish({ status: "available", version: info.version, message: `Version ${info.version} is available.` }));
    autoUpdater.on("update-not-available", () => this.publish({ status: "not-available", message: "This device already has the latest release." }));
    autoUpdater.on("download-progress", (progress) => this.publish({ status: "downloading", percent: Math.round(progress.percent), message: "Downloading update..." }));
    autoUpdater.on("update-downloaded", (info) => this.publish({ status: "downloaded", version: info.version, percent: 100, message: `Version ${info.version} is ready to install.` }));
    autoUpdater.on("error", (error) => this.reportError("update", error, "The update could not be completed. Check your connection and try again."));
  }

  current(): UpdateSnapshot {
    return { ...this.snapshotValue };
  }

  async check(): Promise<UpdateSnapshot> {
    if (!app.isPackaged) return this.current();
    this.publish({ status: "checking", message: "Checking GitHub releases..." });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.reportError("check", error, "The update check failed. Check your connection and try again.");
    }
    return this.current();
  }

  async download(): Promise<UpdateSnapshot> {
    if (!app.isPackaged || this.snapshotValue.status !== "available") return this.current();
    this.publish({ status: "downloading", percent: 0, message: "Downloading update..." });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.reportError("download", error, "The update download failed. Check your connection and try again.");
    }
    return this.current();
  }

  install(): void {
    if (this.snapshotValue.status === "downloaded") autoUpdater.quitAndInstall();
  }

  private publish(update: Omit<UpdateSnapshot, "currentVersion">): void {
    this.snapshotValue = { ...update, currentVersion: app.getVersion() };
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updates:changed", this.current());
  }

  private reportError(operation: string, error: unknown, message: string): void {
    console.error(`Updater ${operation} failed`, error);
    this.publish({ status: "error", message });
  }
}
