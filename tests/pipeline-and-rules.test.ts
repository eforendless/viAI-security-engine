import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalysisPipeline } from "../src/core/pipeline.js";
import { RuleEngine, RuleLoader, VrlRuleParser } from "../packages/core/src/rules/index.js";

test("compiled VRL rules identify unsigned executable candidates from downloads", async () => {
  const rules = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
  await rules.load(join(process.cwd(), "rules"));
  const report = rules.evaluate({ file: { hash: "fixture", name: "sample.exe", extension: ".exe", type: "exe", size: 1, isExecutable: true, entropy: 1, containsMacro: false }, signature: { isSigned: false, status: "missing" }, pe: { isPe: false, imports: [], suspiciousImports: [], suspiciousImportCount: 0, packerDetected: false }, source: { kind: "download", isDownload: true }, reputation: { score: 0, knownStatus: "unknown" } }, {});
  assert.ok(report.matchedRules.some((finding) => finding.id === "UnsignedDownloadExecutable"));
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
    assert.equal(result.staticAnalysisReport.fileHash, result.hashes.sha256);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});