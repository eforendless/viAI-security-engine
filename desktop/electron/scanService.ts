import type { BackgroundService, PersistedScanState, ScanStatus } from "./backgroundService";
import { classifyDiscoveredFile, type FileClassification, type PriorityBand } from "./fileClassification";

export type ScanEventName = "scanStarted" | "scanProgress" | "scanPaused" | "scanCompleted" | "scanCancelled" | "scanFailed";
type ScanUpdate = Omit<PersistedScanState, "pendingFiles">;
const progressCheckpointInterval = 16;

export class ScanService {
  private processing = false;
  private requestedConcurrency = 2;
  private readonly inFlight = new Set<string>();
  private readonly classifications = new Map<string, FileClassification>();
  private readonly idleWaiters: Array<() => void> = [];
  private resourceBaseline = { usage: process.cpuUsage(), at: Date.now() };

  constructor(
    private readonly background: BackgroundService,
    private readonly analyze: (filePath: string, scanType: PersistedScanState["mode"], classification: FileClassification, timeoutMs?: number) => Promise<unknown>,
    private readonly publish: (event: ScanEventName, scan: ScanUpdate) => void,
    private readonly classify: (filePath: string, cached?: import("./fileClassification").ScanCacheEntry) => Promise<FileClassification> = classifyDiscoveredFile,
  ) {}

  async recover(): Promise<void> {
    const scan = this.background.currentScan();
    if (scan?.status === "running") void this.process(scan.id);
  }

  async start(mode: PersistedScanState["mode"], target: string, files: string[], concurrency: number): Promise<PersistedScanState> {
    const existing = this.background.currentScan();
    if (existing?.status === "running" || existing?.status === "paused") throw new Error("A scan is already running");
    this.classifications.clear();
    this.resourceBaseline = { usage: process.cpuUsage(), at: Date.now() };
    this.requestedConcurrency = concurrency;
    const pendingFiles = await this.prioritize([...new Set(files)]);
    const now = new Date().toISOString();
    const scan: PersistedScanState = { id: crypto.randomUUID(), mode, target, startedAt: now, updatedAt: now, currentFile: "Priority queue ready", filesCompleted: 0, filesRemaining: pendingFiles.length, totalFiles: pendingFiles.length, progress: 0, currentStage: "Prioritizing", status: "running", investigationCount: 0, pausedDurationMs: 0, forensicCount: 0, inventoryCount: 0, errorCount: 0, cacheHits: 0, cacheMisses: 0, cacheSkipped: 0, workersActive: 0, workersTotal: Math.max(1, Math.min(concurrency, 8)), peakQueueLength: pendingFiles.length, priorityRemaining: this.priorityCounts(pendingFiles), pendingFiles };
    scan.filesRemaining = scan.pendingFiles.length;
    scan.totalFiles = scan.pendingFiles.length;
    await this.background.saveScan(scan);
    this.publishUpdate("scanStarted", scan);
    void this.process(scan.id, concurrency);
    return scan;
  }

  private async prioritize(files: string[]): Promise<string[]> {
    for (let index = 0; index < files.length; index += 16) {
      await Promise.all(files.slice(index, index + 16).map(async (filePath) => this.classifications.set(filePath, await this.classify(filePath, this.background.scanCacheEntry?.(filePath)))));
    }
    return files.sort((left, right) => (this.classifications.get(right)?.priorityScore ?? 0) - (this.classifications.get(left)?.priorityScore ?? 0));
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
  async cancelAndWait(): Promise<void> { await this.cancel(); if (!this.processing) return; await new Promise<void>((resolve) => this.idleWaiters.push(resolve)); }

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
      const concurrency = Math.max(1, Math.min(requestedConcurrency ?? this.requestedConcurrency, 8));
      await Promise.all(Array.from({ length: concurrency }, () => this.processNext(scanId)));
      const scan = this.background.currentScan();
      if (scan?.id === scanId && scan.status === "running" && scan.pendingFiles.length === 0) {
        scan.status = "completed";
        scan.currentStage = "Complete";
        scan.currentFile = "Local analysis complete";
        scan.progress = 100;
        scan.estimatedRemainingMs = 0;
        scan.workersActive = 0;
        scan.updatedAt = new Date().toISOString();
        await this.background.saveScan(scan);
        await this.background.flushScanCache?.();
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
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      const replacement = this.background.currentScan();
      if (replacement?.id !== scanId && replacement?.status === "running") void this.process(replacement.id);
    }
  }

  private async processNext(scanId: string): Promise<void> {
    while (true) {
      const scan = this.background.currentScan();
      if (!scan || scan.id !== scanId || scan.status !== "running") return;
      const filePath = scan.pendingFiles.find((file) => !this.inFlight.has(file));
      if (!filePath) return;
      this.inFlight.add(filePath);
      scan.workersActive = this.inFlight.size;
      scan.currentFile = filePath;
      scan.currentStage = "Classifying";
      scan.updatedAt = new Date().toISOString();
      let analysis: unknown;
      let classification: FileClassification | undefined;
      let failed = false;
      try {
        classification = this.classifications.get(filePath) ?? await this.classify(filePath, this.background.scanCacheEntry?.(filePath));
        this.classifications.set(filePath, classification);
        scan.currentStage = classification.cacheHit ? "Cached inventory" : classification.profile === "forensic" ? "Forensic analysis" : classification.profile === "standard" ? "Standard analysis" : "Inventory";
        if (!classification.cacheHit && classification.profile !== "inventory") analysis = await this.analyze(filePath, scan.mode, classification);
      } catch { failed = true; }
      if (!failed && classification) this.background.recordScanCache?.(filePath, { size: classification.size, mtimeMs: classification.mtimeMs ?? 0, analyzedAt: new Date().toISOString(), priorityScore: classification.priorityScore ?? 0 });
      this.inFlight.delete(filePath);
      const latest = this.background.currentScan();
      if (!latest || latest.id !== scanId || latest.status !== "running") return;
      latest.pendingFiles = latest.pendingFiles.filter((file) => file !== filePath);
      latest.filesCompleted = latest.totalFiles - latest.pendingFiles.length;
      latest.filesRemaining = latest.pendingFiles.length;
      latest.progress = latest.totalFiles ? Math.round((latest.filesCompleted / latest.totalFiles) * 100) : 100;
      latest.workersActive = this.inFlight.size;
      latest.priorityRemaining = this.priorityCounts(latest.pendingFiles);
      if (classification?.cacheHit) { latest.cacheHits = (latest.cacheHits ?? 0) + 1; latest.cacheSkipped = (latest.cacheSkipped ?? 0) + 1; }
      else latest.cacheMisses = (latest.cacheMisses ?? 0) + 1;
      if (classification?.profile === "forensic") latest.forensicCount = (latest.forensicCount ?? 0) + 1;
      else latest.inventoryCount = (latest.inventoryCount ?? 0) + 1;
      if (failed) latest.errorCount = (latest.errorCount ?? 0) + 1;
      if (needsInvestigation(analysis)) latest.investigationCount += 1;
      latest.currentFile = filePath;
      latest.updatedAt = new Date().toISOString();
      const elapsed = elapsedMs(latest, Date.now());
      latest.estimatedRemainingMs = latest.filesCompleted ? Math.round((elapsed / latest.filesCompleted) * latest.filesRemaining) : undefined;
      latest.throughputPerSecond = elapsed ? Number((latest.filesCompleted / (elapsed / 1_000)).toFixed(2)) : 0;
      const resource = this.resourceUsage();
      latest.cpuPercent = resource.cpuPercent;
      latest.memoryBytes = resource.memoryBytes;
      const checkpoint = latest.filesRemaining > 0 && latest.filesCompleted % progressCheckpointInterval === 0;
      await this.background.saveScan(latest, { persist: checkpoint, publish: false });
      this.publishUpdate("scanProgress", latest);
    }
  }

  private publishUpdate(event: ScanEventName, scan: PersistedScanState): void {
    const { pendingFiles: _pendingFiles, ...update } = scan;
    this.publish(event, update);
  }

  private priorityCounts(files: readonly string[]): Partial<Record<PriorityBand, number>> {
    return files.reduce<Partial<Record<PriorityBand, number>>>((counts, filePath) => {
      const classification = this.classifications.get(filePath);
      const band = classification?.priorityBand ?? (classification?.profile === "inventory" ? "inventory" : "low");
      counts[band] = (counts[band] ?? 0) + 1;
      return counts;
    }, {});
  }

  private resourceUsage(): { cpuPercent: number; memoryBytes: number } {
    const now = Date.now();
    const usage = process.cpuUsage(this.resourceBaseline.usage);
    const elapsed = Math.max(1, now - this.resourceBaseline.at);
    this.resourceBaseline = { usage: process.cpuUsage(), at: now };
    return { cpuPercent: Math.round(Math.min(100, ((usage.user + usage.system) / 1_000 / elapsed) * 100)), memoryBytes: process.memoryUsage().rss };
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