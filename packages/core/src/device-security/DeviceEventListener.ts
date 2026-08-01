export interface DeviceEventListener {
  start(onDeviceChange: () => void): Promise<void>;
  stop(): void;
}