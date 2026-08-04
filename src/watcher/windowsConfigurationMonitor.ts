import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EventManager } from "../core/eventManager.js";
import type { MonitorObservation } from "../types.js";

const execFileAsync = promisify(execFile);

export interface WindowsConfigurationPolicy {
  readonly monitorScheduledTasks: boolean;
  readonly monitorRegistryRunKeys: boolean;
  readonly monitorServices: boolean;
  readonly monitorDrivers: boolean;
}

type Category = Exclude<MonitorObservation["category"], "process">;

export class WindowsConfigurationMonitor {
  private timer?: NodeJS.Timeout;
  private policy?: WindowsConfigurationPolicy;
  private snapshots = new Map<Category, Set<string>>();

  constructor(private readonly eventManager: EventManager) {}

  start(policy: WindowsConfigurationPolicy, intervalMilliseconds = 15_000): boolean {
    this.policy = policy;
    if (this.timer) return true;
    if (process.platform !== "win32") return false;
    void this.refresh(true);
    this.timer = setInterval(() => void this.refresh(false), intervalMilliseconds);
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.snapshots.clear();
  }

  isActive(): boolean { return this.timer !== undefined; }

  private async refresh(initial: boolean): Promise<void> {
    if (process.platform !== "win32" || !this.policy) return;
    for (const category of selectedCategories(this.policy)) {
      const next = new Set(await snapshot(category));
      const prior = this.snapshots.get(category);
      if (!initial && prior) {
        const changes = [...next].filter((entry) => !prior.has(entry));
        if (changes.length > 0) this.eventManager.observe({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), category, detail: `${changes.length} new or changed ${displayName(category)} detected by local Windows observation.` });
      }
      this.snapshots.set(category, next);
    }
  }
}

export function selectedCategories(policy: WindowsConfigurationPolicy): Category[] {
  return [
    ...(policy.monitorScheduledTasks ? ["scheduled-task" as const] : []),
    ...(policy.monitorRegistryRunKeys ? ["registry-run-key" as const] : []),
    ...(policy.monitorServices ? ["service" as const] : []),
    ...(policy.monitorDrivers ? ["driver" as const] : []),
  ];
}

async function snapshot(category: Category): Promise<string[]> {
  const scripts: Record<Category, string> = {
    "scheduled-task": "Get-ScheduledTask | Select-Object TaskPath,TaskName,State | ConvertTo-Json -Compress",
    "registry-run-key": "$paths = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'); $paths | ForEach-Object { if (Test-Path $_) { Get-ItemProperty $_ | Select-Object * } } | ConvertTo-Json -Compress",
    service: "Get-CimInstance Win32_Service | Select-Object Name,PathName,StartMode,State | ConvertTo-Json -Compress",
    driver: "Get-CimInstance Win32_SystemDriver | Select-Object Name,PathName,StartMode,State | ConvertTo-Json -Compress",
  };
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", scripts[category]], { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    const value = JSON.parse(stdout) as unknown;
    return (Array.isArray(value) ? value : value ? [value] : []).map((entry) => JSON.stringify(entry));
  } catch {
    return [];
  }
}

function displayName(category: Category): string {
  return category === "scheduled-task" ? "scheduled task" : category === "registry-run-key" ? "Run key entry" : category;
}