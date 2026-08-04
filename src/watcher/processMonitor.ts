import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EventManager } from "../core/eventManager.js";

const execFileAsync = promisify(execFile);

interface WindowsProcess {
  ProcessId?: number;
  ParentProcessId?: number;
  Name?: string;
  ExecutablePath?: string;
  CommandLine?: string;
}

export interface ProcessMonitorPolicy {
  readonly monitorNewProcesses: boolean;
  readonly monitorChildProcesses: boolean;
  readonly monitorSuspiciousCommandLines: boolean;
  readonly monitorPowerShell: boolean;
  readonly monitorCmd: boolean;
  readonly monitorWScript: boolean;
  readonly monitorMshta: boolean;
  readonly excludedProcesses: readonly string[];
}

export class ProcessMonitor {
  private timer?: NodeJS.Timeout;
  private knownProcessIds = new Set<number>();
  private policy?: ProcessMonitorPolicy;

  constructor(private readonly eventManager: EventManager) {}

  start(policy: ProcessMonitorPolicy, intervalMilliseconds = 5_000): boolean {
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
    this.knownProcessIds.clear();
  }

  isActive(): boolean { return this.timer !== undefined; }

  private async refresh(initial: boolean): Promise<void> {
    if (process.platform !== "win32" || !this.policy) return;
    const processes = await windowsProcesses();
    const currentIds = new Set(processes.flatMap((entry) => typeof entry.ProcessId === "number" ? [entry.ProcessId] : []));
    for (const entry of processes) {
      if (typeof entry.ProcessId !== "number" || this.knownProcessIds.has(entry.ProcessId) || initial || !shouldMonitorProcess(entry, this.policy, this.knownProcessIds)) continue;
      this.eventManager.observe({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), category: "process", detail: `Observed new process: ${entry.Name ?? "unknown process"}.` });
      if (typeof entry.ExecutablePath === "string" && existsSync(entry.ExecutablePath)) {
        this.eventManager.publish({ path: entry.ExecutablePath, timestamp: new Date().toISOString(), source: "filesystem", kind: "execution-attempt", parentProcess: entry.Name });
      }
    }
    this.knownProcessIds = currentIds;
  }
}

export function shouldMonitorProcess(processInfo: WindowsProcess, policy: ProcessMonitorPolicy, knownProcessIds: ReadonlySet<number> = new Set()): boolean {
  const name = (processInfo.Name ?? "").toLowerCase();
  if (!name || policy.excludedProcesses.some((entry) => entry.toLowerCase() === name)) return false;
  const commandLine = (processInfo.CommandLine ?? "").toLowerCase();
  const selectedHost = (policy.monitorPowerShell && /powershell|pwsh/.test(name)) || (policy.monitorCmd && name === "cmd.exe") || (policy.monitorWScript && /wscript|cscript/.test(name)) || (policy.monitorMshta && name === "mshta.exe");
  const suspiciousCommand = policy.monitorSuspiciousCommandLines && /(?:-enc(?:odedcommand)?\b|frombase64string|rundll32|regsvr32|bitsadmin)/.test(commandLine);
  const childProcess = policy.monitorChildProcesses && typeof processInfo.ParentProcessId === "number" && knownProcessIds.has(processInfo.ParentProcessId);
  return policy.monitorNewProcesses || childProcess || selectedHost || suspiciousCommand;
}

async function windowsProcesses(): Promise<WindowsProcess[]> {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as WindowsProcess | WindowsProcess[] | null;
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    return [];
  }
}