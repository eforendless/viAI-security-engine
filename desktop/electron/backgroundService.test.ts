import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackgroundService } from "./backgroundService";

test("background history persists complete scan reports for later detail views", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-history-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined, "9.8.7");
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\setup.exe", analyzedAt: "2026-08-01T10:00:00.000Z", hashes: { sha256: "a".repeat(64) }, finalRiskScore: 72, trustScore: 18, recommendation: "AI_ANALYSIS", signatureStatus: "missing", metadata: { size: 2048, extension: ".exe" }, evidence: ["Unsigned executable"], evidenceStore: { schemaVersion: "0.2", file: { path: "C:\\samples\\setup.exe", name: "setup.exe" }, warnings: [], processingMetadata: { startedAt: "2026-08-01T10:00:00.000Z", cacheHit: false, fileReadCount: 1, peParseCount: 1, collectors: [] } }, staticAnalysisReport: { matchedRules: [{ id: "unsigned-executable" }] } } }, "full", 1250);
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