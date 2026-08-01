import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundService, PersistedScanState } from "./backgroundService";
import { ScanService, type ScanEventName } from "./scanService";

class MemoryScanRepository {
  scan?: PersistedScanState;
  saves = 0;
  currentScan(): PersistedScanState | undefined { return this.scan ? { ...this.scan, pendingFiles: [...this.scan.pendingFiles] } : undefined; }
  async saveScan(scan: PersistedScanState | undefined, options: { persist?: boolean } = {}): Promise<void> { if (options.persist !== false) this.saves += 1; this.scan = scan ? { ...scan, pendingFiles: [...scan.pendingFiles] } : undefined; }
  async flushHistory(): Promise<void> {}
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