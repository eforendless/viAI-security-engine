import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RuleEngine, RuleLoader, VrlRuleParser, type RuleContext } from "../packages/core/src/rules/index.js";

const context: RuleContext = { file: { hash: "hash", name: "sample.exe", extension: ".exe", type: "exe", size: 1, isExecutable: true, entropy: 8, containsMacro: false }, signature: { isSigned: false, status: "missing" }, pe: { isPe: true, imports: ["VirtualAlloc"], suspiciousImports: [], suspiciousImportCount: 0, packerDetected: false }, source: { kind: "download", isDownload: true }, reputation: { score: 0, knownStatus: "unknown" } };
const rule = `rule DownloadExecutable
when
file.isExecutable and source.isDownload
score
30
severity
medium
recommendation
SANDBOX
evidence
"Unsigned executable from downloads."`;

test("rule engine recursively loads compiled VRL and aggregates evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-vrl-"));
  try {
    await mkdir(join(directory, "static"));
    await writeFile(join(directory, "static", "download.vrl"), rule);
    const engine = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
    await engine.load(directory);
    const report = engine.evaluate(context, { path: "sample.exe" });
    assert.equal(engine.ruleCount(), 1);
    assert.equal(report.riskScore, 30);
    assert.equal(report.recommendation, "DYNAMIC_ANALYSIS");
    assert.deepEqual(report.indicators, ["Unsigned executable from downloads."]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});