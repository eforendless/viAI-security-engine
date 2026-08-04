import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { matchesRealtimeSearch } = await vite.ssrLoadModule("/src/realtimeSearch.ts");
const group = { title: "Downloads and removable media", options: [["monitorDownloads", "Monitor Downloads", "Enables the local download candidate monitor."], ["monitorUsbInsertion", "Record USB arrival", "Records Windows Plug and Play device arrivals locally."]] };
const settings = Object.freeze({ monitorDownloads: true, backgroundProtection: true });

assert.equal(matchesRealtimeSearch(group, "downloads"), true);
assert.equal(matchesRealtimeSearch(group, "plug and play"), true);
assert.equal(matchesRealtimeSearch(group, "registry"), false);
assert.deepEqual(settings, { monitorDownloads: true, backgroundProtection: true });

await vite.close();
console.log("realtime search interaction tests passed");