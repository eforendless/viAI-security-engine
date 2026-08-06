import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalBaselineStore } from "../src/baseline/localBaselineStore.js";

const trustedSystemFile = {
  filePath: "C:\\Windows\\System32\\sample.sys",
  hash: "a".repeat(64),
  size: 4096,
  fileType: "Windows Portable Executable",
  signatureState: "signed-trusted" as const,
  signer: "CN=Microsoft Windows",
  pe: { machine: "x64", subsystem: "Native", parseStatus: "valid" as const },
};

test("baseline stores historical file identity without treating previous observation as trust", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-baseline-"));
  const store = new LocalBaselineStore(join(directory, "baseline.db"));
  try {
    assert.equal((await store.evaluate(trustedSystemFile)).state, "new");
    await store.record(trustedSystemFile);
    assert.equal((await store.evaluate(trustedSystemFile)).state, "unchanged");
    assert.equal((await store.evaluate({ ...trustedSystemFile, hash: "b".repeat(64) })).state, "changed");
    assert.equal((await store.evaluate({ ...trustedSystemFile, signer: "CN=Unexpected Publisher" })).state, "signer-changed");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});