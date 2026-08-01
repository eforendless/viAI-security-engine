import assert from "node:assert/strict";
import test from "node:test";
import { shouldMonitorProcess } from "../src/watcher/processMonitor.js";

const disabled = { monitorNewProcesses: false, monitorChildProcesses: false, monitorSuspiciousCommandLines: false, monitorPowerShell: false, monitorCmd: false, monitorWScript: false, monitorMshta: false, excludedProcesses: [] };

test("process monitoring only selects enabled local process categories", () => {
  assert.equal(shouldMonitorProcess({ Name: "powershell.exe" }, { ...disabled, monitorPowerShell: true }), true);
  assert.equal(shouldMonitorProcess({ Name: "cmd.exe", CommandLine: "cmd /c echo hello" }, disabled), false);
  assert.equal(shouldMonitorProcess({ Name: "cmd.exe", CommandLine: "cmd -EncodedCommand AAA" }, { ...disabled, monitorSuspiciousCommandLines: true }), true);
  assert.equal(shouldMonitorProcess({ Name: "powershell.exe" }, { ...disabled, monitorNewProcesses: true, excludedProcesses: ["powershell.exe"] }), false);
});