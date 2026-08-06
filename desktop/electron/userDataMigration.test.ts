import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { legacyUserDataPath, migrateLegacyUserData, migrationStagingPath } from "./userDataMigration";

function createLegacyDatabase(directory: string): void {
  const database = new DatabaseSync(join(directory, "viai.db"));
  try {
    database.exec("PRAGMA journal_mode = WAL; CREATE TABLE history (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO history VALUES ('assessment-1', 'retained');");
  } finally {
    database.close();
  }
}

test("moves old desktop user data to the named viAI location without losing SQLite data", async () => {
  const root = await mkdtemp(join(tmpdir(), "viai-user-data-migration-"));
  const oldData = legacyUserDataPath(root);
  const newData = join(root, "viAI Security");
  try {
    await mkdir(join(oldData, "logs"), { recursive: true });
    await writeFile(join(oldData, "logs", "main.log"), "retained", "utf8");
    createLegacyDatabase(oldData);

    assert.equal(await migrateLegacyUserData({ legacyUserDataPath: oldData, userDataPath: newData }), "migrated");
    assert.equal(existsSync(join(oldData, "viai.db")), true);
    assert.equal(existsSync(join(newData, "logs", "main.log")), true);

    const database = new DatabaseSync(join(newData, "viai.db"));
    try {
      assert.equal((database.prepare("SELECT value FROM history WHERE id = ?").get("assessment-1") as { value: string }).value, "retained");
    } finally {
      database.close();
    }
    assert.equal(await migrateLegacyUserData({ legacyUserDataPath: oldData, userDataPath: newData }), "already-migrated");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("replaces an interrupted staging copy from the intact legacy directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "viai-user-data-retry-"));
  const oldData = legacyUserDataPath(root);
  const newData = join(root, "viAI Security");
  try {
    await mkdir(oldData, { recursive: true });
    createLegacyDatabase(oldData);
    await mkdir(migrationStagingPath(newData), { recursive: true });
    await writeFile(join(migrationStagingPath(newData), "partial-copy"), "incomplete", "utf8");

    assert.equal(await migrateLegacyUserData({ legacyUserDataPath: oldData, userDataPath: newData }), "migrated");
    assert.equal(existsSync(join(newData, "viai.db")), true);
    assert.equal(existsSync(migrationStagingPath(newData)), false);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});