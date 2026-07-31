import assert from "node:assert/strict";
import test from "node:test";
import { parsePe } from "../src/analyzer/peAnalyzer.js";
import { assessRisk } from "../src/scoring/riskEngine.js";

test("PE parser extracts imports and flags security-relevant APIs", () => {
  const fixture = createPeFixture();
  const analysis = parsePe(fixture);
  assert.equal(analysis.isPe, true);
  assert.equal(analysis.sections[0]?.name, ".text");
  assert.deepEqual(analysis.suspiciousImports, ["KERNEL32.dll!VirtualAlloc"]);
});

test("risk score represents investigation priority rather than a malware verdict", () => {
  const assessment = assessRisk({
    reputationScore: 100,
    signatureStatus: "invalid",
    suspiciousImportCount: 2,
    entropy: 7.8,
    packerDetected: true,
    heuristicFindings: [{ ruleId: "fixture", score: 30, evidence: "fixture evidence" }],
  });
  assert.equal(assessment.riskLevel, "high");
  assert.equal(assessment.decision, "investigate_urgent");
  assert.ok(assessment.score >= 61);
});

function createPeFixture(): Buffer {
  const file = Buffer.alloc(1024);
  file.write("MZ", 0);
  file.writeUInt32LE(0x80, 0x3c);
  file.write("PE\0\0", 0x80);
  file.writeUInt16LE(0x14c, 0x84);
  file.writeUInt16LE(1, 0x86);
  file.writeUInt32LE(1_700_000_000, 0x88);
  file.writeUInt16LE(0xe0, 0x94);
  file.writeUInt16LE(0x10b, 0x98);
  file.writeUInt32LE(0x1000, 0x98 + 96 + 8);
  const section = 0x178;
  file.write(".text", section);
  file.writeUInt32LE(0x200, section + 8);
  file.writeUInt32LE(0x1000, section + 12);
  file.writeUInt32LE(0x200, section + 16);
  file.writeUInt32LE(0x200, section + 20);
  file.writeUInt32LE(0x60000020, section + 36);
  file.writeUInt32LE(0x1080, 0x200);
  file.writeUInt32LE(0x1050, 0x20c);
  file.write("KERNEL32.dll\0", 0x250);
  file.writeUInt32LE(0x10a0, 0x280);
  file.writeUInt16LE(0, 0x2a0);
  file.write("VirtualAlloc\0", 0x2a2);
  return file;
}