import { createTrustResult, type TrustIndicator, type TrustResult } from "../trust/index.js";
import type { DeviceSecurityDevice } from "./DeviceModels.js";

export interface DeviceTrustStore {
  hasSeen(deviceId: string): boolean;
  hasKnownSerial(serialNumber: string): boolean;
  isKnownVendor(vendorId: string): boolean;
  isKnownManufacturer(manufacturer: string): boolean;
  isTrustedDriver(driver: string): boolean;
}

export class DeviceTrustEvaluator {
  constructor(private readonly store: DeviceTrustStore) {}

  evaluate(device: DeviceSecurityDevice): TrustResult {
    const indicators: TrustIndicator[] = [];
    if (this.store.hasSeen(device.id)) indicators.push(indicator("PREVIOUSLY_CONNECTED", 8, "This device has connected to this computer before."));
    if (device.serialNumber && this.store.hasKnownSerial(device.serialNumber)) indicators.push(indicator("KNOWN_SERIAL_NUMBER", 12, "The device serial number is known locally."));
    if (device.vendorId && this.store.isKnownVendor(device.vendorId)) indicators.push(indicator("KNOWN_VENDOR", 8, "The hardware vendor identifier is known locally."));
    if (device.manufacturer && this.store.isKnownManufacturer(device.manufacturer)) indicators.push(indicator("KNOWN_MANUFACTURER", 6, "The device manufacturer is known locally."));
    if (device.driver && this.store.isTrustedDriver(device.driver)) indicators.push(indicator("TRUSTED_DRIVER", 8, "The installed device driver is known locally."));
    if (device.connectionType === "internal" || device.connectionType === "pci") indicators.push(indicator("KNOWN_WINDOWS_DEVICE", 5, "The device uses a built-in Windows connection path."));
    if (indicators.length === 0) indicators.push(indicator("UNKNOWN_DEVICE", 0, "No local device trust evidence is available."));
    return createTrustResult(indicators);
  }
}

function indicator(id: string, weight: number, evidence: string): TrustIndicator {
  return { id, weight, evidence, source: "device-security" };
}