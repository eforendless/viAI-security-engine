import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RulesEngine } from "../src/heuristics/rulesEngine.js";
import { AnalysisPipeline } from "../src/core/pipeline.js";

test("JSON rules identify unsigned executable candidates from downloads", async () => {
  const rules = await RulesEngine.fromDirectory(join(process.cwd(), "rules"));
  const findings = rules.evaluate({
    signatureStatus: "missing",
    isDownload: true,
    isExecutableCandidate: true,
    entropy: 1,
    packerDetected: false,
    suspiciousImportCount: 0,
  });
  assert.ok(findings.some((finding) => finding.ruleId === "unsigned-download-executable"));
});

test("pipeline records local evidence and never executes its input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-pipeline-"));
  const inputPath = join(directory, "Downloads", "sample.exe");
  const databasePath = join(directory, "reputation.json");
  try {
    await writeFile(inputPath, "this is a harmless static-analysis fixture");
  } catch {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(directory, "Downloads"));
    await writeFile(inputPath, "this is a harmless static-analysis fixture");
  }
  try {
    const pipeline = new AnalysisPipeline({ rulesDirectory: join(process.cwd(), "rules"), reputationDatabasePath: databasePath });
    const result = await pipeline.analyze(inputPath, "download");
    assert.equal(result.metadata.isExecutableCandidate, true);
    assert.equal(result.peMetadata.isPe, false);
    assert.equal(result.hashes.sha256.length, 64);
    assert.ok(result.evidence.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});