import type { DeviceSecurityDevice } from "./DeviceModels.js";
import type { DevicePolicy } from "./DeviceTypes.js";

export const defaultDevicePolicy: DevicePolicy = Object.freeze({
  automaticallyScanUsb: true,
  blockUnknownStorage: false,
  allowHumanInterfaceDevices: true,
  allowCompanyDevices: true,
  requireTrust: false,
  readOnlyMode: false,
});

export class DevicePolicyEngine {
  constructor(private readonly policy: DevicePolicy = defaultDevicePolicy) {}

  shouldAutoScan(device: DeviceSecurityDevice): boolean {
    return this.policy.automaticallyScanUsb && device.isStorageDevice && device.status === "needs-scan";
  }

  shouldBlock(device: DeviceSecurityDevice): boolean {
    return (this.policy.blockUnknownStorage && device.isStorageDevice && !device.isTrusted)
      || (this.policy.requireTrust && !device.isTrusted && !device.isHumanInterfaceDevice)
      || (!this.policy.allowHumanInterfaceDevices && device.isHumanInterfaceDevice);
  }

  current(): DevicePolicy { return this.policy; }
}