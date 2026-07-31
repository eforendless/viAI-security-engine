import { homedir } from "node:os";
import { join } from "node:path";
import type { EventManager } from "../core/eventManager.js";
import { ExecutableMonitor } from "./executableMonitor.js";

export class DownloadMonitor {
  private readonly monitor: ExecutableMonitor;

  constructor(eventManager: EventManager, private readonly downloadDirectories = [join(homedir(), "Downloads")]) {
    this.monitor = new ExecutableMonitor(eventManager, "download");
  }

  start(): void {
    this.monitor.watchDirectories(this.downloadDirectories);
  }

  stop(): void {
    this.monitor.stop();
  }
}