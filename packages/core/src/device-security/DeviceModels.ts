import type { TrustResult } from "../trust/TrustResult.js";
import type { ConnectionType, DeviceEventType, DeviceStatus, DeviceType } from "./DeviceTypes.js";

export interface DeviceSecurityDevice {
  readonly id: string;
  readonly friendlyName: string;
  readonly manufacturer?: string;
  readonly serialNumber?: string;
  readonly deviceType: DeviceType;
  readonly connectionType: ConnectionType;
  readonly vendorId?: string;
  readonly productId?: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly status: DeviceStatus;
  readonly isTrusted: boolean;
  readonly isStorageDevice: boolean;
  readonly isHumanInterfaceDevice: boolean;
  readonly driver?: string;
  readonly driverVersion?: string;
  readonly capacity?: number;
  readonly mountPoint?: string;
  readonly fileSystem?: string;
  readonly autoRunEnabled?: boolean;
  readonly trustProfile?: TrustResult;
}

export interface DetectedDevice extends Omit<DeviceSecurityDevice, "firstSeen" | "lastSeen" | "status" | "isTrusted" | "trustProfile"> {
  readonly status?: DeviceStatus;
}

export interface DeviceSecurityEvent {
  readonly id: string;
  readonly type: DeviceEventType;
  readonly deviceId: string;
  readonly occurredAt: string;
  readonly detail: string;
  readonly scanId?: string;
}

export interface DeviceScanSummary {
  readonly id: string;
  readonly deviceId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly filesScanned: number;
  readonly threatsFound: number;
  readonly status: "running" | "finished" | "failed";
  readonly findings: readonly DeviceScanFinding[];
}

export interface DeviceScanFinding {
  readonly filePath: string;
  readonly riskScore: number;
  readonly recommendation: string;
  readonly evidence: readonly string[];
}