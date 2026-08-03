import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AnalysisPipeline } from "../src/core/pipeline.js";
import { HtmlReportGenerator } from "../src/report/htmlReportGenerator.js";
import { TrustAssessmentEngine, TrustRegistry, type TrustEvaluator } from "../packages/core/src/trust/index.js";
import { LocalReputationDatabase } from "../src/reputation/localDatabase.js";
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
    const testTrustEvaluator: TrustEvaluator = {
      id: "pipeline-test-trust",
      evaluate: async () => [{ id: "PIPELINE_TRUST", weight: 30, evidence: "Pipeline trust evaluator ran.", source: "test" }],
    };
    const pipeline = new AnalysisPipeline({
      rulesDirectory: join(process.cwd(), "rules"),
      reputationDatabasePath: databasePath,
      trustAssessmentEngine: new TrustAssessmentEngine(new TrustRegistry([testTrustEvaluator])),
    });
    const result = await pipeline.analyze(inputPath, "download");
    assert.equal(result.metadata.isExecutableCandidate, true);
    assert.equal(result.fileSystemEvidence.isSymbolicLink, false);
    assert.equal(result.peMetadata.isPe, false);
    assert.equal(result.hashes.sha256.length, 64);
    assert.ok(!result.staticAnalysisReport.matchedRules.some((rule) => rule.id === "UnsignedDownloadExecutable"));
    assert.equal(result.staticAnalysisReport.fileHash, result.hashes.sha256);
    assert.equal(result.trustScore, 30);
    assert.equal(result.digitalSignature.status, process.platform === "win32" ? "UnknownError" : "Unavailable");
    assert.equal(result.staticAnalysisReport.trustIndicators[0]?.id, "PIPELINE_TRUST");
    assert.equal(result.report.schemaVersion, "0.3");
    assert.equal(result.report.analysisMetadata?.assessmentSchemaVersion, "0.3");
    assert.equal(result.report.trust.score, 30);
    assert.equal(result.report.fileSystem.isHiddenByName, false);
    assert.equal(result.evidenceStore?.processingMetadata.fileReadCount, 1);
    assert.equal(result.evidenceStore?.processingMetadata.peParseCount, 1);
    assert.deepEqual(result.evidenceStore?.processingMetadata.collectors.map((collector) => collector.status), ["completed", "completed", "completed", "completed", "completed", "completed", "completed"]);
    assert.match(result.report.summary, /static analysis does not determine intent/i);
    const html = new HtmlReportGenerator().generate(result);
    assert.match(html, /viAI SECURITY/);
    assert.match(html, /<details open>/);
    assert.match(html, /Static analysis report/);
    assert.match(html, /Filesystem evidence/);
    assert.match(html, /Entry point/);
    assert.match(html, /Investigation priority/);
    assert.match(html, /Analysis versions/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pipeline evaluates and records baseline state independently from reputation history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-baseline-pipeline-"));
  const inputPath = join(directory, "sample.bin");
  const reputationDatabasePath = join(directory, "reputation.json");
  const baselineDatabasePath = join(directory, "baseline.json");
  const observedStates: Array<string | undefined> = [];
  try {
    await writeFile(inputPath, "bounded static baseline fixture");
    const pipeline = new AnalysisPipeline({
      rulesDirectory: join(process.cwd(), "rules"),
      reputationDatabasePath,
      baselineDatabasePath,
      trustAssessmentEngine: new TrustAssessmentEngine(new TrustRegistry([{
        id: "baseline-observer",
        evaluate: async (context) => {
          observedStates.push(context.baseline?.state);
          return [];
        },
      }])),
    });
    const first = await pipeline.analyze(inputPath);
    const second = await pipeline.analyze(inputPath);
    assert.equal(first.baseline?.state, "new");
    assert.equal(second.baseline?.state, "unchanged");
    assert.equal(second.report.schemaVersion, "0.3");
    assert.equal(second.report.assessment?.schemaVersion, "0.3");
    assert.equal(second.report.baseline?.state, "unchanged");
    assert.match(new HtmlReportGenerator().generate(second), /Evidence confidence/);
    assert.deepEqual(observedStates, ["new", "unchanged"]);
    assert.ok((await readFile(baselineDatabasePath, "utf8")).includes("sample.bin"));
    assert.ok((await readFile(reputationDatabasePath, "utf8")).includes(first.hashes.sha256));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reputation database retains all parallel updates as valid JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-reputation-"));
  const databasePath = join(directory, "reputation.json");
  const database = new LocalReputationDatabase(databasePath);
  try {
    await Promise.all(Array.from({ length: 32 }, (_, index) => database.recordSeen(`hash-${index}`, `file-${index}.exe`)));
    const records = JSON.parse(await readFile(databasePath, "utf8")) as Array<{ hash: string }>;
    assert.equal(records.length, 32);
    assert.deepEqual(new Set(records.map((record) => record.hash)), new Set(Array.from({ length: 32 }, (_, index) => `hash-${index}`)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reputation database recovers from malformed stored JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-reputation-"));
  const databasePath = join(directory, "reputation.json");
  const database = new LocalReputationDatabase(databasePath);
  try {
    await writeFile(databasePath, "[] trailing-data", "utf8");
    assert.deepEqual(await database.lookup("missing-hash"), { score: 0, evidence: [] });
    await database.recordSeen("recovered-hash", "recovered.exe");
    const records = JSON.parse(await readFile(databasePath, "utf8")) as Array<{ hash: string }>;
    assert.deepEqual(records.map((record) => record.hash), ["recovered-hash"]);
    assert.ok((await readdir(directory)).some((name) => name.startsWith("reputation.json.corrupt-")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reputation database clear removes local scan cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-reputation-"));
  const databasePath = join(directory, "reputation.json");
  const database = new LocalReputationDatabase(databasePath);
  try {
    await database.recordSeen("cached-hash", "cached.exe");
    await database.clear();
    await assert.rejects(readFile(databasePath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});