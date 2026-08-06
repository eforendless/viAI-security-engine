import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importLegacyJson } from "./legacyJsonImporter";
import { DesktopPersistence } from "./repositories";

test("legacy JSON imports once, archives user data, and leaves engine seed files intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-legacy-import-"));
  const engineDirectory = join(directory, "engine");
  const persistence = new DesktopPersistence(join(directory, "viai.db"));
  try {
    await mkdir(engineDirectory);
    await writeFile(join(directory, "background-settings.json"), JSON.stringify({ settings: { monitorDownloads: false } }), "utf8");
    await writeFile(join(directory, "scan-cache.json"), JSON.stringify({ "C:\\sample.exe": { size: 4, mtimeMs: 12, analyzedAt: "2026-01-01T00:00:00.000Z", priorityScore: 2 } }), "utf8");
    await writeFile(join(directory, "device-id.txt"), "device-legacy-id\n", "utf8");
    await writeFile(join(engineDirectory, "reputation.json"), JSON.stringify([{ hash: "a".repeat(64), fileName: "sample.exe", knownStatus: "suspicious", riskLevel: "high", lastSeen: "2026-01-01T00:00:00.000Z" }]), "utf8");
    await writeFile(join(engineDirectory, "baseline.json"), JSON.stringify({ records: [{ filePath: "C:\\sample.exe", hash: "b".repeat(64), size: 4, fileType: ".exe", signatureState: "unsigned", firstSeen: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-01T00:00:00.000Z" }] }), "utf8");

    const first = await importLegacyJson(persistence, { userDataPath: directory, engineDataPath: engineDirectory });
    assert.equal(first.importedSources, 5);
    assert.equal(persistence.loadSettings()?.monitorDownloads, false);
    assert.equal(persistence.cacheEntry("C:\\sample.exe")?.size, 4);
    assert.equal(persistence.getOrCreateSystemDeviceId(), "device-legacy-id");
    assert.equal((persistence.database.connection.prepare("SELECT COUNT(*) AS total FROM reputation").get() as { total: number }).total, 1);
    assert.equal((persistence.database.connection.prepare("SELECT COUNT(*) AS total FROM baselines").get() as { total: number }).total, 1);
    assert.equal(existsSync(join(directory, "background-settings.json")), false);
    assert.equal(existsSync(join(directory, "scan-cache.json")), false);
    assert.equal(existsSync(join(directory, "device-id.txt")), false);
    assert.equal(existsSync(join(engineDirectory, "reputation.json")), true);
    assert.equal(existsSync(join(engineDirectory, "baseline.json")), true);

    const second = await importLegacyJson(persistence, { userDataPath: directory, engineDataPath: engineDirectory });
    assert.equal(second.importedSources, 0);
    assert.equal((persistence.database.connection.prepare("SELECT COUNT(*) AS total FROM reputation").get() as { total: number }).total, 1);
    assert.equal((persistence.database.connection.prepare("SELECT COUNT(*) AS total FROM baselines").get() as { total: number }).total, 1);
  } finally {
    persistence.database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed legacy JSON is diagnosed while valid sources still migrate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "viai-legacy-malformed-"));
  const persistence = new DesktopPersistence(join(directory, "viai.db"));
  try {
    await writeFile(join(directory, "background-settings.json"), JSON.stringify({ settings: { monitorDownloads: false } }), "utf8");
    await writeFile(join(directory, "scan-cache.json"), "{", "utf8");
    const result = await importLegacyJson(persistence, { userDataPath: directory });
    assert.equal(persistence.loadSettings()?.monitorDownloads, false);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]!, /scan-cache.*malformed JSON/);
    assert.equal(existsSync(join(directory, "background-settings.json")), false);
    assert.equal(existsSync(join(directory, "scan-cache.json")), true);
  } finally {
    persistence.database.close();
    await rm(directory, { recursive: true, force: true });
  }
});