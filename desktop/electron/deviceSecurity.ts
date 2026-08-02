import { spawn, type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, opendir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DeviceStatus = "connected" | "disconnected" | "blocked" | "needs-scan" | "scanning" | "trusted" | "unknown";
export type DeviceEventType = "device-connected" | "device-removed" | "device-changed" | "scan-started" | "scan-finished" | "threat-detected" | "user-allowed" | "user-blocked";

export interface DeviceRecord {
  id: string;
  friendlyName: string;
  manufacturer?: string;
  serialNumber?: string;
  deviceType: string;
  connectionType: string;
  vendorId?: string;
  productId?: string;
  firstSeen: string;
  lastSeen: string;
  status: DeviceStatus;
  isTrusted: boolean;
  isStorageDevice: boolean;
  isHumanInterfaceDevice: boolean;
  driver?: string;
  driverVersion?: string;
  capacity?: number;
  mountPoint?: string;
  fileSystem?: string;
  autoRunEnabled?: boolean;
  trustIndicators: Array<{ id: string; evidence: string }>;
}

export interface DeviceHistoryRecord {
  id: string;
  type: DeviceEventType;
  deviceId: string;
  occurredAt: string;
  detail: string;
  scanId?: string;
}

export interface DeviceScanRecord {
  id: string;
  deviceId: string;
  startedAt: string;
  finishedAt?: string;
  filesScanned: number;
  threatsFound: number;
  status: "running" | "finished" | "failed";
  findings: Array<{ filePath: string; riskScore: number; recommendation: string; evidence: string[] }>;
}

export interface DeviceSecuritySnapshot {
  devices: DeviceRecord[];
  history: DeviceHistoryRecord[];
  scans: DeviceScanRecord[];
  policies: { automaticallyScanUsb: boolean; blockUnknownStorage: boolean; allowHumanInterfaceDevices: boolean; allowCompanyDevices: boolean; requireTrust: boolean; readOnlyMode: boolean };
}

interface StoredState {
  devices: DeviceRecord[];
  history: DeviceHistoryRecord[];
  scans: DeviceScanRecord[];
}

interface PnpDevice {
  DeviceID?: string;
  Name?: string;
  Manufacturer?: string;
  PNPClass?: string;
  Service?: string;
}

interface LogicalDisk {
  DeviceID?: string;
  VolumeName?: string;
  FileSystem?: string;
  Size?: number;
}

const defaultPolicies = Object.freeze({ automaticallyScanUsb: true, blockUnknownStorage: false, allowHumanInterfaceDevices: true, allowCompanyDevices: true, requireTrust: false, readOnlyMode: false });

export interface DeviceMonitoringPolicy {
  readonly monitorUsbStorage: boolean;
  readonly monitorUsbInsertion: boolean;
  readonly automaticallyScanUsb: boolean;
}

export class DeviceSecurityService {
  private devices: DeviceRecord[] = [];
  private history: DeviceHistoryRecord[] = [];
  private scans: DeviceScanRecord[] = [];
  private listener?: ChildProcessWithoutNullStreams;
  private refreshTimer?: NodeJS.Timeout;
  private refreshQueued = false;
  private started = false;
  private readonly activeScans = new Set<string>();

  constructor(private readonly dataPath: string, private readonly notify: (snapshot: DeviceSecuritySnapshot, events: readonly DeviceHistoryRecord[]) => void, private readonly monitoringPolicy: () => DeviceMonitoringPolicy = () => ({ monitorUsbStorage: true, monitorUsbInsertion: true, automaticallyScanUsb: true })) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const stored = await this.readState();
    this.devices = stored.devices;
    this.history = stored.history;
    this.scans = stored.scans;
    await this.refresh();
    if (this.started && process.platform === "win32") this.startPnPListener();
  }

  async clearData(): Promise<void> {
    this.devices = [];
    this.history = [];
    this.scans = [];
    this.activeScans.clear();
    await rm(this.dataPath, { force: true });
    this.notify(this.snapshot(), []);
  }

  stop(): void {
    this.started = false;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshQueued = false;
    this.listener?.kill();
    this.listener = undefined;
    this.activeScans.clear();
  }

  snapshot(): DeviceSecuritySnapshot {
    const policy = this.monitoringPolicy();
    return { devices: [...this.devices], history: [...this.history], scans: [...this.scans], policies: { ...defaultPolicies, automaticallyScanUsb: policy.monitorUsbStorage && policy.automaticallyScanUsb } };
  }

  async setTrust(deviceId: string, trusted: boolean): Promise<void> {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    device.isTrusted = trusted;
    device.status = trusted ? "trusted" : device.isStorageDevice ? "needs-scan" : "connected";
    const event = this.record(trusted ? "user-allowed" : "device-changed", deviceId, trusted ? `Trusted by user: ${device.friendlyName}` : `Removed local trust: ${device.friendlyName}`);
    await this.persist();
    this.notify(this.snapshot(), [event]);
  }

  async block(deviceId: string): Promise<void> {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    device.isTrusted = false;
    device.status = "blocked";
    const event = this.record("user-blocked", deviceId, `Blocked by user: ${device.friendlyName}`);
    await this.persist();
    this.notify(this.snapshot(), [event]);
  }

  async scanDevice(deviceId: string): Promise<void> {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device?.isStorageDevice || !device.mountPoint || this.activeScans.has(deviceId) || device.status === "blocked") return;
    this.activeScans.add(deviceId);
    const scan: DeviceScanRecord = { id: crypto.randomUUID(), deviceId, startedAt: new Date().toISOString(), filesScanned: 0, threatsFound: 0, status: "running", findings: [] };
    this.scans = [scan, ...this.scans].slice(0, 500);
    device.status = "scanning";
    const started = this.record("scan-started", device.id, `Scan started: ${device.friendlyName}`);
    await this.persist();
    this.notify(this.snapshot(), [started]);
    try {
      const files = await collectScanTargets(device.mountPoint);
      let failures = 0;
      for (const filePath of files) {
        try {
          const result = await analyzeRemovableFile(filePath);
          scan.filesScanned += 1;
          scan.findings.push({ filePath, riskScore: result.riskScore, recommendation: result.recommendation, evidence: result.evidence });
          if (result.riskScore >= 61 || result.recommendation === "AI_ANALYSIS") scan.threatsFound += 1;
        } catch {
          failures += 1;
        }
      }
      scan.status = failures === files.length && files.length > 0 ? "failed" : "finished";
      scan.finishedAt = new Date().toISOString();
      const currentDevice = this.devices.find((entry) => entry.id === device.id);
      if (currentDevice && currentDevice.status !== "blocked") currentDevice.status = currentDevice.isTrusted ? "trusted" : "connected";
      const events = [this.record("scan-finished", device.id, `Scan finished: ${device.friendlyName}`)];
      if (scan.threatsFound > 0) events.push(this.record("threat-detected", device.id, `${scan.threatsFound} file${scan.threatsFound === 1 ? "" : "s"} need investigation on ${device.friendlyName}`));
      await this.persist();
      this.notify(this.snapshot(), events);
    } finally {
      this.activeScans.delete(deviceId);
    }
  }

  private startPnPListener(): void {
    if (this.listener) return;
    const script = "$null = Register-WmiEvent -Class Win32_DeviceChangeEvent -SourceIdentifier viAI_DeviceChange; while ($true) { $event = Wait-Event -SourceIdentifier viAI_DeviceChange; if ($null -ne $event) { Remove-Event -EventIdentifier $event.EventIdentifier; [Console]::Out.WriteLine('change'); } }";
    this.listener = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    this.listener.stdout.setEncoding("utf8");
    this.listener.stdout.on("data", () => this.queueRefresh());
    this.listener.once("error", () => { this.listener = undefined; });
    this.listener.once("exit", () => { this.listener = undefined; });
  }

  private queueRefresh(): void {
    if (!this.started || this.refreshQueued) return;
    this.refreshQueued = true;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refreshQueued = false;
      if (this.started) void this.refresh();
    }, 400);
  }

  private async refresh(): Promise<void> {
    if (!this.started) return;
    const detected = await discoverWindowsDevices();
    const now = new Date().toISOString();
    const prior = new Map(this.devices.map((device) => [device.id, device]));
    const next = detected.map((device) => this.decorate(device, prior.get(device.id), now));
    for (const device of this.devices) {
      if (!next.some((entry) => entry.id === device.id) && device.status !== "disconnected") next.push({ ...device, status: "disconnected", lastSeen: now });
    }
    const events = changes(this.devices, next, now);
    if (!this.started) return;
    this.devices = next;
    if (events.length > 0) this.history = [...events, ...this.history].slice(0, 2_000);
    await this.persist();
    this.notify(this.snapshot(), events);
    const policy = this.monitoringPolicy();
    for (const event of events.filter((entry) => entry.type === "device-connected")) {
      const device = this.devices.find((entry) => entry.id === event.deviceId);
      if (policy.monitorUsbStorage && policy.automaticallyScanUsb && device?.isStorageDevice && device.mountPoint) void this.scanDevice(device.id);
    }
  }

  private decorate(device: Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators">, existing: DeviceRecord | undefined, now: string): DeviceRecord {
    const previousConnections = existing?.firstSeen !== undefined;
    const indicators = [
      ...(previousConnections ? [{ id: "PREVIOUSLY_CONNECTED", evidence: "This device has connected to this computer before." }] : []),
      ...(device.vendorId ? [{ id: "KNOWN_VENDOR", evidence: `Hardware vendor ID ${device.vendorId} was reported by Windows.` }] : []),
      ...(device.manufacturer ? [{ id: "KNOWN_MANUFACTURER", evidence: `${device.manufacturer} was reported as the device manufacturer.` }] : []),
      ...(device.driver ? [{ id: "TRUSTED_DRIVER", evidence: `Windows assigned driver ${device.driver}.` }] : []),
    ];
    if (indicators.length === 0) indicators.push({ id: "UNKNOWN_DEVICE", evidence: "No local trust evidence is available for this device." });
    return {
      ...device,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      status: existing?.status === "blocked" ? "blocked" : existing?.isTrusted ? "trusted" : device.isStorageDevice ? "needs-scan" : "connected",
      isTrusted: existing?.isTrusted ?? false,
      trustIndicators: indicators,
    };
  }

  private record(type: DeviceEventType, deviceId: string, detail: string): DeviceHistoryRecord {
    const event = { id: crypto.randomUUID(), type, deviceId, detail, occurredAt: new Date().toISOString() };
    this.history = [event, ...this.history].slice(0, 2_000);
    return event;
  }

  private async persist(): Promise<void> {
    await mkdir(join(this.dataPath, ".."), { recursive: true });
    const temporary = `${this.dataPath}.tmp`;
    await writeFile(temporary, JSON.stringify({ devices: this.devices, history: this.history, scans: this.scans }, null, 2), "utf8");
    await rename(temporary, this.dataPath);
  }

  private async readState(): Promise<StoredState> {
    if (!existsSync(this.dataPath)) return { devices: [], history: [], scans: [] };
    try {
      const parsed = JSON.parse(await readFile(this.dataPath, "utf8")) as Partial<StoredState>;
      return { devices: Array.isArray(parsed.devices) ? parsed.devices : [], history: Array.isArray(parsed.history) ? parsed.history : [], scans: Array.isArray(parsed.scans) ? parsed.scans : [] };
    } catch {
      return { devices: [], history: [], scans: [] };
    }
  }
}

async function discoverWindowsDevices(): Promise<Array<Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators">>> {
  if (process.platform !== "win32") return [];
  const script = "$pnp = Get-CimInstance Win32_PnPEntity | Select-Object DeviceID,Name,Manufacturer,PNPClass,Service; $disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FileSystem,Size; [PSCustomObject]@{ pnp = @($pnp); disks = @($disks) } | ConvertTo-Json -Depth 3 -Compress";
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
    const data = JSON.parse(stdout) as { pnp?: PnpDevice[]; disks?: LogicalDisk[] };
    const devices = (data.pnp ?? []).filter((device) => device.DeviceID).map(toPnpRecord);
    return [...devices, ...(data.disks ?? []).filter((disk) => disk.DeviceID).map(toStorageRecord)];
  } catch {
    return [];
  }
}

function toPnpRecord(device: PnpDevice): Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators"> {
  const id = device.DeviceID ?? crypto.randomUUID();
  const upperId = id.toUpperCase();
  const pnpClass = (device.PNPClass ?? "").toLowerCase();
  const deviceType = classifyDevice(device.Name ?? "Unknown device", pnpClass, upperId);
  const isStorageDevice = deviceType === "usb-storage" || deviceType === "external-hdd" || deviceType === "external-ssd" || deviceType === "sd-card";
  const isHumanInterfaceDevice = ["keyboard", "mouse", "game-controller"].includes(deviceType) || pnpClass === "hidclass";
  return {
    id,
    friendlyName: device.Name ?? "Unknown device",
    manufacturer: device.Manufacturer,
    serialNumber: upperId.includes("\\") ? id.split("\\").at(-1) : undefined,
    deviceType,
    connectionType: upperId.startsWith("USB") ? "usb" : pnpClass === "net" ? "network" : upperId.startsWith("BTH") ? "bluetooth" : upperId.startsWith("PCI") ? "pci" : "unknown",
    vendorId: upperId.match(/VID_([0-9A-F]{4})/)?.[1],
    productId: upperId.match(/PID_([0-9A-F]{4})/)?.[1],
    isStorageDevice,
    isHumanInterfaceDevice,
    driver: device.Service,
  };
}

function toStorageRecord(disk: LogicalDisk): Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators"> {
  return {
    id: `volume:${disk.DeviceID}`,
    friendlyName: `${disk.VolumeName || "Removable storage"} (${disk.DeviceID})`,
    deviceType: "usb-storage",
    connectionType: "usb",
    isStorageDevice: true,
    isHumanInterfaceDevice: false,
    capacity: Number(disk.Size) || undefined,
    mountPoint: disk.DeviceID,
    fileSystem: disk.FileSystem,
    autoRunEnabled: false,
  };
}

function classifyDevice(name: string, pnpClass: string, id: string): string {
  const value = `${name} ${pnpClass} ${id}`.toLowerCase();
  if (value.includes("keyboard")) return "keyboard";
  if (value.includes("mouse")) return "mouse";
  if (value.includes("webcam") || value.includes("camera") || pnpClass === "image") return "webcam";
  if (value.includes("printer") || pnpClass === "printer") return "printer";
  if (value.includes("bluetooth")) return "bluetooth-adapter";
  if (pnpClass === "net") return "network-adapter";
  if (pnpClass === "media" || value.includes("audio")) return "audio-device";
  if (value.includes("game") || value.includes("controller")) return "game-controller";
  if (value.includes("hub")) return "usb-hub";
  if (value.includes("phone") || value.includes("mtp") || value.includes("ptp")) return "smartphone";
  if (value.includes("sd") || value.includes("card reader")) return "sd-card";
  if (value.includes("usb") && (value.includes("disk") || value.includes("storage") || value.includes("usbstor"))) return "usb-storage";
  return id.startsWith("USB") ? "unknown-usb" : "unknown";
}

function changes(previous: readonly DeviceRecord[], next: readonly DeviceRecord[], occurredAt: string): DeviceHistoryRecord[] {
  const before = new Map(previous.map((device) => [device.id, device]));
  return next.flatMap((device) => {
    const existing = before.get(device.id);
    if (!existing && device.status !== "disconnected") return [event("device-connected", device.id, `Connected: ${device.friendlyName}`, occurredAt)];
    if (existing?.status !== "disconnected" && device.status === "disconnected") return [event("device-removed", device.id, `Removed: ${device.friendlyName}`, occurredAt)];
    if (existing && existing.friendlyName !== device.friendlyName) return [event("device-changed", device.id, `Changed: ${device.friendlyName}`, occurredAt)];
    return [];
  });
}

function event(type: DeviceEventType, deviceId: string, detail: string, occurredAt: string): DeviceHistoryRecord {
  return { id: crypto.randomUUID(), type, deviceId, detail, occurredAt };
}

const scanExtensions = new Set([".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".js", ".jse", ".wsf", ".jar", ".doc", ".docm", ".docx", ".xls", ".xlsm", ".xlsx", ".ppt", ".pptm", ".pptx", ".zip", ".rar", ".7z"]);

async function collectScanTargets(root: string, maximum = 250): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (files.length >= maximum) return;
    try {
      const entries = await opendir(directory);
      for await (const entry of entries) {
        if (files.length >= maximum) break;
        const filePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!new Set(["$recycle.bin", "system volume information"]).has(entry.name.toLowerCase())) await visit(filePath);
        } else if (entry.isFile() && scanExtensions.has(extname(entry.name).toLowerCase())) files.push(filePath);
      }
    } catch {
      return;
    }
  };
  await visit(root);
  return files;
}

async function analyzeRemovableFile(filePath: string): Promise<{ riskScore: number; recommendation: string; evidence: string[] }> {
  const response = await fetch("http://127.0.0.1:4117/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: filePath, source: "removable-media" }) });
  const result = await response.json() as Partial<{ riskScore: number; recommendation: string; evidence: string[] }>;
  if (!response.ok || typeof result.riskScore !== "number" || typeof result.recommendation !== "string" || !Array.isArray(result.evidence)) throw new Error("Local analysis failed");
  return { riskScore: result.riskScore, recommendation: result.recommendation, evidence: result.evidence };
}