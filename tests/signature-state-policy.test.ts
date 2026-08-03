import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { RuleEngine, RuleLoader, VrlRuleParser } from "../packages/core/src/rules/index.js";
import { StaticEvidenceTrustEvaluator } from "../src/core/staticEvidenceTrustEvaluator.js";

test("verification-unavailable signatures do not become unsigned-binary trust evidence", async () => {
  const evaluator = new StaticEvidenceTrustEvaluator();
  const indicators = await evaluator.evaluate({
    filePath: "C:\\Users\\A\\Downloads\\setup.exe",
    hash: "fixture",
    signature: { isSigned: false, certificateStatus: "unknown" },
    staticEvidence: { previouslySeenHash: false, isPe: true, parseWarnings: [], entropy: 5, packerDetected: false },
  });

  assert.equal(indicators.some((indicator) => indicator.id === "UNSIGNED_BINARY"), false);
});

test("only a confirmed unsigned download matches the unsigned-download rule", async () => {
  const engine = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
  await engine.load(join(process.cwd(), "rules"));
  const base = {
    file: { hash: "fixture", name: "setup.exe", extension: ".exe", type: "exe", size: 1024, isExecutable: true, entropy: 5, containsMacro: false },
    pe: { isPe: true, imports: [], suspiciousImports: [], suspiciousImportCount: 0, packerDetected: false },
    source: { kind: "download" as const, isDownload: true },
    reputation: { score: 0, knownStatus: "unknown" as const },
  };

  const unavailable = engine.evaluate({ ...base, signature: { isSigned: false, status: "unknown" } }, {});
  const unsigned = engine.evaluate({ ...base, signature: { isSigned: false, status: "missing" } }, {});

  assert.equal(unavailable.matchedRules.some((result) => result.id === "UnsignedDownloadExecutable"), false);
  assert.equal(unsigned.matchedRules.some((result) => result.id === "UnsignedDownloadExecutable"), true);
});