import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundService, PersistedScanState } from "./backgroundService";
import { ScanService, type ScanEventName } from "./scanService";

class MemoryScanRepository {
  scan?: PersistedScanState;
  currentScan(): PersistedScanState | undefined { return this.scan ? { ...this.scan, pendingFiles: [...this.scan.pendingFiles] } : undefined; }
  async saveScan(scan: PersistedScanState | undefined): Promise<void> { this.scan = scan ? { ...scan, pendingFiles: [...scan.pendingFiles] } : undefined; }
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