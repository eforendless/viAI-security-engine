import { existsSync, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { isExecutableCandidate } from "../analyzer/metadataExtractor.js";
import type { EventManager } from "../core/eventManager.js";
import type { FileActivityEvent } from "../types.js";

export class ExecutableMonitor {
  private watchers: FSWatcher[] = [];

  constructor(private readonly eventManager: EventManager, private readonly source: FileActivityEvent["source"] = "filesystem") {}

  watchDirectories(directories: string[]): void {
    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      const watcher = watch(directory, { recursive: process.platform === "win32" }, (eventType, fileName) => {
        if (!fileName) return;
        const filePath = resolve(directory, fileName.toString());
        void this.reportIfExecutable(filePath, eventType === "rename" ? "created" : "modified");
      });
      watcher.on("error", (error) => this.eventManager.emit("monitor-error", error, directory));
      this.watchers.push(watcher);
    }
  }

  reportExecutionAttempt(filePath: string, parentProcess?: string): void {
    if (!isExecutableCandidate(filePath)) return;
    this.eventManager.publish(this.event(filePath, "execution-attempt", parentProcess));
  }

  stop(): void {
    this.watchers.splice(0).forEach((watcher) => watcher.close());
  }

  private async reportIfExecutable(filePath: string, kind: "created" | "modified"): Promise<void> {
    if (!isExecutableCandidate(filePath)) return;
    try {
      if ((await stat(filePath)).isFile()) this.eventManager.publish(this.event(filePath, kind));
    } catch {
      // A rename notification can arrive after a temporary or deleted file has disappeared.
    }
  }

  private event(filePath: string, kind: FileActivityEvent["kind"], parentProcess?: string): FileActivityEvent {
    return {
      path: filePath,
      timestamp: new Date().toISOString(),
      source: this.source,
      kind,
      parentProcess,
      userContext: userInfo().username,
    };
  }
}