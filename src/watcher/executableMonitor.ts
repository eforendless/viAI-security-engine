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
  private pending = new Map<string, NodeJS.Timeout>();
  private reported = new Map<string, string>();
  private failed = false;

  constructor(private readonly eventManager: EventManager, private readonly source: FileActivityEvent["source"] = "filesystem") {}

  watchDirectories(directories: readonly string[], policy: FileMonitorPolicy): boolean {
    this.stop();
    this.failed = false;
    for (const directory of directories) {
      if (!existsSync(directory)) continue;
      try {
        const watcher = watch(directory, { recursive: process.platform === "win32" }, (eventType, fileName) => {
          if (!fileName) return;
          const filePath = resolve(directory, fileName.toString());
          const kind = eventType === "rename" ? "created" : "modified";
          if ((kind === "created" && policy.reportCreated === false) || (kind === "modified" && policy.reportModified === false)) return;
          this.scheduleCandidate(filePath, kind, policy);
        });
        watcher.on("error", (error) => { this.failed = true; this.eventManager.emit("monitor-error", error, directory); });
        this.watchers.push(watcher);
      } catch (error) {
        this.failed = true;
        this.eventManager.emit("monitor-error", error, directory);
      }
    }
    return this.isActive();
  }

  reportExecutionAttempt(filePath: string, parentProcess?: string): void {
    if (!isMonitoredCandidate(filePath, { extensions: [".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".jar"] })) return;
    this.eventManager.publish(this.event(filePath, "execution-attempt", parentProcess));
  }

  stop(): void {
    this.watchers.splice(0).forEach((watcher) => watcher.close());
    this.pending.forEach((timer) => clearTimeout(timer));
    this.pending.clear();
    this.reported.clear();
  }

  isActive(): boolean { return this.watchers.length > 0 && !this.failed; }

  private scheduleCandidate(filePath: string, kind: "created" | "modified", policy: FileMonitorPolicy): void {
    const normalized = resolve(filePath).toLowerCase();
    if (isTemporaryDownload(filePath) || !isMonitoredCandidate(filePath, policy)) return;
    const pending = this.pending.get(normalized);
    if (pending) clearTimeout(pending);
    this.pending.set(normalized, setTimeout(() => void this.reportWhenStable(filePath, kind, policy), 750));
  }

  private async reportWhenStable(filePath: string, kind: "created" | "modified", policy: FileMonitorPolicy): Promise<void> {
    const normalized = resolve(filePath).toLowerCase();
    this.pending.delete(normalized);
    try {
      const initial = await stat(filePath);
      if (!initial.isFile()) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      const current = await stat(filePath);
      if (!current.isFile()) return;
      if (initial.size !== current.size || initial.mtimeMs !== current.mtimeMs) {
        this.scheduleCandidate(filePath, kind, policy);
        return;
      }
      const identity = `${current.size}:${current.mtimeMs}`;
      if (this.reported.get(normalized) === identity) return;
      this.reported.set(normalized, identity);
      this.eventManager.publish(this.event(filePath, kind));
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

export function isTemporaryDownload(filePath: string): boolean {
  return [".crdownload", ".download", ".opdownload", ".part", ".partial", ".tmp"].includes(extname(filePath).toLowerCase());
}