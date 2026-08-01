import type { BackgroundService, PersistedScanState, ScanStatus } from "./backgroundService";

export type ScanEventName = "scanStarted" | "scanProgress" | "scanPaused" | "scanCompleted" | "scanCancelled" | "scanFailed";
type ScanUpdate = Omit<PersistedScanState, "pendingFiles">;
const progressCheckpointInterval = 16;

export class ScanService {
  private processing = false;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly background: BackgroundService,
    private readonly analyze: (filePath: string, scanType: PersistedScanState["mode"]) => Promise<unknown>,
    private readonly publish: (event: ScanEventName, scan: ScanUpdate) => void,
  ) {}

  async recover(): Promise<void> {
    const scan = this.background.currentScan();
    if (scan?.status === "running") void this.process(scan.id);
  }

  async start(mode: PersistedScanState["mode"], target: string, files: string[], concurrency: number): Promise<PersistedScanState> {
    const existing = this.background.currentScan();
    if (existing?.status === "running" || existing?.status === "paused") throw new Error("A scan is already running");
    const now = new Date().toISOString();
    const scan: PersistedScanState = { id: crypto.randomUUID(), mode, target, startedAt: now, updatedAt: now, currentFile: "Preparing local analysis...", filesCompleted: 0, filesRemaining: files.length, totalFiles: files.length, progress: 0, currentStage: "Preparing", status: "running", investigationCount: 0, pausedDurationMs: 0, pendingFiles: [...new Set(files)] };
    scan.filesRemaining = scan.pendingFiles.length;
    scan.totalFiles = scan.pendingFiles.length;
    await this.background.saveScan(scan);
    this.publishUpdate("scanStarted", scan);
    void this.process(scan.id, concurrency);
    return scan;
  }

  async pause(): Promise<void> { await this.transition("paused", "scanPaused"); }
  async resume(): Promise<void> {
    const scan = this.background.currentScan();
    if (!scan || scan.status !== "paused") return;
    const now = Date.now();
    scan.pausedDurationMs += scan.pausedAt ? Math.max(0, now - Date.parse(scan.pausedAt)) : 0;
    scan.pausedAt = undefined;
    scan.status = "running";
    scan.currentStage = "Analyzing";
    scan.updatedAt = new Date(now).toISOString();
    await this.background.saveScan(scan);
    this.publishUpdate("scanStarted", scan);
    void this.process(scan.id);
  }
  async cancel(): Promise<void> { await this.transition("cancelled", "scanCancelled"); }

  private async transition(status: ScanStatus, event: ScanEventName): Promise<void> {
    const scan = this.background.currentScan();
    if (!scan || scan.status !== "running") return;
    scan.status = status;
    scan.currentStage = status === "paused" ? "Paused" : "Cancelled";
    scan.pausedAt = status === "paused" ? new Date().toISOString() : undefined;
    scan.updatedAt = new Date().toISOString();
    await this.background.saveScan(scan);
    this.publishUpdate(event, scan);
  }

  private async process(scanId: string, requestedConcurrency?: number): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const concurrency = Math.max(1, Math.min(requestedConcurrency ?? 2, 8));
      await Promise.all(Array.from({ length: concurrency }, () => this.processNext(scanId)));
      const scan = this.background.currentScan();
      if (scan?.id === scanId && scan.status === "running" && scan.pendingFiles.length === 0) {
        scan.status = "completed";
        scan.currentStage = "Complete";
        scan.currentFile = "Local analysis complete";
        scan.progress = 100;
        scan.estimatedRemainingMs = 0;
        scan.updatedAt = new Date().toISOString();
        await this.background.saveScan(scan);
        await this.background.flushHistory();
        this.publishUpdate("scanCompleted", scan);
      }
    } catch {
      const scan = this.background.currentScan();
      if (scan?.id === scanId && scan.status === "running") {
        scan.status = "failed";
        scan.currentStage = "Failed";
        scan.updatedAt = new Date().toISOString();
        await this.background.saveScan(scan);
        await this.background.flushHistory();
        this.publishUpdate("scanFailed", scan);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processNext(scanId: string): Promise<void> {
    while (true) {
      const scan = this.background.currentScan();
      if (!scan || scan.id !== scanId || scan.status !== "running") return;
      const filePath = scan.pendingFiles.find((file) => !this.inFlight.has(file));
      if (!filePath) return;
      this.inFlight.add(filePath);
      scan.currentFile = filePath;
      scan.currentStage = "Analyzing";
      scan.updatedAt = new Date().toISOString();
      let analysis: unknown;
      try { analysis = await this.analyze(filePath, scan.mode); } catch { /* Continue scanning and retain the failed candidate for recovery evidence. */ }
      this.inFlight.delete(filePath);
      const latest = this.background.currentScan();
      if (!latest || latest.id !== scanId || latest.status !== "running") return;
      latest.pendingFiles = latest.pendingFiles.filter((file) => file !== filePath);
      latest.filesCompleted = latest.totalFiles - latest.pendingFiles.length;
      latest.filesRemaining = latest.pendingFiles.length;
      latest.progress = latest.totalFiles ? Math.round((latest.filesCompleted / latest.totalFiles) * 100) : 100;
      if (needsInvestigation(analysis)) latest.investigationCount += 1;
      latest.currentFile = filePath;
      latest.updatedAt = new Date().toISOString();
      const elapsed = elapsedMs(latest, Date.now());
      latest.estimatedRemainingMs = latest.filesCompleted ? Math.round((elapsed / latest.filesCompleted) * latest.filesRemaining) : undefined;
      const checkpoint = latest.filesRemaining > 0 && latest.filesCompleted % progressCheckpointInterval === 0;
      await this.background.saveScan(latest, { persist: checkpoint, publish: false });
      this.publishUpdate("scanProgress", latest);
    }
  }

  private publishUpdate(event: ScanEventName, scan: PersistedScanState): void {
    const { pendingFiles: _pendingFiles, ...update } = scan;
    this.publish(event, update);
  }
}

function elapsedMs(scan: PersistedScanState, now: number): number {
  const paused = scan.pausedAt ? Math.max(0, now - Date.parse(scan.pausedAt)) : 0;
  return Math.max(0, now - Date.parse(scan.startedAt) - scan.pausedDurationMs - paused);
}

function needsInvestigation(analysis: unknown): boolean {
  if (!analysis || typeof analysis !== "object") return false;
  const result = analysis as { riskScore?: unknown; recommendation?: unknown };
  return (typeof result.riskScore === "number" && result.riskScore > 25) || result.recommendation === "AI_ANALYSIS";
}