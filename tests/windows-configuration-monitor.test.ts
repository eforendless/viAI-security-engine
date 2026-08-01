import assert from "node:assert/strict";
import test from "node:test";
import { selectedCategories } from "../src/watcher/windowsConfigurationMonitor.js";

test("Windows configuration observation starts only selected categories", () => {
  assert.deepEqual(selectedCategories({ monitorScheduledTasks: true, monitorRegistryRunKeys: false, monitorServices: true, monitorDrivers: false }), ["scheduled-task", "service"]);
  assert.deepEqual(selectedCategories({ monitorScheduledTasks: false, monitorRegistryRunKeys: false, monitorServices: false, monitorDrivers: false }), []);
});