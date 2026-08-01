import assert from "node:assert/strict";
import test from "node:test";
import { isMonitoredCandidate } from "../src/watcher/executableMonitor.js";

test("filesystem monitor policy applies enabled scan types and local exclusions", () => {
  const policy = { extensions: [".exe", ".ps1"], excludedFolders: ["C:\\Users\\Chris\\Ignored"], excludedFiles: ["C:\\Users\\Chris\\Desktop\\trusted.exe"], excludedExtensions: [".ps1"] };
  assert.equal(isMonitoredCandidate("C:\\Users\\Chris\\Desktop\\sample.exe", policy), true);
  assert.equal(isMonitoredCandidate("C:\\Users\\Chris\\Desktop\\sample.dll", policy), false);
  assert.equal(isMonitoredCandidate("C:\\Users\\Chris\\Desktop\\script.ps1", policy), false);
  assert.equal(isMonitoredCandidate("C:\\Users\\Chris\\Desktop\\trusted.exe", policy), false);
  assert.equal(isMonitoredCandidate("C:\\Users\\Chris\\Ignored\\sample.exe", policy), false);
});