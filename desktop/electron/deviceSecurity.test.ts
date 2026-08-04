import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeviceSecurityService, toStorageRecord } from "./deviceSecurity";

test("removable storage keeps a stable identity when Windows assigns a new drive letter", () => {
  const first = toStorageRecord({ DeviceID: "E:", VolumeName: "Transfer", VolumeSerialNumber: "9A1B-2C3D" });
  const reconnected = toStorageRecord({ DeviceID: "F:", VolumeName: "Transfer", VolumeSerialNumber: "9A1B-2C3D" });

  assert.equal(first.id, "volume:9A1B-2C3D");
  assert.equal(reconnected.id, first.id);
  assert.equal(reconnected.mountPoint, "F:");
});

test("startup device discovery establishes a baseline before reporting a new removable device", async () => {
  const dataPath = join(tmpdir(), `viai-device-baseline-${crypto.randomUUID()}.json`);
  const notifications: Array<{ events: readonly { type: string; deviceId: string }[] }> = [];
  let detected = [toStorageRecord({ DeviceID: "E:", VolumeName: "Existing", VolumeSerialNumber: "EXISTING" })];
  const service = new DeviceSecurityService(dataPath, (_snapshot, events) => notifications.push({ events }), () => ({ monitorUsbStorage: true, monitorUsbInsertion: true, automaticallyScanUsb: false }), async () => undefined, async () => detected);
  try {
    await service.start();
    assert.equal(notifications.flatMap((entry) => entry.events).filter((event) => event.type === "device-connected").length, 0);

    detected = [...detected, toStorageRecord({ DeviceID: "F:", VolumeName: "New storage", VolumeSerialNumber: "NEW" })];
    await (service as unknown as { refresh(): Promise<void> }).refresh();
    await (service as unknown as { refresh(): Promise<void> }).refresh();
    const arrivals = notifications.flatMap((entry) => entry.events).filter((event) => event.type === "device-connected");
    assert.deepEqual(arrivals.map((event) => event.deviceId), ["volume:NEW"]);
  } finally {
    service.stop();
    await rm(dataPath, { force: true });
  }
});