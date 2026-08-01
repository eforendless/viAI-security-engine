import type { DetectedDevice } from "./DeviceModels.js";

export interface DeviceScanner {
  scan(): Promise<readonly DetectedDevice[]>;
}