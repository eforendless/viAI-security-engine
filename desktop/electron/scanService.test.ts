import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundService, PersistedScanState } from "./backgroundService";
import type { FileClassification } from "./fileClassification";
import { ScanService, type ScanEventName } from "./scanService";

class MemoryScanRepository {
  scan?: PersistedScanState;
  saves = 0;
  readonly cache = new Map<string, { size: number; mtimeMs: number; analyzedAt: string; priorityScore: number }>();
  currentScan(): PersistedScanState | undefined { return this.scan ? { ...this.scan, pendingFiles: [...this.scan.pendingFiles] } : undefined; }
  async saveScan(scan: PersistedScanState | undefined, options: { persist?: boolean } = {}): Promise<void> { if (options.persist !== false) this.saves += 1; this.scan = scan ? { ...scan, pendingFiles: [...scan.pendingFiles] } : undefined; }
  async flushHistory(): Promise<void> {}
  scanCacheEntry(filePath: string) { return this.cache.get(filePath); }
  recordScanCache(filePath: string, entry: { size: number; mtimeMs: number; analyzedAt: string; priorityScore: number }): void { this.cache.set(filePath, entry); }
  async flushScanCache(): Promise<void> {}
}

test("scan recovery resumes persisted work and publishes synchronized lifecycle events", async () => {
  const repository = new MemoryScanRepository();
  repository.scan = { id: "recovery", mode: "full", target: "Windows system locations", startedAt: new Date(Date.now() - 2_000).toISOString(), updatedAt: new Date().toISOString(), currentFile: "C:\\pending.exe", filesCompleted: 0, filesRemaining: 1, totalFiles: 1, progress: 0, currentStage: "Analyzing", status: "running", investigationCount: 0, pausedDurationMs: 0, pendingFiles: ["C:\\pending.exe"] };
  const events: ScanEventName[] = [];
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async () => undefined, (event) => { events.push(event); if (event === "scanCompleted") resolve(); });
    void service.recover();
  });
  assert.equal(repository.scan?.status, "completed");
  assert.equal(repository.scan?.filesCompleted, 1);
  assert.equal(repository.scan?.progress, 100);
  assert.deepEqual(events, ["scanProgress", "scanCompleted"]);
});

test("large scans checkpoint progress without persisting every file", async () => {
  const repository = new MemoryScanRepository();
  const files = Array.from({ length: 64 }, (_, index) => `C:\\samples\\${index}.exe`);
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async (_filePath, _mode) => ({ riskScore: 72, recommendation: "AI_ANALYSIS" }), (event) => { if (event === "scanCompleted") resolve(); });
    void service.start("full", "Windows system locations", files, 1);
  });
  assert.equal(repository.scan?.status, "completed");
  assert.equal(repository.scan?.filesCompleted, files.length);
  assert.equal(repository.scan?.investigationCount, files.length);
  assert.ok(repository.saves <= 6, `expected bounded checkpoint writes, received ${repository.saves}`);
});

test("a replacement scan starts after a cancelled worker releases the processing lock", async () => {
  const repository = new MemoryScanRepository();
  let releaseFirstAnalysis: (() => void) | undefined;
  const firstAnalysis = new Promise<void>((resolve) => { releaseFirstAnalysis = resolve; });
  let completeReplacement: (() => void) | undefined;
  const replacementComplete = new Promise<void>((resolve) => { completeReplacement = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async (filePath) => {
    if (filePath === "C:\\samples\\first.exe") await firstAnalysis;
  }, (event) => { if (event === "scanCompleted") completeReplacement?.(); });

  await service.start("full", "Windows system locations", ["C:\\samples\\first.exe"], 1);
  await service.cancel();
  await service.start("full", "Windows system locations", ["C:\\samples\\replacement.exe"], 1);
  releaseFirstAnalysis?.();
  await replacementComplete;

  assert.equal(repository.scan?.status, "completed");
  assert.equal(repository.scan?.currentFile, "Local analysis complete");
  assert.equal(repository.scan?.filesCompleted, 1);
});

test("inventory profiles do not invoke the forensic engine", async () => {
  const repository = new MemoryScanRepository();
  let analyzed = false;
  const inventory = { extension: ".jpg", mimeType: "image/jpeg", executable: false, script: false, archive: false, documentOrMedia: true, category: "media", profile: "inventory", locationRisk: "normal", signatureAvailability: "not-applicable", publisherTrust: "unknown", ageMs: 0, size: 1 } satisfies FileClassification;
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async () => { analyzed = true; }, (event) => { if (event === "scanCompleted") resolve(); }, async () => inventory);
    void service.start("full", "Windows system locations", ["C:\\samples\\photo.jpg"], 1);
  });
  assert.equal(analyzed, false);
  assert.equal(repository.scan?.status, "completed");
});

test("priority queue schedules high-risk candidates before lower-risk files", async () => {
  const repository = new MemoryScanRepository();
  const analyzed: string[] = [];
  const classifications: Record<string, FileClassification> = {
    "C:\\samples\\photo.jpg": { extension: ".jpg", mimeType: "image/jpeg", executable: false, script: false, archive: false, documentOrMedia: true, category: "media", profile: "standard", locationRisk: "normal", signatureAvailability: "not-applicable", publisherTrust: "unknown", ageMs: 0, size: 1, priorityScore: 5, priorityBand: "low" },
    "C:\\samples\\download.exe": { extension: ".exe", mimeType: "application/vnd.microsoft.portable-executable", executable: true, script: false, archive: false, documentOrMedia: false, category: "executable", profile: "forensic", locationRisk: "high", signatureAvailability: "not-checked", publisherTrust: "unknown", ageMs: 0, size: 1, priorityScore: 95, priorityBand: "critical" },
  };
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async (filePath) => { analyzed.push(filePath); }, (event) => { if (event === "scanCompleted") resolve(); }, async (filePath) => classifications[filePath]);
    void service.start("full", "Windows system locations", ["C:\\samples\\photo.jpg", "C:\\samples\\download.exe"], 1);
  });
  assert.deepEqual(analyzed, ["C:\\samples\\download.exe", "C:\\samples\\photo.jpg"]);
  assert.equal(repository.scan?.priorityRemaining?.critical ?? 0, 0);
});

test("an unchanged candidate reuses the scheduler cache on a later scan", async () => {
  const repository = new MemoryScanRepository();
  const candidate = { extension: ".exe", mimeType: "application/vnd.microsoft.portable-executable", executable: true, script: false, archive: false, documentOrMedia: false, category: "executable", profile: "forensic", locationRisk: "high", signatureAvailability: "not-checked", publisherTrust: "unknown", ageMs: 0, size: 42, mtimeMs: 7, priorityScore: 90, priorityBand: "critical" } satisfies FileClassification;
  let analyzed = 0;
  const classify = async (_filePath: string, cached?: { size: number; mtimeMs: number }) => cached ? { ...candidate, profile: "inventory" as const, priorityBand: "inventory" as const, cacheHit: true } : candidate;
  await new Promise<void>((resolve) => { const service = new ScanService(repository as unknown as BackgroundService, async () => { analyzed += 1; }, (event) => { if (event === "scanCompleted") resolve(); }, classify); void service.start("full", "Windows system locations", ["C:\\samples\\stable.exe"], 1); });
  await new Promise<void>((resolve) => { const service = new ScanService(repository as unknown as BackgroundService, async () => { analyzed += 1; }, (event) => { if (event === "scanCompleted") resolve(); }, classify); void service.start("full", "Windows system locations", ["C:\\samples\\stable.exe"], 1); });
  assert.equal(analyzed, 1);
  assert.equal(repository.scan?.cacheHits, 1);
});

test("a recovered scan processes every queued candidate without a global time limit", async () => {
  const repository = new MemoryScanRepository();
  repository.scan = { id: "recovered", mode: "full", target: "All accessible PC files", startedAt: new Date(Date.now() - 2_000).toISOString(), updatedAt: new Date().toISOString(), currentFile: "C:\\one.exe", filesCompleted: 0, filesRemaining: 2, totalFiles: 2, progress: 0, currentStage: "Analyzing", status: "running", investigationCount: 0, pausedDurationMs: 0, pendingFiles: ["C:\\one.exe", "C:\\two.exe"] };
  const analyzed: string[] = [];
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async (filePath) => { analyzed.push(filePath); }, (event) => { if (event === "scanCompleted") resolve(); });
    void service.recover();
  });
  assert.deepEqual(analyzed, ["C:\\one.exe", "C:\\two.exe"]);
  assert.equal(repository.scan?.filesCompleted, 2);
  assert.equal(repository.scan?.currentStage, "Complete");
});

test("cancelling and waiting drains in-flight analysis before local data can reset", async () => {
  const repository = new MemoryScanRepository();
  let releaseAnalysis: (() => void) | undefined;
  const analysis = new Promise<void>((resolve) => { releaseAnalysis = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async () => analysis, () => undefined);
  await service.start("full", "Windows system locations", ["C:\\samples\\pending.exe"], 1);
  const drained = service.cancelAndWait();
  releaseAnalysis?.();
  await drained;
  assert.equal(repository.scan?.status, "cancelled");
});