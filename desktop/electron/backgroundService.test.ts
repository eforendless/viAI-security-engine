import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BackgroundService } from "./backgroundService";

test("background history persists complete scan reports for later detail views", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-history-"));
  const path = join(directory, "background-settings.json");
  try {
    const service = new BackgroundService(path, async () => undefined, () => undefined);
    await service.initialize();
    await service.recordAnalysis({ analysis: { filePath: "C:\\samples\\setup.exe", analyzedAt: "2026-08-01T10:00:00.000Z", hashes: { sha256: "a".repeat(64) }, finalRiskScore: 72, trustScore: 18, recommendation: "AI_ANALYSIS", signatureStatus: "missing", metadata: { size: 2048, extension: ".exe" }, evidence: ["Unsigned executable"], evidenceStore: { schemaVersion: "0.2", file: { path: "C:\\samples\\setup.exe", name: "setup.exe" }, warnings: [], processingMetadata: { startedAt: "2026-08-01T10:00:00.000Z", cacheHit: false, fileReadCount: 1, peParseCount: 1, collectors: [] } }, staticAnalysisReport: { matchedRules: [{ id: "unsigned-executable" }] } } }, "full", 1250);
    const reloaded = new BackgroundService(path, async () => undefined, () => undefined);
    await reloaded.initialize();
    const snapshot = await reloaded.loadHistory();
    assert.equal(snapshot.history.length, 1);
    assert.equal(snapshot.history[0].fileHash, "a".repeat(64));
    assert.equal(snapshot.history[0].scanType, "full");
    assert.equal(snapshot.history[0].scanDurationMs, 1250);
    assert.deepEqual(snapshot.history[0].matchedRules, ["unsigned-executable"]);
    assert.equal(snapshot.history[0].report?.filePath, "C:\\samples\\setup.exe");
    assert.equal((snapshot.history[0].report?.evidenceStore as { processingMetadata?: { fileReadCount?: number } } | undefined)?.processingMetadata?.fileReadCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});