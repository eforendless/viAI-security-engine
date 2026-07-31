import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calculateShannonEntropy } from "../src/analyzer/entropyAnalyzer.js";
import { analyzeHashes } from "../src/analyzer/hashAnalyzer.js";

test("entropy is zero for a single repeated byte", () => {
  assert.equal(calculateShannonEntropy(Buffer.alloc(1024, 0x41)), 0);
});

test("hash analyzer returns standard digests without moving a file off-device", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-hash-"));
  const filePath = join(directory, "fixture.bin");
  try {
    await writeFile(filePath, "abc");
    const hashes = await analyzeHashes(filePath);
    assert.equal(hashes.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(hashes.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
    assert.equal(hashes.md5, "900150983cd24fb0d6963f7d28e17f72");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});