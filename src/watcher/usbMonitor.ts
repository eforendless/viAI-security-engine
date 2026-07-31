import { execFile } from "node:child_process";
import { opendir } from "node:fs/promises";
import { promisify } from "node:util";
import { isExecutableCandidate } from "../analyzer/metadataExtractor.js";
import type { EventManager } from "../core/eventManager.js";

const execFileAsync = promisify(execFile);

export class UsbMonitor {
  private timer?: NodeJS.Timeout;

  constructor(private readonly eventManager: EventManager, private readonly maxFilesPerDrive = 10_000) {}

  start(intervalMilliseconds = 60_000): void {
    if (this.timer) return;
    void this.scanConnectedDrives();
    this.timer = setInterval(() => void this.scanConnectedDrives(), intervalMilliseconds);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async scanConnectedDrives(): Promise<void> {
    for (const drive of await this.getRemovableDrives()) {
      let scanned = 0;
      for await (const filePath of walkFiles(drive)) {
        if (scanned++ >= this.maxFilesPerDrive) break;
        if (isExecutableCandidate(filePath)) {
          this.eventManager.publish({ path: filePath, timestamp: new Date().toISOString(), source: "removable-media", kind: "discovered" });
        }
      }
    }
  }

  private async getRemovableDrives(): Promise<string[]> {
    if (process.platform !== "win32") return [];
    const script = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object -ExpandProperty DeviceID | ConvertTo-Json -Compress";
    try {
      const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10_000 });
      const values = JSON.parse(stdout) as string | string[] | null;
      return (Array.isArray(values) ? values : values ? [values] : []).map((drive) => `${drive}\\`);
    } catch {
      return [];
    }
  }
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  let handle;
  try {
    handle = await opendir(directory);
    for await (const entry of handle) {
      const path = `${directory}${directory.endsWith("\\") ? "" : "\\"}${entry.name}`;
      if (entry.isDirectory()) yield* walkFiles(path);
      else if (entry.isFile()) yield path;
    }
  } catch {
    return;
  }
}