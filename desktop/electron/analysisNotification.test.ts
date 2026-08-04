import assert from "node:assert/strict";
import test from "node:test";
import { notificationForAnalysis } from "./analysisNotification";

test("canonical assessment notification overrides conflicting legacy score", () => {
  const notification = notificationForAnalysis({ riskScore: 99, assessment: { schemaVersion: "0.3", verdict: "LIKELY_BENIGN", investigationPriority: "LOW", recommendation: "ALLOW" } });
  assert.equal(notification.setting, "notifySafeScan");
  assert.match(notification.body, /analyzed locally/);
  assert.doesNotMatch(notification.body, /LIKELY_BENIGN/);
  assert.doesNotMatch(notification.body, /99/);
});

test("legacy analysis notification remains explicitly labeled", () => {
  const notification = notificationForAnalysis({ riskScore: 99 });
  assert.equal(notification.setting, "notifyHighRisk");
  assert.match(notification.body, /needs your attention/);
});