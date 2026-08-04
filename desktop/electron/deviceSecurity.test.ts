import assert from "node:assert/strict";
import test from "node:test";
import { toStorageRecord } from "./deviceSecurity";

test("removable storage keeps a stable identity when Windows assigns a new drive letter", () => {
  const first = toStorageRecord({ DeviceID: "E:", VolumeName: "Transfer", VolumeSerialNumber: "9A1B-2C3D" });
  const reconnected = toStorageRecord({ DeviceID: "F:", VolumeName: "Transfer", VolumeSerialNumber: "9A1B-2C3D" });

  assert.equal(first.id, "volume:9A1B-2C3D");
  assert.equal(reconnected.id, first.id);
  assert.equal(reconnected.mountPoint, "F:");
});