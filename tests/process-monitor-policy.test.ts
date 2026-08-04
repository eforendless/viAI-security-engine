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

test("child process monitoring only selects a process with an observed parent", () => {
  const policy = { monitorNewProcesses: false, monitorChildProcesses: true, monitorSuspiciousCommandLines: false, monitorPowerShell: false, monitorCmd: false, monitorWScript: false, monitorMshta: false, excludedProcesses: [] };
  assert.equal(shouldMonitorProcess({ Name: "child.exe", ParentProcessId: 120 }, policy, new Set([120])), true);
  assert.equal(shouldMonitorProcess({ Name: "child.exe", ParentProcessId: 120 }, policy, new Set()), false);
});