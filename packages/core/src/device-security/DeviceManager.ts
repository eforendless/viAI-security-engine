import type { DeviceSecurityDevice, DeviceSecurityEvent, DeviceScanSummary } from "./DeviceModels.js";
import type { DeviceRepository } from "./DeviceRepository.js";
import type { DeviceEventType } from "./DeviceTypes.js";

export class DeviceManager {
  private devices: DeviceSecurityDevice[] = [];
  private history: DeviceSecurityEvent[] = [];
  private scans: DeviceScanSummary[] = [];

  constructor(private readonly repository: DeviceRepository) {}

  async initialize(): Promise<void> {
    const [devices, history, scans] = await Promise.all([this.repository.loadDevices(), this.repository.loadHistory(), this.repository.loadScans()]);
    this.devices = [...devices];
    this.history = [...history];
    this.scans = [...scans];
  }

  snapshot(): { devices: readonly DeviceSecurityDevice[]; history: readonly DeviceSecurityEvent[]; scans: readonly DeviceScanSummary[] } {
    return { devices: this.devices, history: this.history, scans: this.scans };
  }

  async replaceDevices(nextDevices: readonly DeviceSecurityDevice[]): Promise<readonly DeviceSecurityEvent[]> {
    const before = new Map(this.devices.map((device) => [device.id, device]));
    const events: DeviceSecurityEvent[] = [];
    for (const device of nextDevices) {
      const previous = before.get(device.id);
      if (!previous && device.status !== "disconnected") events.push(this.event("device-connected", device.id, `Connected: ${device.friendlyName}`));
      else if (previous?.status !== "disconnected" && device.status === "disconnected") events.push(this.event("device-removed", device.id, `Removed: ${device.friendlyName}`));
      else if (previous && JSON.stringify(previous) !== JSON.stringify(device)) events.push(this.event("device-changed", device.id, `Changed: ${device.friendlyName}`));
    }
    this.devices = [...nextDevices];
    if (events.length > 0) this.history = [...events, ...this.history].slice(0, 2_000);
    await Promise.all([this.repository.saveDevices(this.devices), this.repository.saveHistory(this.history)]);
    return events;
  }

  async addEvent(type: DeviceEventType, deviceId: string, detail: string, scanId?: string): Promise<DeviceSecurityEvent> {
    const event = this.event(type, deviceId, detail, scanId);
    this.history = [event, ...this.history].slice(0, 2_000);
    await this.repository.saveHistory(this.history);
    return event;
  }

  async saveScan(scan: DeviceScanSummary): Promise<void> {
    this.scans = [scan, ...this.scans.filter((entry) => entry.id !== scan.id)].slice(0, 500);
    await this.repository.saveScans(this.scans);
  }

  private event(type: DeviceEventType, deviceId: string, detail: string, scanId?: string): DeviceSecurityEvent {
    return { id: crypto.randomUUID(), type, deviceId, detail, scanId, occurredAt: new Date().toISOString() };
  }
}