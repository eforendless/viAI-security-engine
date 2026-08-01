import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectFileSystemEvidence } from "../src/analyzer/fileSystemEvidenceCollector.js";

test("filesystem evidence returns safe defaults for an ordinary local file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-filesystem-evidence-"));
  const filePath = join(directory, "fixture.bin");
  try {
    await writeFile(filePath, "static fixture");
    const evidence = await collectFileSystemEvidence(filePath);
    assert.equal(evidence.isSymbolicLink, false);
    assert.equal(evidence.isHiddenByName, false);
    if (process.platform !== "win32") assert.equal(evidence.zoneIdentifier, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});