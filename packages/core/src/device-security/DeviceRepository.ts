import type { DeviceSecurityDevice, DeviceSecurityEvent, DeviceScanSummary } from "./DeviceModels.js";

export interface DeviceRepository {
  loadDevices(): Promise<readonly DeviceSecurityDevice[]>;
  saveDevices(devices: readonly DeviceSecurityDevice[]): Promise<void>;
  loadHistory(): Promise<readonly DeviceSecurityEvent[]>;
  saveHistory(history: readonly DeviceSecurityEvent[]): Promise<void>;
  loadScans(): Promise<readonly DeviceScanSummary[]>;
  saveScans(scans: readonly DeviceScanSummary[]): Promise<void>;
}