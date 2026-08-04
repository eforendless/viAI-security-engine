import type { BackgroundService, PersistedScanState } from "./backgroundService";
import { ScanController, type ScanLifecycleState } from "./scanController";
import { classifyDiscoveredFile, type FileClassification, type PriorityBand } from "./fileClassification";

export type ScanEventName = "scanStarted" | "scanProgress" | "scanPausing" | "scanPaused" | "scanResuming" | "scanCompleted" | "scanCancelling" | "scanCancelled" | "scanFailed";
type ScanUpdate = Omit<PersistedScanState, "pendingFiles">;
export interface ScanOrigin { source: "removable-media"; id: string; volume: string; trigger: "arrival" | "manual"; }
const checkpointEvery = 16;

export class ScanService {
  private requestedConcurrency = 2;
  private readonly inFlight = new Set<string>();
  private readonly knownFiles = new Set<string>();
  private readonly classifications = new Map<string, FileClassification>();
  private controller?: ScanController;
  private workerRun?: { scanId: string; promise: Promise<void> };
  private readonly idleWaiters: Array<() => void> = [];
  private resourceBaseline = { usage: process.cpuUsage(), at: Date.now() };
  private lastProgressPublishedAt = 0;

  constructor(
    private readonly background: BackgroundService,
    private readonly analyze: (filePath: string, scanType: PersistedScanState["mode"], classification: FileClassification, signal?: AbortSignal, origin?: ScanOrigin) => Promise<unknown>,
    private readonly publish: (event: ScanEventName, scan: ScanUpdate) => void,
    private readonly classify: (filePath: string, cached?: import("./fileClassification").ScanCacheEntry) => Promise<FileClassification> = classifyDiscoveredFile,
  ) {}

  controllerFor(scanId: string): ScanController | undefined { return this.controller?.scanId === scanId ? this.controller : undefined; }

  async recover(): Promise<void> {
    const scan = this.background.currentScan();
    if (!scan || terminal(scan.status)) return;
    const recoveredState = scan.status === "pausing" ? "paused" : lifecycle(scan.status);
    this.controller = new ScanController(scan.id, recoveredState);
    if (scan.status === "cancelling") { this.controller.cancel(); await this.finalizeCancellation(scan.id); }
    else if (recoveredState === "paused") {
      if (scan.status !== "paused") {
        scan.status = "paused"; scan.currentStage = "Paused"; scan.pausedAt ??= new Date().toISOString(); scan.updatedAt = new Date().toISOString();
        await this.background.saveScan(scan); this.emit("scanPaused", scan);
      }
    } else {
      if (recoveredState === "starting" || recoveredState === "resuming") {
        this.controller.markRunning();
        scan.status = "running"; scan.currentStage = "Analyzing"; scan.updatedAt = new Date().toISOString();
        await this.background.saveScan(scan); this.emit("scanStarted", scan);
      }
      this.startWorkers(scan.id);
    }
  }

  async start(mode: PersistedScanState["mode"], target: string, files: string[], concurrency: number, discoveryComplete = true, origin?: ScanOrigin): Promise<PersistedScanState> {
    const current = this.background.currentScan();
    if (current && !terminal(current.status)) throw new Error("A scan is already running");
    const controller = new ScanController(crypto.randomUUID());
    this.controller = controller;
    this.inFlight.clear(); this.knownFiles.clear(); this.classifications.clear();
    this.requestedConcurrency = concurrency;
    this.resourceBaseline = { usage: process.cpuUsage(), at: Date.now() };
    const pendingFiles = await this.prioritize([...new Set(files)], controller.signal);
    checkAbort(controller.signal);
    pendingFiles.forEach((file) => this.knownFiles.add(file));
    controller.markRunning();
    const now = new Date().toISOString();
    const scan: PersistedScanState = { id: controller.scanId, mode, source: origin?.source, deviceId: origin?.id, deviceVolume: origin?.volume, deviceScanTrigger: origin?.trigger, target, startedAt: now, updatedAt: now, currentFile: discoveryComplete ? "Priority queue ready" : "Discovering files", filesCompleted: 0, filesRemaining: pendingFiles.length, totalFiles: pendingFiles.length, progress: 0, currentStage: discoveryComplete ? "Prioritizing" : "Discovering files", status: "running", investigationCount: 0, pausedDurationMs: 0, forensicCount: 0, inventoryCount: 0, errorCount: 0, cacheHits: 0, cacheMisses: 0, cacheSkipped: 0, workersActive: 0, workersTotal: Math.max(1, Math.min(concurrency, 8)), peakQueueLength: pendingFiles.length, priorityRemaining: this.priorityCounts(pendingFiles), discoveryComplete, pendingFiles };
    await this.background.saveScan(scan);
    this.emit("scanStarted", scan);
    this.startWorkers(scan.id, concurrency);
    return scan;
  }

  async addCandidates(scanId: string, files: string[]): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || !await controller.waitUntilRunnable()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== scanId || scan.status !== "running") return;
    const unique = files.filter((file) => !this.knownFiles.has(file));
    if (!unique.length) return;
    unique.forEach((file) => this.knownFiles.add(file));
    const pending = await this.prioritize(unique, controller.signal);
    if (!await controller.waitUntilRunnable()) return;
    const latest = this.background.currentScan();
    if (!latest || latest.id !== scanId || latest.status !== "running") return;
    latest.pendingFiles.push(...pending);
    latest.totalFiles += pending.length;
    latest.filesRemaining = latest.pendingFiles.length;
    latest.peakQueueLength = Math.max(latest.peakQueueLength ?? 0, latest.pendingFiles.length);
    latest.priorityRemaining = this.priorityCounts(latest.pendingFiles);
    latest.currentFile = "Discovering files"; latest.currentStage = "Discovering files"; latest.updatedAt = new Date().toISOString();
    await this.background.saveScan(latest, { persist: false, publish: false });
    this.emit("scanProgress", latest);
    this.startWorkers(scanId);
  }

  async finishDiscovery(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || !await controller.waitUntilRunnable()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== scanId || scan.status !== "running") return;
    scan.discoveryComplete = true; scan.currentStage = scan.pendingFiles.length ? "Prioritizing" : "Finalizing"; scan.updatedAt = new Date().toISOString();
    await this.background.saveScan(scan, { publish: false });
    this.emit("scanProgress", scan);
    this.startWorkers(scanId);
  }

  async pause(): Promise<void> {
    const controller = this.controller;
    if (!controller?.requestPause()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== controller.scanId) return;
    scan.status = "pausing"; scan.currentStage = "Pausing"; scan.updatedAt = new Date().toISOString();
    await this.background.saveScan(scan); this.emit("scanPausing", scan);
    await this.finishPause(controller.scanId);
  }

  async resume(): Promise<void> {
    const controller = this.controller;
    if (!controller?.beginResume()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== controller.scanId) return;
    if (scan.pausedAt) {
      scan.pausedDurationMs += Math.max(0, Date.now() - Date.parse(scan.pausedAt));
      scan.pausedAt = undefined;
    }
    scan.status = "resuming"; scan.currentStage = "Resuming"; scan.updatedAt = new Date().toISOString();
    await this.background.saveScan(scan); this.emit("scanResuming", scan);
    if (!controller.markRunning()) return;
    const latest = this.background.currentScan();
    if (!latest || latest.id !== controller.scanId || controller.signal.aborted) return;
    latest.status = "running"; latest.currentStage = "Analyzing"; latest.updatedAt = new Date().toISOString();
    await this.background.saveScan(latest); this.emit("scanStarted", latest);
    this.startWorkers(latest.id);
  }

  async cancel(): Promise<void> {
    const controller = this.controller;
    if (!controller?.cancel()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== controller.scanId) return;
    const now = new Date().toISOString();
    scan.status = "cancelling"; scan.currentStage = "Cancelling"; scan.currentFile = "Stopping local analysis";
    scan.filesPendingAtCancellation = scan.pendingFiles.filter((file) => !this.inFlight.has(file)).length; scan.pendingFiles = []; scan.filesRemaining = 0; scan.priorityRemaining = {};
    scan.cancelRequestedAt = now; scan.schedulerStoppedAt = now; scan.queueClearedAt = now; scan.activeWorkersAtCancellation = this.inFlight.size; scan.updatedAt = now;
    await this.background.saveScan(scan); this.emit("scanCancelling", scan);
    await this.finalizeCancellation(controller.scanId);
  }

  async cancelAndWait(): Promise<void> { await this.cancel(); if (this.workerRun) await new Promise<void>((resolve) => this.idleWaiters.push(resolve)); }

  private startWorkers(scanId: string, requested?: number): void {
    if (this.workerRun?.scanId === scanId) return;
    const promise = this.runWorkers(scanId, requested);
    this.workerRun = { scanId, promise };
    void promise.finally(() => {
      if (this.workerRun?.promise === promise) this.workerRun = undefined;
      this.idleWaiters.splice(0).forEach((resolve) => resolve());
      const scan = this.background.currentScan();
      if (scan && scan.id === scanId && scan.status === "running" && scan.pendingFiles.length) this.startWorkers(scanId);
    });
  }

  private async runWorkers(scanId: string, requested?: number): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller) return;
    try {
      const concurrency = Math.max(1, Math.min(requested ?? this.requestedConcurrency, 8));
      await Promise.all(Array.from({ length: concurrency }, () => this.processNext(scanId, controller)));
      if (controller.signal.aborted || controller.state === "cancelling") { await this.finalizeCancellation(scanId); return; }
      await this.finishPause(scanId);
      const scan = this.background.currentScan();
      if (scan?.id === scanId && controller.state === "running" && scan.status === "running" && scan.discoveryComplete !== false && scan.pendingFiles.length === 0) await this.complete(scanId);
    } catch {
      if (controller.signal.aborted || controller.state === "cancelling") await this.finalizeCancellation(scanId);
      else await this.fail(scanId);
    }
  }

  private async processNext(scanId: string, controller: ScanController): Promise<void> {
    while (await controller.waitUntilRunnable()) {
      const scan = this.background.currentScan();
      if (!scan || scan.id !== scanId || scan.status !== "running") return;
      const file = scan.pendingFiles.find((value) => !this.inFlight.has(value));
      if (!file) return;
      this.inFlight.add(file); scan.workersActive = this.inFlight.size; scan.currentFile = file; scan.currentStage = "Classifying"; scan.updatedAt = new Date().toISOString();
      await this.background.saveScan(scan, { persist: false, publish: false });
      let analysis: unknown; let classification: FileClassification | undefined; let failed = false;
      try {
        classification = this.classifications.get(file) ?? await this.classify(file, this.background.scanCacheEntry?.(file));
        checkAbort(controller.signal);
        this.classifications.set(file, classification);
        const active = this.background.currentScan();
        if (active?.id === scanId && active.status === "running") { active.currentStage = classification.cacheHit ? "Cached inventory" : classification.profile === "forensic" ? "Forensic analysis" : classification.profile === "standard" ? "Standard analysis" : "Inventory"; await this.background.saveScan(active, { persist: false, publish: false }); }
        if (scan.mode === "quick" || !classification.cacheHit && classification.profile !== "inventory") analysis = await this.analyze(file, scan.mode, classification, controller.signal, scan.source === "removable-media" && scan.deviceId && scan.deviceVolume && scan.deviceScanTrigger ? { source: scan.source, id: scan.deviceId, volume: scan.deviceVolume, trigger: scan.deviceScanTrigger } : undefined);
      } catch (error) { if (!isAbort(error) && !controller.signal.aborted) failed = true; }
      this.inFlight.delete(file);
      if (controller.signal.aborted || controller.state === "cancelling") { await this.finalizeCancellation(scanId); return; }
      if (!failed && classification) this.background.recordScanCache?.(file, { size: classification.size, mtimeMs: classification.mtimeMs ?? 0, analyzedAt: new Date().toISOString(), priorityScore: classification.priorityScore ?? 0 });
      const latest = this.background.currentScan();
      const pausing = controller.state === "pausing" && latest?.status === "pausing";
      if (!latest || latest.id !== scanId || !(latest.status === "running" || pausing) || !(controller.state === "running" || pausing)) { await this.finishPause(scanId); return; }
      latest.pendingFiles = latest.pendingFiles.filter((value) => value !== file); latest.filesCompleted = latest.totalFiles - latest.pendingFiles.length; latest.filesRemaining = latest.pendingFiles.length; latest.progress = latest.totalFiles ? Math.round(latest.filesCompleted / latest.totalFiles * 100) : 100; latest.workersActive = this.inFlight.size; latest.priorityRemaining = this.priorityCounts(latest.pendingFiles);
      if (classification?.cacheHit) { latest.cacheHits = (latest.cacheHits ?? 0) + 1; latest.cacheSkipped = (latest.cacheSkipped ?? 0) + 1; } else latest.cacheMisses = (latest.cacheMisses ?? 0) + 1;
      if (classification?.profile === "forensic") latest.forensicCount = (latest.forensicCount ?? 0) + 1; else latest.inventoryCount = (latest.inventoryCount ?? 0) + 1;
      if (failed) latest.errorCount = (latest.errorCount ?? 0) + 1;
      if (investigate(analysis)) latest.investigationCount += 1;
      latest.currentFile = file; latest.updatedAt = new Date().toISOString();
      const elapsed = elapsedMs(latest, Date.now()); latest.estimatedRemainingMs = latest.filesCompleted ? Math.round(elapsed / latest.filesCompleted * latest.filesRemaining) : undefined; latest.throughputPerSecond = elapsed ? Number((latest.filesCompleted / (elapsed / 1000)).toFixed(2)) : 0;
      const usage = this.resourceUsage(); latest.cpuPercent = usage.cpuPercent; latest.memoryBytes = usage.memoryBytes;
      await this.background.saveScan(latest, { persist: latest.filesRemaining > 0 && latest.filesCompleted % checkpointEvery === 0, publish: false });
      if (this.shouldPublish()) this.emit("scanProgress", latest);
      if (pausing) { await this.finishPause(scanId); return; }
    }
  }

  private async finishPause(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || this.inFlight.size > 0 || !controller.markPaused()) return;
    const scan = this.background.currentScan();
    if (!scan || scan.id !== scanId || scan.status !== "pausing") return;
    scan.status = "paused"; scan.currentStage = "Paused"; scan.pausedAt = new Date().toISOString(); scan.workersActive = 0; scan.updatedAt = scan.pausedAt;
    await this.background.saveScan(scan); this.emit("scanPaused", scan);
  }

  private async finalizeCancellation(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || controller.state !== "cancelling" || this.inFlight.size > 0) return;
    controller.transition("cancelled");
    const scan = this.background.currentScan();
    if (!scan || scan.id !== scanId || scan.status !== "cancelling") return;
    const now = new Date(); scan.status = "cancelled"; scan.currentStage = "Cancelled"; scan.currentFile = "Scan cancelled"; scan.workersActive = 0; scan.lastWorkerStoppedAt = now.toISOString(); scan.cancelledAt = now.toISOString(); scan.cancelCompletedAt = now.toISOString(); scan.cancelLatencyMs = scan.cancelRequestedAt ? Math.max(0, now.valueOf() - Date.parse(scan.cancelRequestedAt)) : undefined; scan.updatedAt = now.toISOString();
    await this.background.saveScan(scan); await this.background.flushScanCache?.(); await this.background.flushHistory(); this.emit("scanCancelled", scan);
  }

  private async complete(scanId: string): Promise<void> { const controller = this.controllerFor(scanId); const scan = this.background.currentScan(); if (!controller || controller.state !== "running" || !scan || scan.id !== scanId || scan.status !== "running") return; const completedAt = new Date(); controller.transition("completed"); scan.status = "completed"; scan.currentStage = "Complete"; scan.currentFile = "Local analysis complete"; scan.progress = 100; scan.estimatedRemainingMs = undefined; scan.workersActive = 0; scan.completedAt = completedAt.toISOString(); scan.elapsedMs = elapsedMs(scan, completedAt.valueOf()); scan.updatedAt = scan.completedAt; await this.background.saveScan(scan); await this.background.flushScanCache?.(); await this.background.flushHistory(); this.emit("scanCompleted", scan); }
  private async fail(scanId: string): Promise<void> { const controller = this.controllerFor(scanId); const scan = this.background.currentScan(); if (!controller || terminal(controller.state) || !scan || scan.id !== scanId || terminal(scan.status)) return; controller.transition("failed"); scan.status = "failed"; scan.currentStage = "Failed"; scan.workersActive = 0; scan.updatedAt = new Date().toISOString(); await this.background.saveScan(scan); await this.background.flushHistory(); this.emit("scanFailed", scan); }
  private async prioritize(files: string[], signal?: AbortSignal): Promise<string[]> { for (let index = 0; index < files.length; index += 16) { checkAbort(signal); await Promise.all(files.slice(index, index + 16).map(async (file) => this.classifications.set(file, await this.classify(file, this.background.scanCacheEntry?.(file))))); } checkAbort(signal); return files.sort((left, right) => (this.classifications.get(right)?.priorityScore ?? 0) - (this.classifications.get(left)?.priorityScore ?? 0)); }
  private emit(event: ScanEventName, scan: PersistedScanState): void { const { pendingFiles: _pendingFiles, ...update } = scan; this.publish(event, update); }
  private shouldPublish(): boolean { const now = Date.now(); if (now - this.lastProgressPublishedAt < 100) return false; this.lastProgressPublishedAt = now; return true; }
  private priorityCounts(files: readonly string[]): Partial<Record<PriorityBand, number>> { return files.reduce<Partial<Record<PriorityBand, number>>>((result, file) => { const classification = this.classifications.get(file); const band = classification?.priorityBand ?? (classification?.profile === "inventory" ? "inventory" : "low"); result[band] = (result[band] ?? 0) + 1; return result; }, {}); }
  private resourceUsage(): { cpuPercent: number; memoryBytes: number } { const now = Date.now(); const usage = process.cpuUsage(this.resourceBaseline.usage); const elapsed = Math.max(1, now - this.resourceBaseline.at); this.resourceBaseline = { usage: process.cpuUsage(), at: now }; return { cpuPercent: Math.round(Math.min(100, ((usage.user + usage.system) / 1000 / elapsed) * 100)), memoryBytes: process.memoryUsage().rss }; }
}

function lifecycle(status: PersistedScanState["status"]): ScanLifecycleState { return ["starting", "running", "pausing", "paused", "resuming", "cancelling"].includes(status) ? status as ScanLifecycleState : "failed"; }
function terminal(state: ScanLifecycleState | PersistedScanState["status"]): boolean { return state === "cancelled" || state === "completed" || state === "failed"; }
function elapsedMs(scan: PersistedScanState, now: number): number { return Math.max(0, now - Date.parse(scan.startedAt) - scan.pausedDurationMs - (scan.pausedAt ? Math.max(0, now - Date.parse(scan.pausedAt)) : 0)); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) { const error = signal.reason instanceof Error ? signal.reason : new Error("Scan cancelled"); error.name = "AbortError"; throw error; } }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function investigate(value: unknown): boolean { if (!value || typeof value !== "object") return false; const result = value as { report?: { assessment?: { investigationPriority?: unknown; recommendation?: unknown } }; riskScore?: unknown; recommendation?: unknown }; const assessment = result.report?.assessment; return assessment ? ["MEDIUM", "HIGH", "URGENT"].includes(String(assessment.investigationPriority)) || ["REVIEW", "DYNAMIC_ANALYSIS"].includes(String(assessment.recommendation)) : typeof result.riskScore === "number" && result.riskScore > 25 || result.recommendation === "AI_ANALYSIS"; }