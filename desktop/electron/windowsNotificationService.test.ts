import assert from "node:assert/strict";
import test from "node:test";
import { isNotificationTarget, notificationPath, WindowsNotificationService } from "./windowsNotificationService";

const assessment = { category: "assessment", setting: "notifyHighRisk", title: "viAI Security", body: "sample.exe needs your attention.", target: { route: "history-detail", assessmentId: "assessment-1" }, dedupeKey: "assessment:hash-1" } as const;

test("notification policy respects user preferences and suppresses duplicate logical events", () => {
  const delivered: unknown[] = [];
  let now = 10_000;
  const service = new WindowsNotificationService({ supported: () => true, deliver: (payload) => delivered.push(payload), now: () => now });

  assert.deepEqual(service.notify({ windowsNotifications: false, notifyHighRisk: true }, assessment), { delivered: false, reason: "user-setting" });
  assert.equal(delivered.length, 0);
  assert.deepEqual(service.notify({ windowsNotifications: true, notifyHighRisk: true }, assessment), { delivered: true });
  assert.equal(delivered.length, 1);
  assert.deepEqual(service.notify({ windowsNotifications: true, notifyHighRisk: true }, assessment), { delivered: false, reason: "duplicate" });
  now += 30_000;
  assert.deepEqual(service.notify({ windowsNotifications: true, notifyHighRisk: true }, assessment), { delivered: true });
  assert.equal(delivered.length, 2);
});

test("notification targets accept only known internal routes and stable identifiers", () => {
  assert.equal(isNotificationTarget({ route: "history-detail", assessmentId: "assessment-1" }), true);
  assert.equal(isNotificationTarget({ route: "device-security", deviceId: "volume:9A1B-2C3D" }), true);
  assert.equal(isNotificationTarget({ route: "history-detail", assessmentId: "../../outside" }), false);
  assert.equal(isNotificationTarget({ route: "https://example.test" }), false);
  assert.equal(notificationPath({ route: "history-detail", assessmentId: "assessment-1" }), "/details/assessment-1");
  assert.equal(notificationPath({ route: "device-security", deviceId: "volume:9A1B-2C3D" }), "/device-security");
  assert.equal(notificationPath({ route: "full-scan", scanId: "scan-1" }), "/full-scan");
  assert.equal(notificationPath({ route: "realtime" }), "/realtime");
});