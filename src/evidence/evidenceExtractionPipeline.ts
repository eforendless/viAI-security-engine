import { type Stats } from "node:fs";
import { lstat, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { EvidenceCollectorExecution, EvidenceStore } from "../types.js";

export interface EvidenceSnapshot {
  readonly filePath: string;
  readonly bytes: Buffer;
  readonly fileStat: Stats;
  readonly linkStat: Stats;
}

export interface EvidenceSnapshotReader {
  probe(filePath: string): Promise<Stats>;
  read(filePath: string, fileStat: Stats): Promise<EvidenceSnapshot>;
}

export interface EvidenceCollectionContext {
  readonly filePath: string;
  readonly source?: "download" | "filesystem" | "removable-media";
  readonly snapshot: EvidenceSnapshot;
}

export interface EvidenceCollector {
  readonly id: string;
  collect(context: EvidenceCollectionContext, evidence: EvidenceStore): Promise<EvidenceStore>;
}

export interface EvidencePipelineEvent {
  readonly type: "collector-started" | "collector-finished" | "collector-failed" | "pipeline-completed";
  readonly filePath: string;
  readonly collectorId?: string;
  readonly durationMs?: number;
  readonly warning?: string;
  readonly cacheHit?: boolean;
}

export interface EvidenceExtractionPipelineOptions {
  readonly collectors: readonly EvidenceCollector[];
  readonly snapshotReader?: EvidenceSnapshotReader;
  readonly cache?: Map<string, EvidenceStore>;
}

export class EvidenceExtractionPipeline {
  private readonly listeners = new Set<(event: EvidencePipelineEvent) => void>();
  private readonly snapshotReader: EvidenceSnapshotReader;
  private readonly cache: Map<string, EvidenceStore>;

  constructor(private readonly options: EvidenceExtractionPipelineOptions) {
    this.snapshotReader = options.snapshotReader ?? new LocalEvidenceSnapshotReader();
    this.cache = options.cache ?? new Map();
  }

  onEvent(listener: (event: EvidencePipelineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async extract(filePath: string, source?: "download" | "filesystem" | "removable-media"): Promise<EvidenceStore> {
    const resolvedPath = resolve(filePath);
    const fileStat = await this.snapshotReader.probe(resolvedPath);
    const cacheKey = `${resolvedPath}\u0000${source ?? "unknown"}\u0000${fileStat.size}\u0000${fileStat.mtimeMs}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const evidence = completeEvidence(cached, true, 0);
      this.emit({ type: "pipeline-completed", filePath: resolvedPath, cacheHit: true });
      return evidence;
    }

    const snapshot = await this.snapshotReader.read(resolvedPath, fileStat);
    const context: EvidenceCollectionContext = { filePath: resolvedPath, source, snapshot };
    let evidence = createEvidenceStore(resolvedPath, source);
    for (const collector of this.options.collectors) {
      const startedAt = performance.now();
      this.emit({ type: "collector-started", filePath: resolvedPath, collectorId: collector.id });
      try {
        evidence = freezeEvidence(await collector.collect(context, evidence));
        const durationMs = Math.round(performance.now() - startedAt);
        evidence = recordCollector(evidence, { id: collector.id, status: "completed", durationMs });
        this.emit({ type: "collector-finished", filePath: resolvedPath, collectorId: collector.id, durationMs });
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        const warning = `${collector.id}: ${error instanceof Error ? error.message : "collection failed"}`;
        evidence = recordCollector(enrichEvidence(evidence, { warnings: [...evidence.warnings, warning] }), { id: collector.id, status: "failed", durationMs, warning });
        this.emit({ type: "collector-failed", filePath: resolvedPath, collectorId: collector.id, durationMs, warning });
      }
    }
    evidence = completeEvidence(evidence, false, 1);
    this.cache.set(cacheKey, evidence);
    this.emit({ type: "pipeline-completed", filePath: resolvedPath, cacheHit: false });
    return evidence;
  }

  private emit(event: EvidencePipelineEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function enrichEvidence(evidence: EvidenceStore, updates: Partial<EvidenceStore>): EvidenceStore {
  return freezeEvidence({ ...evidence, ...updates, file: updates.file ? { ...updates.file } : evidence.file, processingMetadata: updates.processingMetadata ?? evidence.processingMetadata });
}

class LocalEvidenceSnapshotReader implements EvidenceSnapshotReader {
  probe(filePath: string): Promise<Stats> {
    return stat(filePath);
  }

  async read(filePath: string, fileStat: Stats): Promise<EvidenceSnapshot> {
    if (!fileStat.isFile()) throw new Error("Analysis requires a regular file");
    const [bytes, linkStat] = await Promise.all([readFile(filePath), lstat(filePath)]);
    return { filePath, bytes, fileStat, linkStat };
  }
}

function createEvidenceStore(filePath: string, source: EvidenceCollectionContext["source"]): EvidenceStore {
  return freezeEvidence({ schemaVersion: "0.2", file: { path: filePath, name: basename(filePath), source }, warnings: [], processingMetadata: { startedAt: new Date().toISOString(), cacheHit: false, fileReadCount: 0, peParseCount: 0, collectors: [] } });
}

function recordCollector(evidence: EvidenceStore, collector: EvidenceCollectorExecution): EvidenceStore {
  return enrichEvidence(evidence, { processingMetadata: { ...evidence.processingMetadata, collectors: [...evidence.processingMetadata.collectors, collector] } });
}

function completeEvidence(evidence: EvidenceStore, cacheHit: boolean, fileReadCount: number): EvidenceStore {
  return enrichEvidence(evidence, { processingMetadata: { ...evidence.processingMetadata, completedAt: new Date().toISOString(), cacheHit, fileReadCount } });
}

function freezeEvidence(evidence: EvidenceStore): EvidenceStore {
  return deepFreeze({ ...evidence, file: { ...evidence.file }, warnings: [...evidence.warnings], processingMetadata: { ...evidence.processingMetadata, collectors: evidence.processingMetadata.collectors.map((collector) => ({ ...collector })) } });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}