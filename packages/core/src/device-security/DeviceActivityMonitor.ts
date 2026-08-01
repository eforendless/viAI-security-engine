import type { DeviceSecurityDevice } from "./DeviceModels.js";

export interface DeviceBehaviorObservation {
  readonly deviceId: string;
  readonly observedAt: string;
  readonly kind: "keyboard-input" | "mouse-input" | "rapid-input" | "powershell-launch" | "cmd-launch" | "device-behavior";
  readonly detail: string;
}

export interface DeviceActivityMonitor {
  start(devices: readonly DeviceSecurityDevice[]): Promise<void>;
  stop(): void;
  observations(): readonly DeviceBehaviorObservation[];
}