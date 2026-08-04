import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ExecutableMonitor, isTemporaryDownload } from "../src/watcher/executableMonitor.js";

test("realtime file monitoring ignores partial downloads and publishes one stable final file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-realtime-monitor-"));
  const events: Array<{ path: string }> = [];
  const monitor = new ExecutableMonitor({ publish: (event: { path: string }) => events.push(event), emit: () => false } as never, "download");
  try {
    monitor.watchDirectories([directory], { extensions: [".exe"], reportCreated: true, reportModified: true });
    const partial = join(directory, "setup.exe.crdownload");
    const finalPath = join(directory, "setup.exe");
    await writeFile(partial, "partial");
    await rename(partial, finalPath);
    await waitFor(() => events.length === 1);
    await writeFile(finalPath, "complete");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_600));
    assert.equal(events.length, 2);
    assert.equal(events[0]?.path, finalPath);
  } finally {
    monitor.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("temporary download extensions are never realtime candidates", () => {
  assert.equal(isTemporaryDownload("C:\\Users\\viAI\\Downloads\\setup.exe.crdownload"), true);
  assert.equal(isTemporaryDownload("C:\\Users\\viAI\\Downloads\\setup.exe"), false);
});

async function waitFor(condition: () => boolean, timeoutMilliseconds = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMilliseconds) throw new Error("Timed out waiting for realtime monitor event");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}