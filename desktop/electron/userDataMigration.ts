import { cp, mkdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LEGACY_USER_DATA_DIRECTORY = "desktop";

export interface UserDataMigrationOptions {
  readonly legacyUserDataPath: string;
  readonly userDataPath: string;
}

export type UserDataMigrationResult = "not-needed" | "already-migrated" | "migrated";

export function legacyUserDataPath(appDataPath: string): string {
  return join(appDataPath, LEGACY_USER_DATA_DIRECTORY);
}

export function migrationStagingPath(userDataPath: string): string {
  return `${userDataPath}.migration`;
}

export async function migrateLegacyUserData(options: UserDataMigrationOptions): Promise<UserDataMigrationResult> {
  const source = resolve(options.legacyUserDataPath);
  const destination = resolve(options.userDataPath);
  if (source === destination || !existsSync(source)) return "not-needed";
  if (existsSync(destination)) return "already-migrated";

  const staging = migrationStagingPath(destination);
  await mkdir(dirname(destination), { recursive: true });
  // An interrupted copy is never trusted; the untouched legacy source remains authoritative.
  await rm(staging, { recursive: true, force: true, maxRetries: 3 });
  const sourceDatabase = lockLegacyDatabase(source);
  try {
    await cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      // SQLite rebuilds this transient lock/index file from the copied database and WAL.
      filter: (sourcePath) => basename(sourcePath) !== "viai.db-shm",
    });
  } finally {
    if (sourceDatabase) {
      sourceDatabase.exec("ROLLBACK");
      sourceDatabase.close();
    }
  }
  validateStagedUserData(staging);
  await rename(staging, destination);
  return "migrated";
}

function lockLegacyDatabase(directory: string): DatabaseSync | undefined {
  const databasePath = join(directory, "viai.db");
  if (!existsSync(databasePath)) return undefined;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
    return database;
  } catch (error) {
    database.close();
    throw new Error("Close all older viAI processes before migrating local security data.", { cause: error });
  }
}

function validateStagedUserData(directory: string): void {
  const databasePath = join(directory, "viai.db");
  if (!existsSync(databasePath)) return;
  const database = new DatabaseSync(databasePath);
  try {
    const result = database.prepare("PRAGMA quick_check").get() as { quick_check?: unknown } | undefined;
    if (result?.quick_check !== "ok") throw new Error("Legacy SQLite data did not pass integrity validation.");
  } finally {
    database.close();
  }
}