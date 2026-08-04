import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackgroundService } from "./backgroundService";

test("realtime download settings persist, apply live, and report failed watcher activation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-realtime-settings-"));
  const path = join(directory, "background-settings.json");
  const updates: Array<Record<string, unknown>> = [];
  try {
    const service = new BackgroundService(path, async (update) => { updates.push(update); return { runtime: { downloadMonitoring: update.downloadMonitoring === true } }; }, () => undefined);
    await service.initialize();
    const disabled = await service.update({ monitorDownloads: false });
    assert.equal(disabled.settings.monitorDownloads, false);
    assert.equal(updates.at(-1)?.downloadMonitoring, false);
    const enabled = await service.update({ monitorDownloads: true });
    assert.equal(enabled.activeMonitors.includes("download-files"), true);
    const reloaded = new BackgroundService(path, async () => ({ runtime: { downloadMonitoring: false } }), () => undefined);
    const restored = await reloaded.initialize();
    assert.equal(restored.settings.monitorDownloads, true);
    assert.equal(restored.activeMonitors.includes("download-files"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("background protection disables process and Windows observation before applying engine settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-realtime-master-"));
  const path = join(directory, "background-settings.json");
  const updates: Array<Record<string, unknown>> = [];
  try {
    const service = new BackgroundService(path, async (update) => { updates.push(update); return { runtime: {} }; }, () => undefined);
    await service.initialize();
    await service.update({ backgroundProtection: false, monitorNewProcesses: true, monitorScheduledTasks: true });
    const update = updates.at(-1);
    assert.equal(update?.processMonitoring, false);
    assert.equal(update?.windowsMonitoring, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("background history persists complete scan reports for later detail views", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-history-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined, "9.8.7");
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\setup.exe", analyzedAt: "2026-08-01T10:00:00.000Z", hashes: { sha256: "a".repeat(64) }, finalRiskScore: 72, trustScore: 18, recommendation: "AI_ANALYSIS", signatureStatus: "missing", metadata: { size: 2048, extension: ".exe" }, evidence: ["Unsigned executable"], evidenceStore: { schemaVersion: "0.2", file: { path: "C:\\samples\\setup.exe", name: "setup.exe", source: "removable-media" }, warnings: [], processingMetadata: { startedAt: "2026-08-01T10:00:00.000Z", cacheHit: false, fileReadCount: 1, peParseCount: 1, collectors: [] } }, staticAnalysisReport: { matchedRules: [{ id: "unsigned-executable" }] } } }, "full", 1250, false, { id: "volume:9A1B-2C3D", volume: "E:\\", trigger: "manual" });
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    await reloaded.initialize();
    const snapshot = await reloaded.loadHistory();
    assert.equal(snapshot.history.length, 1);
    assert.equal(snapshot.history[0].fileHash, "a".repeat(64));
    assert.equal(snapshot.history[0].scanType, "full");
    assert.equal(snapshot.history[0].scanDurationMs, 1250);
    assert.equal(snapshot.history[0].engineVersion, "9.8.7");
    assert.deepEqual(snapshot.history[0].matchedRules, ["unsigned-executable"]);
    assert.equal(snapshot.history[0].fileExtension, ".exe");
    assert.equal(snapshot.history[0].source, "removable-media");
    assert.equal(snapshot.history[0].deviceId, "volume:9A1B-2C3D");
    assert.equal(snapshot.history[0].deviceVolume, "E:\\");
    assert.equal(snapshot.history[0].deviceScanTrigger, "manual");
    const record = await reloaded.historyRecord(snapshot.history[0].id);
    assert.equal(record?.report?.filePath, "C:\\samples\\setup.exe");
    assert.equal((record?.report?.evidenceStore as { processingMetadata?: { fileReadCount?: number } } | undefined)?.processingMetadata?.fileReadCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("background settings migrate legacy scan modes and retain deep mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-performance-"));
  const path = join(directory, "background-settings.json");
  try {
    await writeFile(path, JSON.stringify({ settings: { performanceMode: "high" } }), "utf8");
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    assert.equal((await service.initialize()).settings.performanceMode, "deep");
    assert.equal((await service.update({ performanceMode: "light" })).settings.performanceMode, "light");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cancelled scan survives restart with its cancellation diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-cancelled-scan-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan({ id: "cancelled-scan", mode: "full", target: "All accessible PC files", startedAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:05.000Z", currentFile: "Scan cancelled", filesCompleted: 4, filesRemaining: 0, totalFiles: 10, progress: 40, currentStage: "Cancelled", status: "cancelled", investigationCount: 1, pausedDurationMs: 0, filesPendingAtCancellation: 5, activeWorkersAtCancellation: 1, cancelRequestedAt: "2026-08-01T10:00:04.000Z", cancelledAt: "2026-08-01T10:00:05.000Z", cancelLatencyMs: 1000, pendingFiles: [] });
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    const snapshot = await reloaded.initialize();
    assert.equal(snapshot.activeScan?.status, "cancelled");
    assert.equal(snapshot.activeScan?.filesPendingAtCancellation, 5);
    assert.equal(snapshot.activeScan?.cancelLatencyMs, 1000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("history can be cleared by risk scope and clearing local data preserves protection settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-clear-data-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\safe.exe", analyzedAt: "2026-08-01T10:00:00.000Z", hashes: { sha256: "b".repeat(64) }, finalRiskScore: 10, trustScore: 80, recommendation: "ALLOW", metadata: {} } });
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\risk.exe", analyzedAt: "2026-08-01T10:01:00.000Z", hashes: { sha256: "c".repeat(64) }, finalRiskScore: 75, trustScore: 10, recommendation: "AI_ANALYSIS", metadata: {} } });
    await service.clearHistory("high");
    assert.equal((await service.loadHistory()).history.length, 1);
    await service.clearAllData();
    assert.equal(service.snapshot().history.length, 0);
    assert.equal(service.snapshot().activeScan, undefined);
    assert.equal(service.snapshot().settings.backgroundProtection, true);
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(join(directory, "background-history.json")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("history removal operates by record ID and persists only the selected records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-history-removal-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\first.exe", analyzedAt: "2026-08-01T10:00:00.000Z", hashes: { sha256: "d".repeat(64) }, finalRiskScore: 10, metadata: {} } });
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\second.exe", analyzedAt: "2026-08-01T10:01:00.000Z", hashes: { sha256: "e".repeat(64) }, finalRiskScore: 75, metadata: {} } });
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\third.exe", analyzedAt: "2026-08-01T10:02:00.000Z", hashes: { sha256: "f".repeat(64) }, finalRiskScore: 35, metadata: {} } });
    const before = (await service.loadHistory()).history;
    const kept = before.find((record) => record.filePath?.endsWith("second.exe"));
    const removed = before.filter((record) => record.id !== kept?.id);
    const snapshot = await service.removeHistory(removed.map((record) => record.id));
    assert.equal(snapshot.history.length, 1);
    assert.equal(snapshot.history[0]?.id, kept?.id);
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    assert.deepEqual((await reloaded.loadHistory()).history.map((record) => record.id), [kept?.id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a removable-media scan retains its source through persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-removable-scan-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan({ id: "removable-scan", mode: "folder", source: "removable-media", deviceId: "volume:9A1B-2C3D", deviceVolume: "E:\\", deviceScanTrigger: "arrival", target: "E:\\", startedAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:01.000Z", currentFile: "Discovering files", filesCompleted: 0, filesRemaining: 0, totalFiles: 0, progress: 0, currentStage: "Discovering files", status: "running", investigationCount: 0, pausedDurationMs: 0, pendingFiles: [] });
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    const activeScan = (await reloaded.initialize()).activeScan;
    assert.equal(activeScan?.source, "removable-media");
    assert.equal(activeScan?.deviceId, "volume:9A1B-2C3D");
    assert.equal(activeScan?.deviceVolume, "E:\\");
    assert.equal(activeScan?.deviceScanTrigger, "arrival");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("completed scan summaries survive restart and remain available during a replacement scan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-completed-scan-"));
  const path = join(directory, "background-settings.json");
  const completed = { id: "completed-scan", mode: "full" as const, target: "All accessible PC files", startedAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:18:42.000Z", completedAt: "2026-08-01T10:18:42.000Z", elapsedMs: 1_122_000, currentFile: "Local analysis complete", filesCompleted: 842_531, filesRemaining: 0, totalFiles: 842_531, progress: 100, currentStage: "Complete", status: "completed" as const, investigationCount: 3, pausedDurationMs: 0, forensicCount: 50, inventoryCount: 842_481, errorCount: 2, cacheSkipped: 20, pendingFiles: [] };
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan(completed);
    await service.saveScan({ ...completed, id: "replacement-scan", startedAt: "2026-08-01T10:20:00.000Z", updatedAt: "2026-08-01T10:20:00.000Z", completedAt: undefined, elapsedMs: undefined, currentFile: "Preparing local analysis", filesCompleted: 0, filesRemaining: 0, totalFiles: 0, progress: 0, currentStage: "Discovering files", status: "running", investigationCount: 0 });
    const current = service.snapshot();
    assert.equal(current.activeScan?.id, "replacement-scan");
    assert.equal(current.lastCompletedScan?.id, "completed-scan");
    assert.equal(current.lastCompletedScan?.progress, 100);
    assert.equal(current.lastCompletedScan?.elapsedMs, 1_122_000);
    assert.equal(current.lastCompletedScan?.estimatedRemainingMs, undefined);
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    const restored = await reloaded.initialize();
    assert.equal(restored.activeScan?.id, "replacement-scan");
    assert.equal(restored.lastCompletedScan?.id, "completed-scan");
    assert.equal(restored.lastCompletedScan?.status, "completed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});