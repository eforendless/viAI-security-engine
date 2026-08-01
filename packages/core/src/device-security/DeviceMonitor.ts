import type { DetectedDevice, DeviceSecurityDevice } from "./DeviceModels.js";
import type { DeviceEventListener } from "./DeviceEventListener.js";
import type { DeviceScanner } from "./DeviceScanner.js";

export class DeviceMonitor {
  private current = new Map<string, DeviceSecurityDevice>();

  constructor(private readonly scanner: DeviceScanner, private readonly listener: DeviceEventListener) {}

  async start(onDevicesChanged: (devices: readonly DeviceSecurityDevice[]) => Promise<void> | void): Promise<void> {
    await this.refresh(onDevicesChanged);
    await this.listener.start(() => void this.refresh(onDevicesChanged));
  }

  stop(): void { this.listener.stop(); }
  devices(): readonly DeviceSecurityDevice[] { return [...this.current.values()]; }

  private async refresh(onDevicesChanged: (devices: readonly DeviceSecurityDevice[]) => Promise<void> | void): Promise<void> {
    const detected = await this.scanner.scan();
    const now = new Date().toISOString();
    const next = new Map<string, DeviceSecurityDevice>();
    for (const device of detected) {
      const existing = this.current.get(device.id);
      next.set(device.id, toConnectedDevice(device, existing, now));
    }
    for (const [id, device] of this.current) {
      if (!next.has(id)) next.set(id, { ...device, status: "disconnected", lastSeen: now });
    }
    this.current = next;
    await onDevicesChanged(this.devices());
  }
}

function toConnectedDevice(device: DetectedDevice, existing: DeviceSecurityDevice | undefined, now: string): DeviceSecurityDevice {
  return {
    ...device,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    status: device.status ?? (device.isStorageDevice ? "needs-scan" : "connected"),
    isTrusted: existing?.isTrusted ?? false,
    trustProfile: existing?.trustProfile,
  };
}