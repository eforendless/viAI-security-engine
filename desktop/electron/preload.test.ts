import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("preload does not require local modules in the renderer sandbox", async () => {
  const preload = await readFile(join(__dirname, "preload.js"), "utf8");
  assert.doesNotMatch(preload, /require\(["']\.\//);
});