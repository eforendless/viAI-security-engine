import { existsSync, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, extname, relative, resolve } from "node:path";
import type { EventManager } from "../core/eventManager.js";
import type { FileActivityEvent } from "../types.js";

export interface FileMonitorPolicy {
  readonly extensions: readonly string[];
  readonly excludedFolders?: readonly string[];
  readonly excludedFiles?: readonly string[];
  readonly excludedExtensions?: readonly string[];
  readonly scanUnknownFileTypes?: boolean;
  readonly reportCreated?: boolean;
  readonly reportModified?: boolean;
}

export class ExecutableMonitor {
  private watchers: FSWatcher[] = [];

  constructor(private readonly eventManager: EventManager, private readonly source: FileActivityEvent["source"] = "filesystem") {}

  watchDirectories(directories: readonly string[], policy: FileMonitorPolicy): void {
    this.stop();
    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      const watcher = watch(directory, { recursive: process.platform === "win32" }, (eventType, fileName) => {
        if (!fileName) return;
        const filePath = resolve(directory, fileName.toString());
        const kind = eventType === "rename" ? "created" : "modified";
        if ((kind === "created" && policy.reportCreated === false) || (kind === "modified" && policy.reportModified === false)) return;
        void this.reportIfCandidate(filePath, kind, policy);
      });
      watcher.on("error", (error) => this.eventManager.emit("monitor-error", error, directory));
      this.watchers.push(watcher);
    }
  }

  reportExecutionAttempt(filePath: string, parentProcess?: string): void {
    if (!isMonitoredCandidate(filePath, { extensions: [".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".jar"] })) return;
    this.eventManager.publish(this.event(filePath, "execution-attempt", parentProcess));
  }

  stop(): void {
    this.watchers.splice(0).forEach((watcher) => watcher.close());
  }

  private async reportIfCandidate(filePath: string, kind: "created" | "modified", policy: FileMonitorPolicy): Promise<void> {
    if (!isMonitoredCandidate(filePath, policy)) return;
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

export function isMonitoredCandidate(filePath: string, policy: FileMonitorPolicy): boolean {
  const normalizedPath = resolve(filePath).toLowerCase();
  const normalizedExtension = extname(normalizedPath).toLowerCase();
  const excludedFiles = new Set((policy.excludedFiles ?? []).map((entry) => resolve(entry).toLowerCase()));
  if (excludedFiles.has(normalizedPath)) return false;
  const excludedExtensions = new Set((policy.excludedExtensions ?? []).map(normalizeExtension));
  if (excludedExtensions.has(normalizedExtension)) return false;
  if ((policy.excludedFolders ?? []).some((folder) => isWithin(normalizedPath, resolve(folder).toLowerCase()))) return false;
  const extensions = new Set(policy.extensions.map(normalizeExtension));
  return extensions.has(normalizedExtension) || (policy.scanUnknownFileTypes === true && normalizedExtension.length > 0);
}

function isWithin(filePath: string, folder: string): boolean {
  const pathToFolder = relative(folder, filePath);
  return pathToFolder === "" || (!pathToFolder.startsWith("..") && !pathToFolder.includes(".."));
}

function normalizeExtension(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}