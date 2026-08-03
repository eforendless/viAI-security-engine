import assert from "node:assert/strict";
import test from "node:test";
import { StartupManager, type StartupProgress } from "./startup";

test("startup pipeline reports weighted progress only after real tasks complete", async () => {
  const manager = new StartupManager();
  const events: StartupProgress[] = [];
  manager.progress.subscribe((event) => events.push(event));
  const work: string[] = [];
  manager.register([
    { id: "settings", name: "Loading settings", weight: 1, execute: async () => { work.push("settings"); } },
    { id: "engine", name: "Starting engine", weight: 3, dependencies: ["settings"], execute: async () => { work.push("engine"); } },
  ]);
  await manager.start();
  assert.deepEqual(work, ["settings", "engine"]);
  assert.deepEqual(events.filter((event) => event.type === "completed").map((event) => event.progress), [25, 100]);
  assert.doesNotThrow(() => events.forEach((event) => structuredClone(event)));
  assert.equal(events.at(-1)?.type, "ready");
});

test("startup retry resumes after a failed task without rerunning completed dependencies", async () => {
  const manager = new StartupManager();
  let attempts = 0;
  let settingsRuns = 0;
  manager.register([
    { id: "settings", name: "Loading settings", weight: 1, execute: async () => { settingsRuns += 1; } },
    { id: "engine", name: "Starting engine", weight: 1, dependencies: ["settings"], execute: async () => { attempts += 1; if (attempts === 1) throw new Error("Engine unavailable"); } },
  ]);
  await assert.rejects(manager.start(), /Engine unavailable/);
  await manager.retry();
  assert.equal(settingsRuns, 1);
  assert.equal(attempts, 2);
});