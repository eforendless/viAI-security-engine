export type DeviceType = "usb-storage" | "external-hdd" | "external-ssd" | "sd-card" | "smartphone" | "usb-hub" | "keyboard" | "mouse" | "webcam" | "printer" | "bluetooth-adapter" | "network-adapter" | "audio-device" | "game-controller" | "unknown-usb" | "unknown";
export type ConnectionType = "usb" | "bluetooth" | "network" | "pci" | "internal" | "unknown";
export type DeviceStatus = "connected" | "disconnected" | "blocked" | "needs-scan" | "scanning" | "trusted" | "unknown";
export type DeviceEventType = "device-connected" | "device-removed" | "device-changed" | "scan-started" | "scan-finished" | "threat-detected" | "user-allowed" | "user-blocked";

export interface DevicePolicy {
  readonly automaticallyScanUsb: boolean;
  readonly blockUnknownStorage: boolean;
  readonly allowHumanInterfaceDevices: boolean;
  readonly allowCompanyDevices: boolean;
  readonly requireTrust: boolean;
  readonly readOnlyMode: boolean;
}