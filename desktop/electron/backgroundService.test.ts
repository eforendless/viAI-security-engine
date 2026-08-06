import assert from "node:assert/strict";
import { mkdtemp, rm as remove } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackgroundService } from "./backgroundService";

async function rm(path: string, options: { recursive: true; force: true }): Promise<void> { BackgroundService.closePathBackedPersistence(); await remove(path, options); }

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

test("background settings normalize legacy performance modes and retain deep mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-performance-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    assert.equal((await service.update({ performanceMode: "high" })).settings.performanceMode, "deep");
    assert.equal((await service.update({ performanceMode: "light" })).settings.performanceMode, "light");
    service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active scan mutations serialize concurrent scheduler updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-scan-mutation-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan({ id: "serialized", mode: "full", target: "Common Windows locations", startedAt: "2026-08-04T12:00:00.000Z", updatedAt: "2026-08-04T12:00:00.000Z", currentFile: "", filesCompleted: 0, filesRemaining: 2, totalFiles: 2, progress: 0, currentStage: "Analyzing", status: "running", investigationCount: 0, pausedDurationMs: 0, pendingFiles: ["C:\\samples\\one.exe", "C:\\samples\\two.exe"] });
    await Promise.all(["C:\\samples\\one.exe", "C:\\samples\\two.exe"].map((file) => service.mutateActiveScan("serialized", (scan) => {
      scan.pendingFiles = scan.pendingFiles.filter((candidate) => candidate !== file);
      scan.filesCompleted = scan.totalFiles - scan.pendingFiles.length;
      scan.filesRemaining = scan.pendingFiles.length;
    }, { publish: false })));
    const scan = service.currentScan();
    assert.deepEqual(scan?.pendingFiles, []);
    assert.equal(scan?.filesCompleted, 2);
    assert.equal(scan?.filesRemaining, 0);
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
    assert.equal(snapshot.activeScan, undefined);
    const report = await reloaded.scanReport("cancelled-scan");
    assert.equal(report?.status, "cancelled");
    assert.equal(report?.completionPercentage, 40);
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

test("completed scans clear active state across restart and remain available during a replacement scan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-completed-scan-"));
  const path = join(directory, "background-settings.json");
  const completed = { id: "completed-scan", mode: "full" as const, target: "All accessible PC files", startedAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:18:42.000Z", completedAt: "2026-08-01T10:18:42.000Z", elapsedMs: 1_122_000, currentFile: "Local analysis complete", filesCompleted: 842_531, filesRemaining: 0, totalFiles: 842_531, progress: 100, currentStage: "Complete", status: "completed" as const, investigationCount: 3, pausedDurationMs: 0, forensicCount: 50, inventoryCount: 842_481, errorCount: 2, cacheSkipped: 20, pendingFiles: [] };
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\completed.exe", analyzedAt: "2026-08-01T10:18:42.000Z", hashes: { sha256: "f".repeat(64) }, finalRiskScore: 72, recommendation: "AI_ANALYSIS", metadata: {} } }, "full");
    await service.saveScan(completed);
    await service.completeScan(completed.id);
    const completedSnapshot = service.snapshot();
    assert.equal(completedSnapshot.activeScan, undefined);
    assert.equal(completedSnapshot.lastCompletedScan?.id, "completed-scan");
    assert.equal(completedSnapshot.lastCompletedScan?.completedAt, "2026-08-01T10:18:42.000Z");
    assert.equal(completedSnapshot.history.some((record) => record.fileHash === "f".repeat(64)), true);
    const restarted = new BackgroundService(path, async () => undefined, () => undefined);
    const restartedSnapshot = await restarted.initialize();
    assert.equal(restartedSnapshot.activeScan, undefined);
    assert.equal(restartedSnapshot.lastCompletedScan?.id, "completed-scan");
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

test("full scan reports persist separately from scan-scoped assessment history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-scan-report-"));
  const path = join(directory, "background-settings.json");
  const scan = { id: "report-scan", mode: "full" as const, performanceMode: "deep" as const, target: "All accessible PC files", startedAt: "2026-08-06T13:42:00.000Z", updatedAt: "2026-08-06T13:44:00.000Z", completedAt: "2026-08-06T13:44:00.000Z", elapsedMs: 120_000, currentFile: "Local analysis complete", filesCompleted: 2, filesRemaining: 0, totalFiles: 2, progress: 100, currentStage: "Complete", status: "completed" as const, investigationCount: 0, pausedDurationMs: 0, forensicCount: 1, inventoryCount: 1, errorCount: 0, cacheSkipped: 0, pendingFiles: [], completedFiles: ["C:\\samples\\safe.exe", "C:\\samples\\photo.jpg"] };
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan(scan);
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\safe.exe", analyzedAt: "2026-08-06T13:43:00.000Z", hashes: { sha256: "a".repeat(64) }, finalRiskScore: 5, recommendation: "ALLOW", metadata: {}, report: { assessment: { schemaVersion: "0.3", verdict: "LIKELY_BENIGN", suspicion: { score: 5, level: "low" }, trust: { score: 90, level: "high" }, confidence: { score: 90, level: "high" }, investigationPriority: "LOW", recommendation: "ALLOW" } } } }, "full", 20, false, undefined, scan.id);
    await service.completeScan(scan.id);
    const report = await service.scanReport(scan.id);
    assert.equal(report?.status, "completed");
    assert.equal(report?.performanceMode, "deep");
    assert.equal(report?.processedCount, 2);
    assert.equal(report?.safeCount, 1);
    assert.equal((await service.historyPage({ scanId: scan.id })).total, 1);
    const restarted = new BackgroundService(path, async () => undefined, () => undefined);
    await restarted.initialize();
    assert.equal((await restarted.scanReport(scan.id))?.status, "completed");
    assert.equal((await restarted.historyPage({ scanId: scan.id })).total, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime report updates expose active counters and terminal cancellation retains final duration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-runtime-report-"));
  const path = join(directory, "background-settings.json");
  const running = { id: "live-report", mode: "full" as const, performanceMode: "balanced" as const, target: "Common Windows locations", startedAt: "2026-08-06T13:42:00.000Z", updatedAt: "2026-08-06T13:44:00.000Z", currentFile: "C:\\samples\\active.exe", filesCompleted: 17, filesRemaining: 8, totalFiles: 25, progress: 68, currentStage: "Analyzing", status: "running" as const, investigationCount: 1, pausedDurationMs: 0, inventoryCount: 4, errorCount: 0, cacheSkipped: 2, pendingFiles: [] };
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.saveScan(running);
    const live = await service.runtimeScanReport({ ...running, completedFiles: [] });
    assert.equal(live?.status, "running");
    assert.equal(live?.processedCount, 17);
    assert.equal(live?.completionPercentage, 68);
    assert.equal(live?.performanceMode, "balanced");
    assert.ok((live?.elapsedMs ?? 0) > 0);

    const cancelled = { ...running, status: "cancelled" as const, currentStage: "Cancelled", filesRemaining: 0, updatedAt: "2026-08-06T13:44:34.000Z", cancelledAt: "2026-08-06T13:44:34.000Z", elapsedMs: 34_000, pendingFiles: [] };
    await service.saveScan(cancelled);
    await service.finalizeScan(cancelled.id);
    const final = await service.scanReport(cancelled.id);
    assert.equal(final?.status, "cancelled");
    assert.equal(final?.elapsedMs, 34_000);
    assert.equal(final?.endedAt, "2026-08-06T13:44:34.000Z");
    assert.equal(final?.processedCount, 17);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});