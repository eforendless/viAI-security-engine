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
  private discoveryRun?: { scanId: string; promise: Promise<void> };
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
    if (scan.status === "finalizing") await this.complete(scan.id);
    else if (scan.status === "cancelling") { this.controller.cancel(); await this.finalizeCancellation(scan.id); }
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
    this.diagnostic(scan.id, `created mode=${mode} workers=${scan.workersTotal} discovery=${discoveryComplete ? "complete" : "pending"}`);
    this.emit("scanStarted", scan);
    this.startWorkers(scan.id, concurrency);
    return scan;
  }

  async discover(scanId: string, source: (controller: ScanController, onBatch: (files: string[]) => Promise<void>) => Promise<void>): Promise<void> {
    if (this.discoveryRun?.scanId === scanId) return this.discoveryRun.promise;
    const controller = this.controllerFor(scanId);
    if (!controller) return;
    const promise = (async () => {
      this.diagnostic(scanId, "discovery started");
      try {
        await source(controller, (files) => this.addCandidates(scanId, files));
        if (!controller.signal.aborted) await this.finishDiscovery(scanId);
      } catch (error) {
        if (controller.signal.aborted) { await this.finalizeCancellation(scanId); return; }
        console.error(`[Scan ${scanId}] discovery failed`, error);
        await this.fail(scanId);
      }
    })();
    this.discoveryRun = { scanId, promise };
    try {
      await promise;
    } finally {
      if (this.discoveryRun?.promise === promise) this.discoveryRun = undefined;
    }
  }

  async addCandidates(scanId: string, files: string[]): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || !await controller.waitUntilRunnable()) return;
    const unique = files.filter((file) => !this.knownFiles.has(file));
    if (!unique.length) return;
    unique.forEach((file) => this.knownFiles.add(file));
    const pending = await this.prioritize(unique, controller.signal);
    if (!await controller.waitUntilRunnable()) return;
    const latest = await this.mutateScan(scanId, (scan) => {
      if (scan.status !== "running") return false;
      scan.pendingFiles.push(...pending);
      scan.totalFiles += pending.length;
      scan.filesRemaining = scan.pendingFiles.length;
      scan.peakQueueLength = Math.max(scan.peakQueueLength ?? 0, scan.pendingFiles.length);
      scan.priorityRemaining = this.priorityCounts(scan.pendingFiles);
      scan.currentFile = "Discovering files"; scan.currentStage = "Discovering files"; scan.updatedAt = new Date().toISOString();
      return true;
    }, { persist: false, publish: false });
    if (!latest) return;
    this.emit("scanProgress", latest);
    this.startWorkers(scanId);
  }

  async finishDiscovery(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || !await controller.waitUntilRunnable()) return;
    const scan = await this.mutateScan(scanId, (active) => {
      if (active.status !== "running") return false;
      active.discoveryComplete = true; active.currentStage = active.pendingFiles.length ? "Prioritizing" : "Finalizing"; active.updatedAt = new Date().toISOString();
      return true;
    }, { publish: false });
    if (!scan) return;
    this.diagnostic(scanId, `discovery completed candidates=${scan.totalFiles}`);
    this.emit("scanProgress", scan);
    this.startWorkers(scanId);
  }

  async pause(): Promise<void> {
    const controller = this.controller;
    if (!controller?.requestPause()) return;
    const scan = await this.mutateScan(controller.scanId, (active) => {
      if (active.status !== "running") return false;
      active.status = "pausing"; active.currentStage = "Pausing"; active.updatedAt = new Date().toISOString();
      return true;
    });
    if (!scan) return;
    this.diagnostic(controller.scanId, "pause requested");
    this.emit("scanPausing", scan);
    await this.finishPause(controller.scanId);
  }

  async resume(): Promise<void> {
    const controller = this.controller;
    if (!controller?.beginResume()) return;
    const scan = await this.mutateScan(controller.scanId, (active) => {
      if (active.status !== "paused") return false;
      if (active.pausedAt) {
        active.pausedDurationMs += Math.max(0, Date.now() - Date.parse(active.pausedAt));
        active.pausedAt = undefined;
      }
      active.status = "resuming"; active.currentStage = "Resuming"; active.updatedAt = new Date().toISOString();
      return true;
    });
    if (!scan) return;
    this.diagnostic(controller.scanId, "resume requested");
    this.emit("scanResuming", scan);
    if (!controller.markRunning()) return;
    if (controller.signal.aborted) return;
    const latest = await this.mutateScan(controller.scanId, (active) => {
      if (active.status !== "resuming") return false;
      active.status = "running"; active.currentStage = "Analyzing"; active.updatedAt = new Date().toISOString();
      return true;
    });
    if (!latest) return;
    this.emit("scanStarted", latest);
    this.startWorkers(latest.id);
  }

  async cancel(): Promise<void> {
    const controller = this.controller;
    if (!controller?.cancel()) return;
    const now = new Date().toISOString();
    const scan = await this.mutateScan(controller.scanId, (active) => {
      if (active.status === "finalizing" || terminal(active.status)) return false;
      active.status = "cancelling"; active.currentStage = "Cancelling"; active.currentFile = "Stopping local analysis";
      active.filesPendingAtCancellation = active.pendingFiles.filter((file) => !this.inFlight.has(file)).length; active.pendingFiles = []; active.filesRemaining = 0; active.priorityRemaining = {};
      active.cancelRequestedAt = now; active.schedulerStoppedAt = now; active.queueClearedAt = now; active.activeWorkersAtCancellation = this.inFlight.size; active.updatedAt = now;
      return true;
    });
    if (!scan) return;
    this.diagnostic(controller.scanId, `cancelling queued=${scan.filesPendingAtCancellation ?? 0} inFlight=${this.inFlight.size}`);
    this.emit("scanCancelling", scan);
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
      const scan = await this.mutateScan(scanId, (active) => {
        if (active.status !== "running") return false;
        const file = active.pendingFiles.find((value) => !this.inFlight.has(value));
        if (!file) return false;
        this.inFlight.add(file); active.workersActive = this.inFlight.size; active.currentFile = file; active.currentStage = "Classifying"; active.updatedAt = new Date().toISOString();
        return true;
      }, { persist: false, publish: false });
      if (!scan) return;
      const file = scan.currentFile;
      let analysis: unknown; let classification: FileClassification | undefined; let failed = false;
      try {
        classification = this.classifications.get(file) ?? await this.classify(file, this.background.scanCacheEntry?.(file));
        checkAbort(controller.signal);
        this.classifications.set(file, classification);
        const resolvedClassification = classification;
        await this.mutateScan(scanId, (active) => {
          if (active.status !== "running") return false;
          active.currentStage = resolvedClassification.cacheHit ? "Cached inventory" : resolvedClassification.profile === "forensic" ? "Forensic analysis" : resolvedClassification.profile === "standard" ? "Standard analysis" : "Inventory";
          return true;
        }, { persist: false, publish: false });
        if (scan.mode === "quick" || !resolvedClassification.cacheHit && resolvedClassification.profile !== "inventory") analysis = await this.analyze(file, scan.mode, resolvedClassification, controller.signal, scan.source === "removable-media" && scan.deviceId && scan.deviceVolume && scan.deviceScanTrigger ? { source: scan.source, id: scan.deviceId, volume: scan.deviceVolume, trigger: scan.deviceScanTrigger } : undefined);
      } catch (error) { if (!isAbort(error) && !controller.signal.aborted) failed = true; }
      this.inFlight.delete(file);
      if (controller.signal.aborted || controller.state === "cancelling") { await this.finalizeCancellation(scanId); return; }
      if (!failed && classification) this.background.recordScanCache?.(file, { size: classification.size, mtimeMs: classification.mtimeMs ?? 0, analyzedAt: new Date().toISOString(), priorityScore: classification.priorityScore ?? 0 });
      const pausing = controller.state === "pausing";
      const latest = await this.mutateScan(scanId, (active) => {
        if (!(active.status === "running" || pausing && active.status === "pausing") || !(controller.state === "running" || pausing)) return false;
        active.pendingFiles = active.pendingFiles.filter((value) => value !== file); active.filesCompleted = active.totalFiles - active.pendingFiles.length; active.filesRemaining = active.pendingFiles.length;
        active.progress = active.totalFiles ? Math.min(99, Math.round(active.filesCompleted / active.totalFiles * 99)) : 0; active.workersActive = this.inFlight.size; active.priorityRemaining = this.priorityCounts(active.pendingFiles);
        if (classification?.cacheHit) { active.cacheHits = (active.cacheHits ?? 0) + 1; active.cacheSkipped = (active.cacheSkipped ?? 0) + 1; } else active.cacheMisses = (active.cacheMisses ?? 0) + 1;
        if (classification?.profile === "forensic") active.forensicCount = (active.forensicCount ?? 0) + 1; else active.inventoryCount = (active.inventoryCount ?? 0) + 1;
        if (failed) active.errorCount = (active.errorCount ?? 0) + 1;
        if (investigate(analysis)) active.investigationCount += 1;
        active.currentFile = file; active.updatedAt = new Date().toISOString();
        const elapsed = elapsedMs(active, Date.now()); active.estimatedRemainingMs = active.filesCompleted ? Math.round(elapsed / active.filesCompleted * active.filesRemaining) : undefined; active.throughputPerSecond = elapsed ? Number((active.filesCompleted / (elapsed / 1000)).toFixed(2)) : 0;
        const usage = this.resourceUsage(); active.cpuPercent = usage.cpuPercent; active.memoryBytes = usage.memoryBytes;
        return true;
      }, { persist: false, publish: false });
      if (!latest) { await this.finishPause(scanId); return; }
      if (this.shouldPublish()) this.emit("scanProgress", latest);
      if (pausing) { await this.finishPause(scanId); return; }
    }
  }

  private async finishPause(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || this.inFlight.size > 0 || !controller.markPaused()) return;
    const scan = await this.mutateScan(scanId, (active) => {
      if (active.status !== "pausing") return false;
      active.status = "paused"; active.currentStage = "Paused"; active.pausedAt = new Date().toISOString(); active.workersActive = 0; active.updatedAt = active.pausedAt;
      return true;
    });
    if (!scan) return;
    this.diagnostic(scanId, "paused after in-flight work settled");
    this.emit("scanPaused", scan);
  }

  private async finalizeCancellation(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || controller.state !== "cancelling" || this.inFlight.size > 0) return;
    controller.transition("cancelled");
    const scan = await this.mutateScan(scanId, (active) => {
      if (active.status !== "cancelling") return false;
      const now = new Date(); active.status = "cancelled"; active.currentStage = "Cancelled"; active.currentFile = "Scan cancelled"; active.workersActive = 0; active.lastWorkerStoppedAt = now.toISOString(); active.cancelledAt = now.toISOString(); active.cancelCompletedAt = now.toISOString(); active.cancelLatencyMs = active.cancelRequestedAt ? Math.max(0, now.valueOf() - Date.parse(active.cancelRequestedAt)) : undefined; active.updatedAt = now.toISOString();
      return true;
    });
    if (!scan) return;
    await this.background.flushScanCache?.(); await this.background.flushHistory();
    this.diagnostic(scanId, "cancelled after in-flight work settled");
    this.emit("scanCancelled", scan);
    this.releaseRuntime(scanId);
  }

  private async complete(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || !(controller.state === "running" || controller.state === "finalizing") || this.inFlight.size > 0) return;
    const finalizing = controller.state === "finalizing" ? this.background.currentScan() : await this.mutateScan(scanId, (scan) => {
      if (scan.status !== "running" || scan.discoveryComplete === false || scan.pendingFiles.length > 0) return false;
      scan.status = "finalizing"; scan.currentStage = "Finalizing"; scan.currentFile = "Saving completed scan"; scan.workersActive = 0; scan.progress = 99; scan.estimatedRemainingMs = undefined; scan.updatedAt = new Date().toISOString();
      return true;
    });
    if (!finalizing || finalizing.id !== scanId || finalizing.status !== "finalizing") return;
    if (controller.state === "running") controller.transition("finalizing");
    this.diagnostic(scanId, "queue drained and analyses settled; finalizing");
    this.emit("scanProgress", finalizing);
    await this.background.flushScanCache?.();
    await this.background.flushHistory(false);
    const completed = await this.mutateScan(scanId, (scan) => {
      if (scan.status !== "finalizing" || controller.state !== "finalizing") return false;
      const completedAt = new Date(); scan.status = "completed"; scan.currentStage = "Complete"; scan.currentFile = "Local analysis complete"; scan.progress = 100; scan.completedAt = completedAt.toISOString(); scan.elapsedMs = elapsedMs(scan, completedAt.valueOf()); scan.updatedAt = scan.completedAt;
      return true;
    }, { publish: false });
    if (!completed) return;
    controller.transition("completed");
    await this.background.completeScan(scanId);
    this.diagnostic(scanId, "history flushed, archived, and active session cleared");
    this.emit("scanCompleted", completed);
    this.releaseRuntime(scanId);
  }
  private async fail(scanId: string): Promise<void> {
    const controller = this.controllerFor(scanId);
    if (!controller || terminal(controller.state)) return;
    const scan = await this.mutateScan(scanId, (active) => {
      if (terminal(active.status) || active.status === "finalizing") return false;
      active.status = "failed"; active.currentStage = "Failed"; active.workersActive = 0; active.updatedAt = new Date().toISOString();
      return true;
    });
    if (!scan) return;
    controller.transition("failed");
    await this.background.flushHistory();
    this.diagnostic(scanId, "failed and stopped");
    this.emit("scanFailed", scan);
    this.releaseRuntime(scanId);
  }
  private async prioritize(files: string[], signal?: AbortSignal): Promise<string[]> { for (let index = 0; index < files.length; index += 16) { checkAbort(signal); await Promise.all(files.slice(index, index + 16).map(async (file) => this.classifications.set(file, await this.classify(file, this.background.scanCacheEntry?.(file))))); } checkAbort(signal); return files.sort((left, right) => (this.classifications.get(right)?.priorityScore ?? 0) - (this.classifications.get(left)?.priorityScore ?? 0)); }
  private async mutateScan(scanId: string, mutation: (scan: PersistedScanState) => boolean, options: import("./backgroundService").SaveScanOptions = {}): Promise<PersistedScanState | undefined> {
    return this.background.mutateActiveScan(scanId, (scan) => mutation(scan) ? { ...scan, pendingFiles: [...scan.pendingFiles] } : undefined, options);
  }
  private releaseRuntime(scanId: string): void {
    if (this.controller?.scanId !== scanId) return;
    this.inFlight.clear(); this.knownFiles.clear(); this.classifications.clear();
    this.controller = undefined;
  }
  private diagnostic(scanId: string, detail: string): void { console.info(`[Scan ${scanId}] ${detail}`); }
  private emit(event: ScanEventName, scan: PersistedScanState): void { const { pendingFiles: _pendingFiles, ...update } = scan; this.publish(event, update); }
  private shouldPublish(): boolean { const now = Date.now(); if (now - this.lastProgressPublishedAt < 100) return false; this.lastProgressPublishedAt = now; return true; }
  private priorityCounts(files: readonly string[]): Partial<Record<PriorityBand, number>> { return files.reduce<Partial<Record<PriorityBand, number>>>((result, file) => { const classification = this.classifications.get(file); const band = classification?.priorityBand ?? (classification?.profile === "inventory" ? "inventory" : "low"); result[band] = (result[band] ?? 0) + 1; return result; }, {}); }
  private resourceUsage(): { cpuPercent: number; memoryBytes: number } { const now = Date.now(); const usage = process.cpuUsage(this.resourceBaseline.usage); const elapsed = Math.max(1, now - this.resourceBaseline.at); this.resourceBaseline = { usage: process.cpuUsage(), at: now }; return { cpuPercent: Math.round(Math.min(100, ((usage.user + usage.system) / 1000 / elapsed) * 100)), memoryBytes: process.memoryUsage().rss }; }
}

function lifecycle(status: PersistedScanState["status"]): ScanLifecycleState { return ["starting", "running", "pausing", "paused", "resuming", "cancelling", "finalizing"].includes(status) ? status as ScanLifecycleState : "failed"; }
function terminal(state: ScanLifecycleState | PersistedScanState["status"]): boolean { return state === "cancelled" || state === "completed" || state === "failed"; }
function elapsedMs(scan: PersistedScanState, now: number): number { return Math.max(0, now - Date.parse(scan.startedAt) - scan.pausedDurationMs - (scan.pausedAt ? Math.max(0, now - Date.parse(scan.pausedAt)) : 0)); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) { const error = signal.reason instanceof Error ? signal.reason : new Error("Scan cancelled"); error.name = "AbortError"; throw error; } }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function investigate(value: unknown): boolean { if (!value || typeof value !== "object") return false; const result = value as { report?: { assessment?: { investigationPriority?: unknown; recommendation?: unknown } }; riskScore?: unknown; recommendation?: unknown }; const assessment = result.report?.assessment; return assessment ? ["MEDIUM", "HIGH", "URGENT"].includes(String(assessment.investigationPriority)) || ["REVIEW", "DYNAMIC_ANALYSIS"].includes(String(assessment.recommendation)) : typeof result.riskScore === "number" && result.riskScore > 25 || result.recommendation === "AI_ANALYSIS"; }