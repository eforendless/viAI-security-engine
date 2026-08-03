import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, freemem, hostname, networkInterfaces, release, totalmem, type, uptime, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SystemOverview {
  device: { id: string; computerName: string; currentUser: string; architecture: string; uptimeSeconds: number };
  operatingSystem: { edition: string; version: string; build: string; kernel: string };
  hardware: { bios: string; motherboard: string; cpu: string; cores: number; threads: number; totalMemory: number; availableMemory: number; memoryUsagePercent: number; gpu: string };
  network: { ipAddress: string; macAddress: string };
  storage: Array<{ drive: string; capacity: number; free: number; filesystem: string }>;
  health: { cpuUsagePercent: number; memoryUsagePercent: number; diskUsagePercent: number | undefined };
}

interface WindowsFacts { edition?: string; version?: string; build?: string; bios?: string; motherboard?: string; gpu?: string; storage?: Array<{ drive?: string; capacity?: number; free?: number; filesystem?: string }>; }
let previousCpu = cpus();
let cachedWindowsFacts: { value: WindowsFacts; expiresAt: number } | undefined;
let windowsFactsInFlight: Promise<WindowsFacts> | undefined;
const windowsFactsCacheMs = 5 * 60_000;

export async function collectSystemOverview(dataDirectory: string): Promise<SystemOverview> {
  const [deviceId, facts] = await Promise.all([readDeviceId(dataDirectory), windowsFacts()]);
  const memoryTotal = totalmem();
  const memoryAvailable = freemem();
  const storage = facts.storage?.map((drive) => ({ drive: drive.drive || "Not Available", capacity: finite(drive.capacity), free: finite(drive.free), filesystem: drive.filesystem || "Not Available" })) ?? [];
  const primary = networkDetails();
  const usedStorage = storage.reduce((total, drive) => total + Math.max(0, drive.capacity - drive.free), 0);
  const totalStorage = storage.reduce((total, drive) => total + drive.capacity, 0);
  const memoryUsagePercent = percent(memoryTotal - memoryAvailable, memoryTotal);
  return {
    device: { id: deviceId, computerName: hostname(), currentUser: userInfo().username, architecture: architecture(), uptimeSeconds: uptime() },
    operatingSystem: { edition: facts.edition || "Not Available", version: facts.version || type(), build: facts.build || release(), kernel: release() },
    hardware: { bios: facts.bios || "Not Available", motherboard: facts.motherboard || "Not Available", cpu: cpus()[0]?.model || "Not Available", cores: cpus().length, threads: cpus().length, totalMemory: memoryTotal, availableMemory: memoryAvailable, memoryUsagePercent, gpu: facts.gpu || "Not Available" },
    network: primary,
    storage,
    health: { cpuUsagePercent: cpuUsage(), memoryUsagePercent, diskUsagePercent: totalStorage ? percent(usedStorage, totalStorage) : undefined },
  };
}

async function readDeviceId(directory: string): Promise<string> {
  const path = join(directory, "device-id.txt");
  try { const id = (await readFile(path, "utf8")).trim(); if (id) return id; } catch { /* Create the locally scoped identifier below. */ }
  const id = crypto.randomUUID();
  await mkdir(directory, { recursive: true });
  await writeFile(path, id, "utf8");
  return id;
}

async function windowsFacts(): Promise<WindowsFacts> {
  if (process.platform !== "win32") return {};
  if (cachedWindowsFacts && cachedWindowsFacts.expiresAt > Date.now()) return cachedWindowsFacts.value;
  if (windowsFactsInFlight) return windowsFactsInFlight;
  windowsFactsInFlight = collectWindowsFacts().then((value) => {
    cachedWindowsFacts = { value, expiresAt: Date.now() + windowsFactsCacheMs };
    return value;
  }).finally(() => { windowsFactsInFlight = undefined; });
  return windowsFactsInFlight;
}

async function collectWindowsFacts(): Promise<WindowsFacts> {
  const script = "$os=Get-CimInstance Win32_OperatingSystem;$bios=Get-CimInstance Win32_BIOS;$board=Get-CimInstance Win32_BaseBoard;$gpu=Get-CimInstance Win32_VideoController | Select-Object -First 1;$edition=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').ProductName;$drives=Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {[PSCustomObject]@{drive=$_.DeviceID;capacity=[double]$_.Size;free=[double]$_.FreeSpace;filesystem=$_.FileSystem}};[PSCustomObject]@{edition=$edition;version=$os.Caption;build=$os.BuildNumber;bios=($bios.SMBIOSBIOSVersion);motherboard=(($board.Manufacturer+' '+$board.Product).Trim());gpu=$gpu.Name;storage=@($drives)} | ConvertTo-Json -Depth 4 -Compress";
  try { const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 12_000 }); return JSON.parse(stdout) as WindowsFacts; } catch { return {}; }
}

function networkDetails(): { ipAddress: string; macAddress: string } {
  for (const interfaces of Object.values(networkInterfaces())) for (const entry of interfaces ?? []) if (!entry.internal && entry.family === "IPv4") return { ipAddress: entry.address, macAddress: entry.mac || "Not Available" };
  return { ipAddress: "Not Available", macAddress: "Not Available" };
}

function cpuUsage(): number {
  const current = cpus();
  const usage = current.map((cpu, index) => {
    const before = previousCpu[index]?.times;
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    const previousTotal = before ? Object.values(before).reduce((sum, value) => sum + value, 0) : total;
    return total === previousTotal ? 0 : 100 - ((cpu.times.idle - (before?.idle ?? cpu.times.idle)) / (total - previousTotal) * 100);
  });
  previousCpu = current;
  return Math.round(usage.reduce((sum, value) => sum + value, 0) / Math.max(usage.length, 1));
}

function architecture(): string { return arch() === "arm64" ? "ARM64" : arch() === "x64" ? "64-bit (x64)" : arch(); }
function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function percent(value: number, total: number): number { return total ? Math.round(value / total * 100) : 0; }