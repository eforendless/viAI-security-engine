import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BackgroundHistoryRecord, BackgroundSettings, PersistedScanState } from "../backgroundService";
import type { ScanCacheEntry } from "../fileClassification";
import type { DeviceHistoryRecord, DeviceRecord } from "../deviceSecurity";
import type { LegacyBaselineRecord, LegacyReputationRecord } from "./repositories";
import { DesktopPersistence } from "./repositories";

interface LegacySource {
  readonly id: string;
  readonly path: string;
  readonly archive: boolean;
  readonly content: unknown;
  readonly malformed?: string;
}

export interface LegacyImportOptions {
  readonly userDataPath: string;
  readonly engineDataPath?: string;
}

export interface LegacyImportResult {
  readonly importedSources: number;
  readonly importedRecords: number;
  readonly diagnostics: readonly string[];
}

/** Legacy migration only. Production reads and writes use SQLite repositories. */
export async function importLegacyJson(persistence: DesktopPersistence, options: LegacyImportOptions): Promise<LegacyImportResult> {
  const userSources = await Promise.all([
    jsonSource("background-settings", join(options.userDataPath, "background-settings.json"), true),
    jsonSource("background-history", join(options.userDataPath, "background-history.json"), true),
    jsonSource("scan-cache", join(options.userDataPath, "scan-cache.json"), true),
    jsonSource("device-security", join(options.userDataPath, "device-security.json"), true),
    textSource("device-id", join(options.userDataPath, "device-id.txt"), true),
  ]);
  const engineSources = options.engineDataPath ? await Promise.all([
    jsonSource("engine-reputation", join(options.engineDataPath, "reputation.json"), false),
    jsonSource("engine-baseline", join(options.engineDataPath, "baseline.json"), false),
  ]) : [];
  const sources = [...userSources, ...engineSources].filter((source): source is LegacySource => Boolean(source));
  const pending = sources.filter((source) => !persistence.hasLegacyImport(source.id));
  const diagnostics: string[] = [];
  let importedRecords = 0;

  if (pending.length) {
    persistence.database.transaction(() => {
      for (const source of pending) {
        if (source.malformed) {
          const detail = `Legacy ${source.id} was not imported: ${source.malformed}`;
          persistence.recordDiagnostic("legacy-json", detail);
          persistence.recordLegacyImport(source.id, source.path, 0, source.malformed);
          diagnostics.push(detail);
          continue;
        }
        const count = importSource(persistence, source);
        importedRecords += count;
        persistence.recordLegacyImport(source.id, source.path, count);
      }
    });
  }

  const archiveDirectory = join(options.userDataPath, "legacy-json-backup", new Date().toISOString().replaceAll(":", "-"));
  for (const source of sources) {
    if (!source.archive || source.malformed || !persistence.hasLegacyImport(source.id)) continue;
    try {
      await archiveSource(source, archiveDirectory);
    } catch (error) {
      const detail = `Legacy ${source.id} was imported but could not be archived: ${error instanceof Error ? error.message : String(error)}`;
      persistence.recordDiagnostic("legacy-json", detail);
      diagnostics.push(detail);
    }
  }
  return { importedSources: pending.length, importedRecords, diagnostics };
}

function importSource(persistence: DesktopPersistence, source: LegacySource): number {
  switch (source.id) {
    case "background-settings": {
      const stored = object(source.content);
      const settings = object(stored.settings) as BackgroundSettings;
      if (Object.keys(settings).length) persistence.saveSettings(settings);
      const activeScan = scan(stored.activeScan);
      const lastCompletedScan = scan(stored.lastCompletedScan);
      if (activeScan) persistence.saveScan(activeScan);
      if (lastCompletedScan) persistence.saveScan(lastCompletedScan);
      const legacyHistory = history(stored.history);
      legacyHistory.forEach((record) => persistence.putAssessment(record));
      return Number(Boolean(Object.keys(settings).length)) + Number(Boolean(activeScan)) + Number(Boolean(lastCompletedScan)) + legacyHistory.length;
    }
    case "background-history": {
      const records = history(source.content);
      records.forEach((record) => persistence.putAssessment(record));
      return records.length;
    }
    case "scan-cache": {
      const records = object(source.content);
      let count = 0;
      for (const [filePath, value] of Object.entries(records)) {
        const entry = scanCacheEntry(value);
        if (!entry) continue;
        persistence.putCacheEntry(filePath, entry);
        count += 1;
      }
      return count;
    }
    case "device-security": {
      const stored = object(source.content);
      const devices = deviceRecords(stored.devices);
      const deviceIds = new Set(devices.map((device) => device.id));
      const events = deviceEvents(stored.history).filter((event) => deviceIds.has(event.deviceId));
      persistence.importDevicesAndEvents(devices, events);
      return devices.length + events.length;
    }
    case "device-id": {
      const id = typeof source.content === "string" ? source.content.trim() : "";
      if (!id) return 0;
      persistence.setSystemDeviceId(id);
      return 1;
    }
    case "engine-reputation": {
      const records = Array.isArray(source.content) ? source.content as LegacyReputationRecord[] : [];
      persistence.importReputation(records);
      return records.filter((record) => validReputation(record)).length;
    }
    case "engine-baseline": {
      const records = Array.isArray(object(source.content).records) ? object(source.content).records as LegacyBaselineRecord[] : [];
      persistence.importBaselines(records);
      return records.filter((record) => validBaseline(record)).length;
    }
    default:
      return 0;
  }
}

async function jsonSource(id: string, path: string, archive: boolean): Promise<LegacySource | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return { id, path, archive, content: JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    return { id, path, archive, content: undefined, malformed: error instanceof SyntaxError ? "malformed JSON" : `could not read source: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function textSource(id: string, path: string, archive: boolean): Promise<LegacySource | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return { id, path, archive, content: await readFile(path, "utf8") };
  } catch (error) {
    return { id, path, archive, content: undefined, malformed: `could not read source: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function archiveSource(source: LegacySource, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${source.id}-${basename(source.path)}`);
  if (source.archive) await rename(source.path, destination);
  else await copyFile(source.path, destination);
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function history(value: unknown): BackgroundHistoryRecord[] { return Array.isArray(value) ? value.filter((entry): entry is BackgroundHistoryRecord => Boolean(entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { detail?: unknown }).detail === "string")) : []; }
function scan(value: unknown): PersistedScanState | undefined { return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" && Array.isArray((value as { pendingFiles?: unknown }).pendingFiles) ? value as PersistedScanState : undefined; }
function scanCacheEntry(value: unknown): ScanCacheEntry | undefined { const entry = object(value); return finite(entry.size) !== undefined && finite(entry.mtimeMs) !== undefined && typeof entry.analyzedAt === "string" && finite(entry.priorityScore) !== undefined ? { size: finite(entry.size)!, mtimeMs: finite(entry.mtimeMs)!, analyzedAt: entry.analyzedAt, priorityScore: finite(entry.priorityScore)!, signatureStatus: typeof entry.signatureStatus === "string" ? entry.signatureStatus : undefined } : undefined; }
function deviceRecords(value: unknown): DeviceRecord[] { return Array.isArray(value) ? value.filter((entry): entry is DeviceRecord => Boolean(entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { friendlyName?: unknown }).friendlyName === "string" && typeof (entry as { firstSeen?: unknown }).firstSeen === "string" && typeof (entry as { lastSeen?: unknown }).lastSeen === "string")) : []; }
function deviceEvents(value: unknown): DeviceHistoryRecord[] { return Array.isArray(value) ? value.filter((entry): entry is DeviceHistoryRecord => Boolean(entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string" && typeof (entry as { deviceId?: unknown }).deviceId === "string" && typeof (entry as { occurredAt?: unknown }).occurredAt === "string" && typeof (entry as { detail?: unknown }).detail === "string")) : []; }
function finite(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function validReputation(value: LegacyReputationRecord): boolean { return Boolean(value && typeof value.hash === "string" && typeof value.fileName === "string" && typeof value.knownStatus === "string" && typeof value.riskLevel === "string" && typeof value.lastSeen === "string"); }
function validBaseline(value: LegacyBaselineRecord): boolean { return Boolean(value && typeof value.filePath === "string" && typeof value.hash === "string" && typeof value.size === "number" && typeof value.fileType === "string" && typeof value.signatureState === "string" && typeof value.firstSeen === "string" && typeof value.lastSeen === "string"); }