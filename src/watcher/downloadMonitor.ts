import { homedir } from "node:os";
import { join } from "node:path";
import type { EventManager } from "../core/eventManager.js";
import { ExecutableMonitor, type FileMonitorPolicy } from "./executableMonitor.js";

export class DownloadMonitor {
  private readonly monitor: ExecutableMonitor;

  constructor(eventManager: EventManager, private readonly downloadDirectories = [join(homedir(), "Downloads")]) {
    this.monitor = new ExecutableMonitor(eventManager, "download");
  }

  start(policy: FileMonitorPolicy): void {
    this.monitor.watchDirectories(this.downloadDirectories, policy);
  }

  stop(): void {
    this.monitor.stop();
  }
}