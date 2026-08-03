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

test("canonical assessment overrides conflicting legacy risk score for investigation counts", async () => {
  const repository = new MemoryScanRepository();
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async () => ({ riskScore: 99, recommendation: "AI_ANALYSIS", report: { assessment: { schemaVersion: "0.3", verdict: "LIKELY_BENIGN", suspicion: { score: 18, level: "low" }, trust: { score: 91, level: "high" }, confidence: { score: 95, level: "high" }, investigationPriority: "LOW", recommendation: "ALLOW" } } }), (event) => { if (event === "scanCompleted") resolve(); });
    void service.start("full", "Windows system locations", ["C:\\samples\\assessment-wins.exe"], 1);
  });
  assert.equal(repository.scan?.investigationCount, 0);
});

test("quick scan analyzes an explicitly selected file even when scheduler classification is inventory", async () => {
  const repository = new MemoryScanRepository();
  let analyzed = false;
  const inventory = { extension: ".jpg", mimeType: "image/jpeg", executable: false, script: false, archive: false, documentOrMedia: true, category: "media", profile: "inventory", locationRisk: "normal", signatureAvailability: "not-applicable", publisherTrust: "unknown", ageMs: 0, size: 1 } satisfies FileClassification;
  await new Promise<void>((resolve) => {
    const service = new ScanService(repository as unknown as BackgroundService, async () => { analyzed = true; }, (event) => { if (event === "scanCompleted") resolve(); }, async () => inventory);
    void service.start("quick", "C:\\samples\\chosen.jpg", ["C:\\samples\\chosen.jpg"], 1);
  });
  assert.equal(analyzed, true);
  assert.equal(repository.scan?.status, "completed");
});

test("discovery-backed scans stay active until discovery completes and queued files drain", async () => {
  const repository = new MemoryScanRepository();
  let complete: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async () => undefined, (event) => { if (event === "scanCompleted") complete?.(); });
  const scan = await service.start("full", "All accessible PC files", [], 1, false);
  assert.equal(repository.scan?.status, "running");
  assert.equal(repository.scan?.discoveryComplete, false);
  await service.addCandidates(scan.id, ["C:\\samples\\candidate.exe"]);
  await service.finishDiscovery(scan.id);
  await completed;
  assert.equal(repository.scan?.status, "completed");
  assert.equal(repository.scan?.filesCompleted, 1);
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
  assert.deepEqual(new Set(analyzed), new Set(["C:\\one.exe", "C:\\two.exe"]));
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

const forensic = { extension: ".exe", mimeType: "application/vnd.microsoft.portable-executable", executable: true, script: false, archive: false, documentOrMedia: false, category: "executable", profile: "forensic", locationRisk: "high", signatureAvailability: "not-checked", publisherTrust: "unknown", ageMs: 0, size: 1, priorityBand: "critical", priorityScore: 100 } satisfies FileClassification;

test("cancelling an active scan aborts its request and does not start queued files", async () => {
  const repository = new MemoryScanRepository();
  let started: (() => void) | undefined;
  let cancelled: (() => void) | undefined;
  let abortObserved = false;
  const cancelledEvent = new Promise<void>((resolve) => { cancelled = resolve; });
  const active = new Promise<void>((resolve) => { started = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async (_filePath, _mode, _classification, signal) => new Promise((_resolve, reject) => {
    started?.();
    signal?.addEventListener("abort", () => { abortObserved = true; reject(signal.reason); }, { once: true });
  }), (event) => { if (event === "scanCancelled") cancelled?.(); }, async () => forensic);
  await service.start("full", "Windows system locations", ["C:\\samples\\active.exe", "C:\\samples\\queued.exe"], 1);
  await active;
  await service.cancel();
  await cancelledEvent;
  assert.equal(abortObserved, true);
  assert.equal(repository.scan?.status, "cancelled");
  assert.equal(repository.scan?.filesCompleted, 0);
  assert.equal(repository.scan?.filesPendingAtCancellation, 1);
});

test("a late successful analysis cannot mutate a cancelled scan", async () => {
  const repository = new MemoryScanRepository();
  let begin: (() => void) | undefined;
  let resolveAnalysis: (() => void) | undefined;
  let cancelled: (() => void) | undefined;
  const began = new Promise<void>((resolve) => { begin = resolve; });
  const completedAnalysis = new Promise<void>((resolve) => { resolveAnalysis = resolve; });
  const cancelledEvent = new Promise<void>((resolve) => { cancelled = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async () => { begin?.(); await completedAnalysis; return { riskScore: 99, recommendation: "AI_ANALYSIS" }; }, (event) => { if (event === "scanCancelled") cancelled?.(); }, async () => forensic);
  await service.start("full", "Windows system locations", ["C:\\samples\\late.exe"], 1);
  await began;
  await service.cancel();
  resolveAnalysis?.();
  await cancelledEvent;
  assert.equal(repository.scan?.status, "cancelled");
  assert.equal(repository.scan?.filesCompleted, 0);
  assert.equal(repository.scan?.investigationCount, 0);
});

test("pause waits for active work, preserves the queue, and resume drains it once", async () => {
  const repository = new MemoryScanRepository();
  let releaseFirst: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  let paused: (() => void) | undefined;
  let completed: (() => void) | undefined;
  let starts = 0;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const activeFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
  const pausedEvent = new Promise<void>((resolve) => { paused = resolve; });
  const completedEvent = new Promise<void>((resolve) => { completed = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async () => { starts += 1; if (starts === 1) { firstStarted?.(); await first; } }, (event) => { if (event === "scanPaused") paused?.(); if (event === "scanCompleted") completed?.(); }, async () => forensic);
  await service.start("full", "Windows system locations", ["C:\\samples\\one.exe", "C:\\samples\\two.exe"], 1);
  await activeFirst;
  await service.pause();
  assert.equal(repository.scan?.status, "pausing");
  releaseFirst?.();
  await pausedEvent;
  assert.equal(repository.scan?.status, "paused");
  assert.equal(repository.scan?.filesRemaining, 1);
  assert.equal(starts, 1);
  await service.resume();
  await completedEvent;
  assert.equal(repository.scan?.status, "completed");
  assert.equal(starts, 2);
});

test("cancellation from paused state finalizes without resuming queued files", async () => {
  const repository = new MemoryScanRepository();
  let releaseFirst: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  let paused: (() => void) | undefined;
  let cancelled: (() => void) | undefined;
  const pausedEvent = new Promise<void>((resolve) => { paused = resolve; });
  const cancelledEvent = new Promise<void>((resolve) => { cancelled = resolve; });
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const activeFirst = new Promise<void>((resolve) => { firstStarted = resolve; });
  const service = new ScanService(repository as unknown as BackgroundService, async () => { firstStarted?.(); await first; }, (event) => { if (event === "scanPaused") paused?.(); if (event === "scanCancelled") cancelled?.(); }, async () => forensic);
  await service.start("full", "Windows system locations", ["C:\\samples\\one.exe"], 1);
  await activeFirst;
  await service.pause();
  releaseFirst?.();
  await pausedEvent;
  void service.addCandidates(repository.scan!.id, ["C:\\samples\\two.exe"]);
  await service.cancel();
  await cancelledEvent;
  assert.equal(repository.scan?.status, "cancelled");
  assert.equal(repository.scan?.filesRemaining, 0);
});