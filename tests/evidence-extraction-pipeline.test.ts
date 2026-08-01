import assert from "node:assert/strict";
import test from "node:test";
import { EvidenceExtractionPipeline, enrichEvidence, type EvidenceCollector, type EvidenceSnapshotReader } from "../src/evidence/evidenceExtractionPipeline.js";

test("evidence extraction reads one snapshot, runs collectors in order, and emits lifecycle events", async () => {
  let readCount = 0;
  const collectorOrder: string[] = [];
  const snapshotReader: EvidenceSnapshotReader = {
    probe: async () => ({ size: 3, mtimeMs: 1 } as Awaited<ReturnType<EvidenceSnapshotReader["probe"]>>),
    read: async (filePath) => {
      readCount += 1;
      return { filePath, bytes: Buffer.from("abc"), fileStat: {} as never, linkStat: {} as never };
    },
  };
  const collectors: EvidenceCollector[] = [
    { id: "hash", collect: async (_context, evidence) => { collectorOrder.push("hash"); return enrichEvidence(evidence, { entropy: 1 }); } },
    { id: "pe", collect: async (_context, evidence) => { collectorOrder.push("pe"); return enrichEvidence(evidence, { processingMetadata: { ...evidence.processingMetadata, peParseCount: evidence.processingMetadata.peParseCount + 1 } }); } },
  ];
  const pipeline = new EvidenceExtractionPipeline({ collectors, snapshotReader });
  const events: string[] = [];
  pipeline.onEvent((event) => events.push(event.type));
  const evidence = await pipeline.extract("C:\\fixtures\\sample.exe", "download");
  const cached = await pipeline.extract("C:\\fixtures\\sample.exe", "download");

  assert.equal(readCount, 1);
  assert.deepEqual(collectorOrder, ["hash", "pe"]);
  assert.deepEqual(events, ["collector-started", "collector-finished", "collector-started", "collector-finished", "pipeline-completed", "pipeline-completed"]);
  assert.equal(evidence.processingMetadata.fileReadCount, 1);
  assert.equal(evidence.processingMetadata.peParseCount, 1);
  assert.equal(cached.processingMetadata.cacheHit, true);
  assert.equal(cached.processingMetadata.fileReadCount, 0);
  assert.equal(Object.isFrozen(evidence), true);
  assert.throws(() => (evidence.warnings as string[]).push("mutate"));
});

test("evidence extraction records collector failures and continues with later collectors", async () => {
  const snapshotReader: EvidenceSnapshotReader = {
    probe: async () => ({ size: 0, mtimeMs: 1 } as Awaited<ReturnType<EvidenceSnapshotReader["probe"]>>),
    read: async (filePath) => ({ filePath, bytes: Buffer.alloc(0), fileStat: {} as never, linkStat: {} as never }),
  };
  const collectors: EvidenceCollector[] = [
    { id: "failing", collect: async () => { throw new Error("fixture failure"); } },
    { id: "later", collect: async (_context, evidence) => enrichEvidence(evidence, { entropy: 0 }) },
  ];
  const pipeline = new EvidenceExtractionPipeline({ collectors, snapshotReader });
  const events: string[] = [];
  pipeline.onEvent((event) => events.push(event.type));
  const evidence = await pipeline.extract("C:\\fixtures\\failure.bin");

  assert.deepEqual(evidence.processingMetadata.collectors.map((collector) => collector.status), ["failed", "completed"]);
  assert.match(evidence.warnings[0] ?? "", /fixture failure/);
  assert.deepEqual(events, ["collector-started", "collector-failed", "collector-started", "collector-finished", "pipeline-completed"]);
});