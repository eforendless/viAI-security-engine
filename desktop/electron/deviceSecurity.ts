import { spawn, type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DeviceStatus = "connected" | "disconnected" | "unknown";
export type DeviceEventType = "device-connected" | "device-removed" | "device-changed" | "trust-added" | "trust-removed";
export type DeviceMonitoringState = "disabled" | "active" | "degraded";

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

export interface DeviceSecuritySnapshot {
  devices: DeviceRecord[];
  history: DeviceHistoryRecord[];
  policies: { automaticallyScanUsb: boolean };
  monitoringActive: boolean;
  monitoringState: DeviceMonitoringState;
}

interface StoredState {
  devices: DeviceRecord[];
  history: DeviceHistoryRecord[];
}

interface PnpDevice {
  DeviceID?: string;
  Name?: string;
  Manufacturer?: string;
  PNPClass?: string;
  Service?: string;
}

export interface LogicalDisk {
  DeviceID?: string;
  VolumeName?: string;
  FileSystem?: string;
  Size?: number;
  VolumeSerialNumber?: string;
}

const defaultPolicies = Object.freeze({ automaticallyScanUsb: true });

export interface DeviceMonitoringPolicy {
  readonly monitorUsbStorage: boolean;
  readonly monitorUsbInsertion: boolean;
  readonly automaticallyScanUsb: boolean;
}

export type DeviceStorageScanTrigger = "arrival" | "manual";
export type DeviceStorageScanRequest = (device: DeviceRecord, trigger: DeviceStorageScanTrigger) => Promise<void>;

export class DeviceSecurityService {
  private devices: DeviceRecord[] = [];
  private history: DeviceHistoryRecord[] = [];
  private listener?: ChildProcessWithoutNullStreams;
  private refreshTimer?: NodeJS.Timeout;
  private refreshQueued = false;
  private started = false;
  private monitoringState: DeviceMonitoringState = "disabled";

  constructor(private readonly dataPath: string, private readonly notify: (snapshot: DeviceSecuritySnapshot, events: readonly DeviceHistoryRecord[]) => void, private readonly monitoringPolicy: () => DeviceMonitoringPolicy = () => ({ monitorUsbStorage: true, monitorUsbInsertion: true, automaticallyScanUsb: true }), private readonly scanStorage: DeviceStorageScanRequest = async () => undefined) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const stored = await this.readState();
    this.devices = stored.devices;
    this.history = stored.history;
    await this.applyMonitoringPolicy();
  }

  async applyMonitoringPolicy(): Promise<void> {
    if (!this.started) return;
    const policy = this.monitoringPolicy();
    if (policy.monitorUsbStorage || policy.monitorUsbInsertion) {
      await this.refresh();
      if (this.started && process.platform === "win32") this.startPnPListener();
      if (process.platform !== "win32") this.monitoringState = "degraded";
      this.notify(this.snapshot(), []);
      return;
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshQueued = false;
    this.listener?.kill();
    this.listener = undefined;
    this.monitoringState = "disabled";
    this.notify(this.snapshot(), []);
  }

  async clearData(): Promise<void> {
    this.devices = [];
    this.history = [];
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
    this.monitoringState = "disabled";
  }

  snapshot(): DeviceSecuritySnapshot {
    const policy = this.monitoringPolicy();
    return { devices: [...this.devices], history: [...this.history], policies: { ...defaultPolicies, automaticallyScanUsb: policy.monitorUsbStorage && policy.automaticallyScanUsb }, monitoringActive: this.monitoringState === "active", monitoringState: this.monitoringState };
  }

  async setTrust(deviceId: string, trusted: boolean): Promise<void> {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    device.isTrusted = trusted;
    const event = this.record(trusted ? "trust-added" : "trust-removed", deviceId, trusted ? `Local trust label added: ${device.friendlyName}` : `Local trust label removed: ${device.friendlyName}`);
    await this.persist();
    this.notify(this.snapshot(), [event]);
  }

  async requestStorageScan(deviceId: string): Promise<void> {
    const device = this.devices.find((entry) => entry.id === deviceId);
    if (!device?.isStorageDevice || !device.mountPoint || device.status !== "connected") throw new Error("A connected storage device is required for scanning");
    await this.scanStorage(device, "manual");
  }

  private startPnPListener(): void {
    if (this.listener) return;
    const script = "$null = Register-WmiEvent -Class Win32_DeviceChangeEvent -SourceIdentifier viAI_DeviceChange; while ($true) { $event = Wait-Event -SourceIdentifier viAI_DeviceChange; if ($null -ne $event) { Remove-Event -EventIdentifier $event.EventIdentifier; [Console]::Out.WriteLine('change'); } }";
    this.listener = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    this.monitoringState = "active";
    this.listener.stdout.setEncoding("utf8");
    this.listener.stdout.on("data", () => this.queueRefresh());
    this.listener.once("error", () => { this.listener = undefined; this.monitoringState = this.monitoringPolicy().monitorUsbStorage || this.monitoringPolicy().monitorUsbInsertion ? "degraded" : "disabled"; this.notify(this.snapshot(), []); });
    this.listener.once("exit", () => { this.listener = undefined; this.monitoringState = this.monitoringPolicy().monitorUsbStorage || this.monitoringPolicy().monitorUsbInsertion ? "degraded" : "disabled"; this.notify(this.snapshot(), []); });
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
    const policy = this.monitoringPolicy();
    if (!this.started || (!policy.monitorUsbStorage && !policy.monitorUsbInsertion)) return;
    const detected = await discoverWindowsDevices();
    const now = new Date().toISOString();
    const prior = new Map(this.devices.map((device) => [device.id, device]));
    const next = detected.map((device) => this.decorate(device, prior.get(device.id), now));
    for (const device of this.devices) {
      if (!next.some((entry) => entry.id === device.id) && device.status !== "disconnected") next.push({ ...device, status: "disconnected", lastSeen: now });
    }
    const events = policy.monitorUsbInsertion ? changes(this.devices, next, now) : [];
    if (!this.started) return;
    this.devices = next;
    if (events.length > 0) this.history = [...events, ...this.history].slice(0, 2_000);
    await this.persist();
    this.notify(this.snapshot(), events);
    for (const event of events.filter((entry) => entry.type === "device-connected")) {
      const device = this.devices.find((entry) => entry.id === event.deviceId);
      if (policy.monitorUsbStorage && policy.automaticallyScanUsb && device?.isStorageDevice && device.mountPoint) void this.scanStorage(device, "arrival").catch(() => undefined);
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
      status: "connected",
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
    await writeFile(temporary, JSON.stringify({ devices: this.devices, history: this.history }, null, 2), "utf8");
    await rename(temporary, this.dataPath);
  }

  private async readState(): Promise<StoredState> {
    if (!existsSync(this.dataPath)) return { devices: [], history: [] };
    try {
      const parsed = JSON.parse(await readFile(this.dataPath, "utf8")) as Partial<StoredState>;
      return { devices: Array.isArray(parsed.devices) ? parsed.devices : [], history: Array.isArray(parsed.history) ? parsed.history : [] };
    } catch {
      return { devices: [], history: [] };
    }
  }
}

async function discoverWindowsDevices(): Promise<Array<Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators">>> {
  if (process.platform !== "win32") return [];
  const script = "$pnp = Get-CimInstance Win32_PnPEntity | Select-Object DeviceID,Name,Manufacturer,PNPClass,Service; $disks = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,FileSystem,Size,VolumeSerialNumber; [PSCustomObject]@{ pnp = @($pnp); disks = @($disks) } | ConvertTo-Json -Depth 3 -Compress";
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

export function toStorageRecord(disk: LogicalDisk): Omit<DeviceRecord, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustIndicators"> {
  return {
    id: `volume:${disk.VolumeSerialNumber || disk.DeviceID}`,
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
