import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { RuleEngine, RuleLoader, VrlRuleParser } from "../packages/core/src/rules/index.js";
import { calculateShannonEntropy } from "../src/analyzer/entropyAnalyzer.js";
import { StaticEvidenceTrustEvaluator } from "../src/core/staticEvidenceTrustEvaluator.js";

test("Shannon entropy distinguishes repetitive, text-like, and random buffers", () => {
  const zeros = calculateShannonEntropy(Buffer.alloc(16 * 1024));
  const repeated = calculateShannonEntropy(Buffer.from("AB".repeat(8 * 1024), "ascii"));
  const text = calculateShannonEntropy(Buffer.from("Static evidence should preserve context instead of treating uncertainty as intent. ".repeat(512), "utf8"));
  const random = calculateShannonEntropy(randomBytes(16 * 1024));

  assert.equal(zeros, 0);
  assert.ok(repeated > 0.9 && repeated < 1.1);
  assert.ok(text > repeated && text < 6.5);
  assert.ok(random > 7.8 && random <= 8);
});

test("complex installer characteristics do not force sandbox escalation without a capability chain", async () => {
  const engine = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
  await engine.load(join(process.cwd(), "rules"));
  const report = engine.evaluate({
    file: { hash: "complex-installer", name: "installer.exe", extension: ".exe", type: "exe", size: 500_000_000, isExecutable: true, entropy: 7.8, containsMacro: false },
    signature: { isSigned: false, status: "unknown" },
    pe: {
      isPe: true,
      imports: ["KERNEL32.dll!VirtualAlloc", "SHELL32.dll!ShellExecuteW", "ADVAPI32.dll!RegSetValueW", "KERNEL32.dll!CreateProcessW", "WINHTTP.dll!WinHttpOpen"],
      suspiciousImports: ["KERNEL32.dll!VirtualAlloc", "SHELL32.dll!ShellExecuteW", "ADVAPI32.dll!RegSetValueW"],
      suspiciousImportCount: 3,
      processInjectionCapabilityChain: false,
      packerDetected: true,
    },
    source: { kind: "download", isDownload: true },
    reputation: { score: 0, knownStatus: "unknown" },
  }, {});

  assert.ok(report.riskScore <= 25, `expected weak static context to remain low, received ${report.riskScore}`);
  assert.notEqual(report.recommendation, "SANDBOX");
  assert.notEqual(report.recommendation, "AI_ANALYSIS");
});

test("a process-injection capability chain is routed for dynamic analysis without claiming observed behavior", async () => {
  const engine = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
  await engine.load(join(process.cwd(), "rules"));
  const report = engine.evaluate({
    file: { hash: "injection-chain", name: "sample.exe", extension: ".exe", type: "exe", size: 1024, isExecutable: true, entropy: 5, containsMacro: false },
    signature: { isSigned: false, status: "unknown" },
    pe: { isPe: true, imports: [], suspiciousImports: [], suspiciousImportCount: 0, processInjectionCapabilityChain: true, packerDetected: false },
    source: { kind: "filesystem", isDownload: false },
    reputation: { score: 0, knownStatus: "unknown" },
  }, {});

  const finding = report.matchedRules.find((result) => result.id === "ProcessInjectionCapabilityChain");
  assert.equal(finding?.recommendation, "DYNAMIC_ANALYSIS");
  assert.match(finding?.evidence ?? "", /capability chain/i);
});

test("parser uncertainty and static visibility limits do not reduce trust", async () => {
  const indicators = await new StaticEvidenceTrustEvaluator().evaluate({
    filePath: "C:\\Users\\A\\Downloads\\installer.exe",
    hash: "visibility-context",
    signature: { isSigned: false, certificateStatus: "unknown" },
    staticEvidence: { previouslySeenHash: false, isPe: true, parseWarnings: ["Section table is truncated."], entropy: 7.9, packerDetected: true },
  });

  assert.equal(indicators.some((indicator) => indicator.weight < 0), false);
});