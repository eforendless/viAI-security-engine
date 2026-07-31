import assert from "node:assert/strict";
import test from "node:test";
import { RuleCompiler, VrlRuleParser, type RuleContext } from "../packages/core/src/rules/index.js";

const source = `rule PackedUnsignedExecutable
when
file.isExecutable
and
!signature.isSigned
and
file.entropy > 7.2
and
pe.imports contains "VirtualAlloc"
score
30
severity
medium
recommendation
SANDBOX
evidence
"Unsigned executable packed with suspicious imports."`;

const context: RuleContext = { file: { hash: "a", name: "sample.exe", extension: ".exe", type: "exe", size: 1, isExecutable: true, entropy: 7.5, containsMacro: false }, signature: { isSigned: false, status: "missing" }, pe: { isPe: true, imports: ["VirtualAlloc"], suspiciousImports: [], suspiciousImportCount: 0, packerDetected: false }, source: { kind: "download", isDownload: true }, reputation: { score: 0, knownStatus: "unknown" } };

test("VRL parses and compiles into a scan-time predicate", () => {
  const parsed = new VrlRuleParser().parse(source, { path: "static/packed.vrl" });
  assert.deepEqual(parsed.diagnostics, []);
  const rule = new RuleCompiler().compile(parsed.rules[0]!);
  assert.deepEqual(rule.evaluate(context), { id: "PackedUnsignedExecutable", matched: true, score: 30, severity: "medium", evidence: "Unsigned executable packed with suspicious imports.", recommendation: "SANDBOX" });
  assert.equal(rule.evaluate({ ...context, signature: { isSigned: true, status: "trusted" } }).matched, false);
});

test("VRL compiler rejects unknown features before scanning", () => {
  const parsed = new VrlRuleParser().parse(source.replace("file.isExecutable", "file.unknown"), { path: "invalid.vrl" });
  assert.throws(() => new RuleCompiler().compile(parsed.rules[0]!), /Unknown feature/);
});

test("optional feature values cause contains predicates to miss without throwing", () => {
  const parsed = new VrlRuleParser().parse(`rule TrustedPublisher
when
signature.publisher contains "Microsoft"
score
-10
evidence
"Valid publisher."`, { path: "optional.vrl" });
  const rule = new RuleCompiler().compile(parsed.rules[0]!);
  assert.equal(rule.evaluate({ ...context, signature: { isSigned: true, status: "trusted" } }).matched, false);
});