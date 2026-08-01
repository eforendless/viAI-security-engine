import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

test("local engine stops its HTTP listener and monitors on SIGTERM", async () => {
  const port = 43_000 + Math.floor(Math.random() * 1_000);
  const child = spawn(process.execPath, ["dist/src/index.js"], { cwd: process.cwd(), env: { ...process.env, VIAI_PORT: String(port), VIAI_DEVICE_SECURITY: "1" }, stdio: "ignore" });
  try {
    await waitForReady(port);
    child.kill("SIGTERM");
    const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    assert.ok(code === 0 || signal === "SIGTERM");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  } finally {
    if (!child.killed) child.kill();
  }
});

async function waitForReady(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return;
    } catch {
      // The child has not bound its local listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the local engine to start");
}