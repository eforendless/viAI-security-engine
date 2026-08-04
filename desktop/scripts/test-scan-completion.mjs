import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
const { useSecurityStore } = await vite.ssrLoadModule("/src/store/securityStore.ts");
const completed = { id: "completed-scan", mode: "full", target: "All accessible PC files", startedAt: "2026-08-01T10:00:00.000Z", completedAt: "2026-08-01T10:18:42.000Z", elapsedMs: 1_122_000, currentFile: "Local analysis complete", filesCompleted: 842_531, filesRemaining: 0, totalFiles: 842_531, progress: 100, currentStage: "Complete", status: "completed", investigationCount: 3, pausedDurationMs: 0, forensicCount: 50, inventoryCount: 842_481, errorCount: 2, cacheSkipped: 20 };

useSecurityStore.getState().hydrateBackground({}, completed, [], [], 0, completed);
let state = useSecurityStore.getState();
assert.equal(state.scan.status, undefined);
assert.equal(state.scan.active, false);
assert.equal(state.scan.id, undefined);
assert.equal(state.scan.completed, 0);
assert.equal(state.scan.total, 0);
assert.equal(state.scan.elapsedMs, 0);
assert.equal(state.lastCompletedScan?.id, "completed-scan");
assert.equal(state.lastCompletedScan?.completed, 842_531);
assert.equal(state.lastCompletedScan?.elapsedMs, 1_122_000);

useSecurityStore.getState().hydrateBackground({}, { ...completed, status: "running", progress: 73, filesCompleted: 612_400, currentFile: "C:\\late.exe" });
state = useSecurityStore.getState();
assert.equal(state.scan.status, undefined);
assert.equal(state.scan.completed, 0);
assert.equal(state.scan.currentPath, "");
assert.equal(state.lastCompletedScan?.id, "completed-scan");

useSecurityStore.getState().hydrateBackground({}, undefined, [], [], 0, completed);
state = useSecurityStore.getState();
assert.equal(state.scan.status, undefined);
assert.equal(state.scan.completed, 0);
assert.equal(state.lastCompletedScan?.id, "completed-scan");

const replacement = { ...completed, id: "replacement-scan", startedAt: "2026-08-01T10:20:00.000Z", completedAt: undefined, elapsedMs: undefined, currentFile: "Preparing local analysis", filesCompleted: 0, filesRemaining: 0, totalFiles: 0, progress: 0, currentStage: "Discovering files", status: "running", investigationCount: 0 };
useSecurityStore.getState().hydrateBackground({}, replacement);
state = useSecurityStore.getState();
assert.equal(state.scan.id, "replacement-scan");
assert.notEqual(state.scan.id, state.lastCompletedScan?.id);
assert.equal(state.scan.status, "running");
assert.equal(state.scan.completed, 0);
assert.equal(state.lastCompletedScan?.status, "completed");
assert.equal(state.lastCompletedScan?.id, "completed-scan");
assert.equal(state.lastCompletedScan?.completed, 842_531);

await vite.close();
console.log("scan completion presentation tests passed");