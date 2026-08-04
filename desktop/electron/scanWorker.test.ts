import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";

test("scan worker signals completion after delivering discovered candidates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-scan-worker-"));
  const candidates: string[] = [];
  let worker: Worker | undefined;
  try {
    const candidate = join(directory, "sample.exe");
    await writeFile(candidate, "static test fixture");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("scan worker did not signal completion")), 5_000);
      worker = new Worker(join(__dirname, "scanWorker.js"), { workerData: { root: directory, includeAllFiles: false } });
      worker.once("error", (error) => { clearTimeout(timeout); reject(error); });
      worker.on("message", (message: unknown) => {
        if (typeof message === "string") candidates.push(message);
        if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete") {
          clearTimeout(timeout);
          void worker?.terminate();
          resolve();
        }
      });
    });
    assert.deepEqual(candidates, [candidate]);
  } finally {
    await worker?.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});
