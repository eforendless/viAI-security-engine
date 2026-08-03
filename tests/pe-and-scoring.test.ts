import assert from "node:assert/strict";
import test from "node:test";
import { parsePe } from "../src/analyzer/peAnalyzer.js";
import { RiskAggregator } from "../packages/core/src/rules/index.js";

test("PE parser extracts imports and flags security-relevant APIs", () => {
  const fixture = createPeFixture();
  const analysis = parsePe(fixture);
  assert.equal(analysis.isPe, true);
  assert.equal(analysis.sections[0]?.name, ".text");
  assert.deepEqual(analysis.suspiciousImports, ["KERNEL32.dll!VirtualAlloc"]);
  assert.equal(analysis.entryPointRva, 0x1000);
  assert.equal(analysis.imageBase, "0x400000");
  assert.equal(analysis.subsystem, "Windows GUI");
  assert.deepEqual(analysis.dllCharacteristics, ["DYNAMIC_BASE", "NX_COMPAT"]);
  assert.equal(analysis.checksum, 0x12345678);
  assert.equal(analysis.sizeOfImage, 0x2000);
  assert.equal(analysis.overlaySize, 0);
  assert.equal(analysis.clrPresent, true);
});

test("risk aggregation produces investigation routing rather than a malware verdict", () => {
  const report = new RiskAggregator().aggregate("fixture", [{ id: "fixture", matched: true, score: 70, severity: "high", evidence: "fixture evidence", recommendation: "SANDBOX" }], {});
  assert.equal(report.riskScore, 70);
  assert.equal(report.recommendation, "DYNAMIC_ANALYSIS");
  assert.deepEqual(report.indicators, ["fixture evidence"]);
});

test("PE parser distinguishes non-PE input and records a partial section table", () => {
  const nonPe = parsePe(Buffer.from("plain text", "utf8"));
  assert.equal(nonPe.parseStatus, "not-pe");

  const truncated = createPeFixture().subarray(0, 0x180);
  const partial = parsePe(truncated);
  assert.equal(partial.isPe, true);
  assert.equal(partial.parseStatus, "partial");
  assert.ok(partial.parseWarnings.some((warning) => /section table/i.test(warning)));
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
  file.writeUInt32LE(0x1000, 0x98 + 16);
  file.writeUInt32LE(0x400000, 0x98 + 28);
  file.writeUInt32LE(0x2000, 0x98 + 56);
  file.writeUInt32LE(0x12345678, 0x98 + 64);
  file.writeUInt16LE(2, 0x98 + 68);
  file.writeUInt16LE(0x140, 0x98 + 70);
  file.writeUInt32LE(16, 0x98 + 92);
  file.writeUInt32LE(0x1000, 0x98 + 96 + 8);
  file.writeUInt32LE(0x40, 0x98 + 96 + 12);
  file.writeUInt32LE(0x1100, 0x98 + 96 + 14 * 8);
  file.writeUInt32LE(0x48, 0x98 + 96 + 14 * 8 + 4);
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