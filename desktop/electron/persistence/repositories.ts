import { basename } from "node:path";
import type { ScanCacheEntry } from "../fileClassification";
import type { BackgroundHistoryRecord, BackgroundSettings, PersistedScanState } from "../backgroundService";
import type { DeviceHistoryRecord, DeviceRecord } from "../deviceSecurity";
import { ViAiDatabase, desktopMigrations } from "./database";

export interface HistoryQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly category?: "all" | "needs-investigation" | "monitoring" | "no-action";
  readonly scanId?: string;
}

export interface HistoryPage {
  readonly items: BackgroundHistoryRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export type ScanReportStatus = "running" | "paused" | "completed" | "cancelled" | "failed";
export interface ScanReport {
  readonly scanId: string;
  readonly status: ScanReportStatus;
  readonly performanceMode: "light" | "balanced" | "deep";
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly elapsedMs?: number;
  readonly discoveredCount: number;
  readonly processedCount: number;
  readonly analyzedCount: number;
  readonly inventoryCount: number;
  readonly skippedCount: number;
  readonly safeCount: number;
  readonly monitorCount: number;
  readonly investigationCount: number;
  readonly errorCount: number;
  readonly cancelledAt?: string;
  readonly pausedAt?: string;
  readonly completionPercentage: number;
  readonly failureReason?: string;
  readonly target: string;
}
export interface ScanReportQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly status?: "all" | ScanReportStatus;
  readonly performanceMode?: "all" | "light" | "balanced" | "deep";
}
export interface ScanReportPage {
  readonly items: ScanReport[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export type DashboardTrendPeriod = "24h" | "7d" | "30d";
export type DashboardAssessmentCategory = "needs-investigation" | "monitoring" | "no-action" | "legacy";

export interface DashboardSummary {
  readonly totalAssessments: number;
  readonly categories: Readonly<Record<DashboardAssessmentCategory, number>>;
  readonly fileTypes: Readonly<Record<"executables" | "dlls" | "drivers" | "scripts" | "documents" | "archives" | "media", number>>;
  readonly cacheEntries: number;
  readonly lastAssessmentAt?: string;
}

export interface DashboardTrendBucket {
  readonly bucket: string;
  readonly total: number;
  readonly needsInvestigation: number;
  readonly monitoring: number;
  readonly noAction: number;
  readonly legacy: number;
}

export interface DashboardRecentQuery {
  readonly limit?: number;
  readonly search?: string;
  readonly category?: "all" | DashboardAssessmentCategory;
}

export interface DashboardRecentAssessment {
  readonly id: string;
  readonly occurredAt: string;
  readonly filePath?: string;
  readonly detail: string;
  readonly recommendation?: string;
  readonly engineVersion: string;
  readonly assessment?: BackgroundHistoryRecord["assessment"];
}

type Row = Record<string, unknown>;

export class DesktopPersistence {
  readonly database: ViAiDatabase;

  constructor(filePath: string) {
    this.database = new ViAiDatabase(filePath);
    this.database.migrate(desktopMigrations);
  }

  loadSettings(): BackgroundSettings | undefined {
    return json<BackgroundSettings>(this.database.connection.prepare("SELECT value_json FROM settings WHERE key = ?").get("background.settings") as Row | undefined, "value_json");
  }

  saveSettings(settings: BackgroundSettings): void {
    this.database.connection.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run("background.settings", JSON.stringify(settings), now());
  }

  getOrCreateSystemDeviceId(): string {
    const stored = json<string>(this.database.connection.prepare("SELECT value_json FROM settings WHERE key = ?").get("system.device-id") as Row | undefined, "value_json");
    if (typeof stored === "string" && stored.length > 0) return stored;
    const id = crypto.randomUUID();
    this.database.connection.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)").run("system.device-id", JSON.stringify(id), now());
    return id;
  }

  setSystemDeviceId(id: string): void {
    this.database.connection.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run("system.device-id", JSON.stringify(id), now());
  }

  hasLegacyImport(sourceName: string): boolean {
    return Boolean(this.database.connection.prepare("SELECT 1 AS present FROM legacy_imports WHERE source_name = ?").get(sourceName));
  }

  recordLegacyImport(sourceName: string, sourcePath: string, recordsImported: number, diagnostic?: string): void {
    this.database.connection.prepare("INSERT INTO legacy_imports (source_name, source_path, imported_at, records_imported, diagnostic) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_name) DO UPDATE SET source_path = excluded.source_path, imported_at = excluded.imported_at, records_imported = excluded.records_imported, diagnostic = excluded.diagnostic")
      .run(sourceName, sourcePath, now(), recordsImported, diagnostic ?? null);
  }

  recordDiagnostic(category: string, detail: string): void {
    this.database.connection.prepare("INSERT INTO persistence_diagnostics (occurred_at, category, detail) VALUES (?, ?, ?)").run(now(), category, detail);
  }

  loadActiveScan(): PersistedScanState | undefined {
    return json<PersistedScanState>(this.database.connection.prepare("SELECT state_json FROM scan_sessions WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1").get() as Row | undefined, "state_json");
  }

  loadLastCompletedScan(): PersistedScanState | undefined {
    return json<PersistedScanState>(this.database.connection.prepare("SELECT state_json FROM scan_sessions WHERE is_last_completed = 1 ORDER BY completed_at DESC, updated_at DESC LIMIT 1").get() as Row | undefined, "state_json");
  }

  saveScan(scan: PersistedScanState | undefined): void {
    if (!scan) return;
    this.database.transaction(() => {
      this.writeScanSession(scan, true);
      this.writeScanReport(scan, false);
    });
  }

  finalizeScan(scan: PersistedScanState): void {
    this.database.transaction(() => {
      this.writeScanSession(scan, false);
      this.writeScanReport(scan, true);
    });
  }

  reconcileScanReport(scan: PersistedScanState): void {
    this.database.transaction(() => this.writeScanReport(scan, true));
  }

  listScanReports(query: ScanReportQuery = {}): ScanReportPage {
    const pageSize = Math.max(1, Math.min(query.pageSize ?? 50, 200));
    const page = Math.max(0, query.page ?? 0);
    const where = ["sessions.mode = 'full'"];
    const values: string[] = [];
    if (query.status && query.status !== "all") { where.push("reports.status = ?"); values.push(query.status); }
    if (query.performanceMode && query.performanceMode !== "all") { where.push("reports.performance_mode = ?"); values.push(query.performanceMode); }
    const search = query.search?.trim();
    if (search) { where.push("reports.scan_id LIKE ? ESCAPE '\\'"); values.push(`%${escapeLike(search)}%`); }
    const condition = `WHERE ${where.join(" AND ")}`;
    const count = this.database.connection.prepare(`SELECT COUNT(*) AS total FROM scan_reports reports JOIN scan_sessions sessions ON sessions.id = reports.scan_id ${condition}`).get(...values) as Row;
    const rows = this.database.connection.prepare(`SELECT reports.*, sessions.state_json FROM scan_reports reports JOIN scan_sessions sessions ON sessions.id = reports.scan_id ${condition} ORDER BY reports.started_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, page * pageSize) as Row[];
    return { items: rows.map(scanReport), total: numberValue(count.total), page, pageSize };
  }

  getScanReport(scanId: string): ScanReport | undefined {
    const row = this.database.connection.prepare("SELECT reports.*, sessions.state_json FROM scan_reports reports JOIN scan_sessions sessions ON sessions.id = reports.scan_id WHERE reports.scan_id = ? AND sessions.mode = 'full'").get(scanId) as Row | undefined;
    return row ? scanReport(row) : undefined;
  }

  runtimeScanReport(scan: PersistedScanState): ScanReport | undefined {
    if (scan.mode !== "full") return undefined;
    return scanReportFromState(scan, this.assessmentCounts(scan.id));
  }

  private writeScanSession(scan: PersistedScanState, isActive: boolean): void {
    if (isActive) this.database.connection.prepare("UPDATE scan_sessions SET is_active = 0 WHERE is_active = 1 AND id <> ?").run(scan.id);
    else this.database.connection.prepare("UPDATE scan_sessions SET is_active = 0 WHERE id = ?").run(scan.id);
    if (scan.status === "completed") this.database.connection.prepare("UPDATE scan_sessions SET is_last_completed = 0 WHERE id <> ?").run(scan.id);
    this.database.connection.prepare(`INSERT INTO scan_sessions (
        id, mode, status, source, device_id, volume_id, started_at, completed_at, updated_at, progress,
        files_completed, files_remaining, total_files, investigation_count, error_count, elapsed_ms,
        is_active, is_last_completed, state_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, source = excluded.source, device_id = excluded.device_id, volume_id = excluded.volume_id,
        completed_at = excluded.completed_at, updated_at = excluded.updated_at, progress = excluded.progress,
        files_completed = excluded.files_completed, files_remaining = excluded.files_remaining, total_files = excluded.total_files,
        investigation_count = excluded.investigation_count, error_count = excluded.error_count, elapsed_ms = excluded.elapsed_ms,
        is_active = excluded.is_active, is_last_completed = excluded.is_last_completed, state_json = excluded.state_json`)
      .run(scan.id, scan.mode, scan.status, scan.source ?? null, scan.deviceId ?? null, scan.deviceVolume ?? null, scan.startedAt, scan.completedAt ?? null, scan.updatedAt, scan.progress, scan.filesCompleted, scan.filesRemaining, scan.totalFiles, scan.investigationCount, scan.errorCount ?? 0, scan.elapsedMs ?? null, isActive ? 1 : 0, scan.status === "completed" ? 1 : 0, JSON.stringify(scan));
  }

  private writeScanReport(scan: PersistedScanState, reconcileAssessments: boolean): void {
    if (scan.mode !== "full") return;
    const counts = reconcileAssessments ? this.assessmentCounts(scan.id) : { analyzed: 0, safe: 0, monitor: 0, investigation: scan.investigationCount };
    const status: ScanReportStatus = scan.status === "paused" ? "paused" : scan.status === "completed" ? "completed" : scan.status === "cancelled" ? "cancelled" : scan.status === "failed" ? "failed" : "running";
    const performance = scan.performanceMode === "light" || scan.performanceMode === "deep" ? scan.performanceMode : "balanced";
    const endedAt = scan.completedAt ?? scan.cancelledAt ?? (status === "failed" ? scan.updatedAt : undefined);
    this.database.connection.prepare(`INSERT INTO scan_reports (
      scan_id, status, performance_mode, started_at, ended_at, elapsed_ms, discovered_count, processed_count,
      analyzed_count, inventory_count, skipped_count, safe_count, monitor_count, investigation_count, error_count,
      cancelled_at, paused_at, completion_percentage, failure_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scan_id) DO UPDATE SET
      status = excluded.status, performance_mode = excluded.performance_mode, ended_at = excluded.ended_at,
      elapsed_ms = excluded.elapsed_ms, discovered_count = excluded.discovered_count, processed_count = excluded.processed_count,
      analyzed_count = excluded.analyzed_count, inventory_count = excluded.inventory_count, skipped_count = excluded.skipped_count,
      safe_count = excluded.safe_count, monitor_count = excluded.monitor_count, investigation_count = excluded.investigation_count,
      error_count = excluded.error_count, cancelled_at = excluded.cancelled_at, paused_at = excluded.paused_at,
      completion_percentage = excluded.completion_percentage, failure_reason = excluded.failure_reason, updated_at = excluded.updated_at`)
      .run(scan.id, status, performance, scan.startedAt, endedAt ?? null, scan.elapsedMs ?? null, scan.totalFiles, scan.filesCompleted, counts.analyzed, scan.inventoryCount ?? 0, scan.cacheSkipped ?? 0, counts.safe, counts.monitor, counts.investigation, scan.errorCount ?? 0, scan.cancelledAt ?? null, scan.pausedAt ?? null, scan.progress, scan.failureReason ?? null, now(), scan.updatedAt);
  }

  private assessmentCounts(scanId: string): { analyzed: number; safe: number; monitor: number; investigation: number } {
    const row = this.database.connection.prepare(`SELECT COUNT(*) AS analyzed,
      SUM(CASE WHEN history_category = 'no-action' THEN 1 ELSE 0 END) AS safe,
      SUM(CASE WHEN history_category = 'monitoring' THEN 1 ELSE 0 END) AS monitor,
      SUM(CASE WHEN history_category = 'needs-investigation' THEN 1 ELSE 0 END) AS investigation
      FROM assessments WHERE scan_id = ?`).get(scanId) as Row;
    return { analyzed: numberValue(row.analyzed), safe: numberValue(row.safe), monitor: numberValue(row.monitor), investigation: numberValue(row.investigation) };
  }

  putAssessment(record: BackgroundHistoryRecord): void {
    const assessment = assessmentFields(record);
    this.database.connection.prepare(`INSERT INTO assessments (
      id, kind, occurred_at, file_path, file_name, file_hash, scan_id, scan_type, source, verdict,
      recommendation, risk_score, trust_score, confidence, investigation_priority, history_category,
      device_id, volume_id, engine_version, assessment_schema_version, detail, search_text, summary_json, report_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      occurred_at = excluded.occurred_at, file_path = excluded.file_path, file_name = excluded.file_name,
      file_hash = excluded.file_hash, scan_type = excluded.scan_type, source = excluded.source, verdict = excluded.verdict,
      recommendation = excluded.recommendation, risk_score = excluded.risk_score, trust_score = excluded.trust_score,
      confidence = excluded.confidence, investigation_priority = excluded.investigation_priority,
      history_category = excluded.history_category, device_id = excluded.device_id, volume_id = excluded.volume_id,
      engine_version = excluded.engine_version, assessment_schema_version = excluded.assessment_schema_version,
      detail = excluded.detail, search_text = excluded.search_text, summary_json = excluded.summary_json, report_json = excluded.report_json`)
      .run(record.id, record.kind, record.occurredAt, record.filePath ?? null, fileName(record.filePath), record.fileHash ?? null, record.scanId ?? null, record.scanType ?? null, record.source ?? null, assessment.verdict, record.recommendation ?? assessment.recommendation, record.riskScore ?? null, record.trustScore ?? assessment.trustScore, assessment.confidence, assessment.priority, assessment.category, record.deviceId ?? null, record.deviceVolume ?? null, record.engineVersion, assessment.schemaVersion, record.detail, searchText(record), JSON.stringify(summary(record)), record.report ? JSON.stringify(record.report) : null, now());
  }

  listHistory(query: HistoryQuery = {}): HistoryPage {
    const pageSize = Math.max(1, Math.min(query.pageSize ?? 100, 500));
    const page = Math.max(0, query.page ?? 0);
    const where: string[] = [];
    const values: string[] = [];
    if (query.category && query.category !== "all") {
      where.push("history_category = ?");
      values.push(query.category);
    }
    if (query.scanId) { where.push("scan_id = ?"); values.push(query.scanId); }
    const search = query.search?.trim();
    if (search) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      values.push(`%${escapeLike(search.toLocaleLowerCase())}%`);
    }
    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = this.database.connection.prepare(`SELECT COUNT(*) AS total FROM assessments ${condition}`).get(...values) as Row;
    const rows = this.database.connection.prepare(`SELECT summary_json FROM assessments ${condition} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`).all(...values, pageSize, page * pageSize) as Row[];
    return { items: rows.flatMap((row) => recordFromSummary(row)), total: numberValue(count.total), page, pageSize };
  }

  getDashboardSummary(): DashboardSummary {
    const row = this.database.connection.prepare(`SELECT
      COUNT(*) AS total_assessments,
      SUM(CASE WHEN history_category = 'needs-investigation' THEN 1 ELSE 0 END) AS needs_investigation,
      SUM(CASE WHEN history_category = 'monitoring' THEN 1 ELSE 0 END) AS monitoring,
      SUM(CASE WHEN history_category = 'no-action' THEN 1 ELSE 0 END) AS no_action,
      SUM(CASE WHEN history_category = 'legacy' THEN 1 ELSE 0 END) AS legacy,
      SUM(CASE WHEN lower(file_name) GLOB '*.exe' OR lower(file_name) GLOB '*.com' OR lower(file_name) GLOB '*.scr' OR lower(file_name) GLOB '*.msi' OR lower(file_name) GLOB '*.msp' OR lower(file_name) GLOB '*.appx' THEN 1 ELSE 0 END) AS executables,
      SUM(CASE WHEN lower(file_name) GLOB '*.dll' OR lower(file_name) GLOB '*.ocx' OR lower(file_name) GLOB '*.cpl' THEN 1 ELSE 0 END) AS dlls,
      SUM(CASE WHEN lower(file_name) GLOB '*.sys' OR lower(file_name) GLOB '*.drv' THEN 1 ELSE 0 END) AS drivers,
      SUM(CASE WHEN lower(file_name) GLOB '*.ps1' OR lower(file_name) GLOB '*.bat' OR lower(file_name) GLOB '*.cmd' OR lower(file_name) GLOB '*.js' OR lower(file_name) GLOB '*.vbs' OR lower(file_name) GLOB '*.py' OR lower(file_name) GLOB '*.hta' THEN 1 ELSE 0 END) AS scripts,
      SUM(CASE WHEN lower(file_name) GLOB '*.doc' OR lower(file_name) GLOB '*.docx' OR lower(file_name) GLOB '*.docm' OR lower(file_name) GLOB '*.xls' OR lower(file_name) GLOB '*.xlsx' OR lower(file_name) GLOB '*.xlsm' OR lower(file_name) GLOB '*.ppt' OR lower(file_name) GLOB '*.pptx' OR lower(file_name) GLOB '*.pdf' THEN 1 ELSE 0 END) AS documents,
      SUM(CASE WHEN lower(file_name) GLOB '*.zip' OR lower(file_name) GLOB '*.rar' OR lower(file_name) GLOB '*.7z' OR lower(file_name) GLOB '*.tar' OR lower(file_name) GLOB '*.gz' THEN 1 ELSE 0 END) AS archives,
      SUM(CASE WHEN lower(file_name) GLOB '*.mp3' OR lower(file_name) GLOB '*.mp4' OR lower(file_name) GLOB '*.mkv' OR lower(file_name) GLOB '*.avi' OR lower(file_name) GLOB '*.jpg' OR lower(file_name) GLOB '*.jpeg' OR lower(file_name) GLOB '*.png' OR lower(file_name) GLOB '*.gif' THEN 1 ELSE 0 END) AS media,
      MAX(occurred_at) AS last_assessment_at,
      (SELECT COUNT(*) FROM scan_cache) AS cache_entries
      FROM assessments WHERE kind = 'scan'`).get() as Row;
    return {
      totalAssessments: numberValue(row.total_assessments),
      categories: { "needs-investigation": numberValue(row.needs_investigation), monitoring: numberValue(row.monitoring), "no-action": numberValue(row.no_action), legacy: numberValue(row.legacy) },
      fileTypes: { executables: numberValue(row.executables), dlls: numberValue(row.dlls), drivers: numberValue(row.drivers), scripts: numberValue(row.scripts), documents: numberValue(row.documents), archives: numberValue(row.archives), media: numberValue(row.media) },
      cacheEntries: numberValue(row.cache_entries),
      lastAssessmentAt: typeof row.last_assessment_at === "string" ? row.last_assessment_at : undefined,
    };
  }

  getAssessmentTrend(period: DashboardTrendPeriod, referenceTime = new Date()): DashboardTrendBucket[] {
    const start = trendStart(period, referenceTime);
    const bucket = period === "24h" ? "substr(occurred_at, 1, 13) || ':00:00.000Z'" : "substr(occurred_at, 1, 10) || 'T00:00:00.000Z'";
    const rows = this.database.connection.prepare(`SELECT ${bucket} AS bucket,
      COUNT(*) AS total,
      SUM(CASE WHEN history_category = 'needs-investigation' THEN 1 ELSE 0 END) AS needs_investigation,
      SUM(CASE WHEN history_category = 'monitoring' THEN 1 ELSE 0 END) AS monitoring,
      SUM(CASE WHEN history_category = 'no-action' THEN 1 ELSE 0 END) AS no_action,
      SUM(CASE WHEN history_category = 'legacy' THEN 1 ELSE 0 END) AS legacy
      FROM assessments WHERE kind = 'scan' AND occurred_at >= ?
      GROUP BY bucket ORDER BY bucket ASC`).all(start.toISOString()) as Row[];
    return rows.map((row) => ({ bucket: stringValue(row.bucket), total: numberValue(row.total), needsInvestigation: numberValue(row.needs_investigation), monitoring: numberValue(row.monitoring), noAction: numberValue(row.no_action), legacy: numberValue(row.legacy) }));
  }

  getRecentAssessments(query: DashboardRecentQuery = {}): DashboardRecentAssessment[] {
    const limit = Math.max(1, Math.min(query.limit ?? 8, 50));
    const where = ["kind = 'scan'"];
    const values: string[] = [];
    if (query.category && query.category !== "all") { where.push("history_category = ?"); values.push(query.category); }
    const search = query.search?.trim();
    if (search) { where.push("search_text LIKE ? ESCAPE '\\'"); values.push(`%${escapeLike(search.toLocaleLowerCase())}%`); }
    const rows = this.database.connection.prepare(`SELECT id, occurred_at, file_path, detail, recommendation, engine_version, assessment_schema_version, verdict, risk_score, trust_score, confidence, investigation_priority
      FROM assessments WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT ?`).all(...values, limit) as Row[];
    return rows.map((row) => recentAssessment(row));
  }

  getHistoryRecord(id: string): BackgroundHistoryRecord | undefined {
    const row = this.database.connection.prepare("SELECT summary_json, report_json FROM assessments WHERE id = ?").get(id) as Row | undefined;
    const record = json<BackgroundHistoryRecord>(row, "summary_json");
    if (!record) return undefined;
    const report = json<Record<string, unknown>>(row, "report_json");
    return report ? { ...record, report } : record;
  }

  removeHistory(ids: readonly string[]): void {
    if (!ids.length) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.database.connection.prepare(`DELETE FROM assessments WHERE id IN (${placeholders})`).run(...ids);
  }

  removeHistoryMatching(query: HistoryQuery, excludedIds: readonly string[] = []): void {
    const where: string[] = [];
    const values: string[] = [];
    if (query.category && query.category !== "all") { where.push("history_category = ?"); values.push(query.category); }
    const search = query.search?.trim();
    if (search) { where.push("search_text LIKE ? ESCAPE '\\'"); values.push(`%${escapeLike(search.toLocaleLowerCase())}%`); }
    if (excludedIds.length) { where.push(`id NOT IN (${excludedIds.map(() => "?").join(", ")})`); values.push(...excludedIds); }
    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    this.database.connection.prepare(`DELETE FROM assessments ${condition}`).run(...values);
  }

  clearHistory(scope: "all" | "low" | "medium" | "high"): void {
    if (scope === "all") this.database.connection.exec("DELETE FROM assessments");
    else {
      const range = scope === "low" ? "risk_score <= 25" : scope === "medium" ? "risk_score > 25 AND risk_score <= 60" : "risk_score > 60";
      this.database.connection.exec(`DELETE FROM assessments WHERE ${range}`);
    }
  }

  cacheEntry(filePath: string): ScanCacheEntry | undefined {
    const row = this.database.connection.prepare("SELECT size, modified_at, last_analysis_at, priority_score, signature_status FROM scan_cache WHERE normalized_path = ?").get(cacheKey(filePath)) as Row | undefined;
    if (!row) return undefined;
    return { size: numberValue(row.size), mtimeMs: numberValue(row.modified_at), analyzedAt: stringValue(row.last_analysis_at), priorityScore: numberValue(row.priority_score), signatureStatus: typeof row.signature_status === "string" ? row.signature_status : undefined };
  }

  putCacheEntry(filePath: string, entry: ScanCacheEntry): void {
    this.database.connection.prepare("INSERT INTO scan_cache (normalized_path, size, modified_at, last_analysis_at, priority_score, signature_status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(normalized_path) DO UPDATE SET size = excluded.size, modified_at = excluded.modified_at, last_analysis_at = excluded.last_analysis_at, priority_score = excluded.priority_score, signature_status = excluded.signature_status")
      .run(cacheKey(filePath), entry.size, entry.mtimeMs, entry.analyzedAt, entry.priorityScore, entry.signatureStatus ?? null);
  }

  countCacheEntries(): number {
    return numberValue((this.database.connection.prepare("SELECT COUNT(*) AS total FROM scan_cache").get() as Row).total);
  }

  loadDevices(): DeviceRecord[] {
    const rows = this.database.connection.prepare("SELECT metadata_json FROM devices ORDER BY last_seen DESC").all() as Row[];
    return rows.flatMap((row) => json<DeviceRecord>(row, "metadata_json") ? [json<DeviceRecord>(row, "metadata_json")!] : []);
  }

  loadDeviceEvents(): DeviceHistoryRecord[] {
    const rows = this.database.connection.prepare("SELECT id, event_type, device_id, occurred_at, detail, scan_id FROM device_events ORDER BY occurred_at DESC LIMIT 2000").all() as Row[];
    return rows.map((row) => ({ id: stringValue(row.id), type: stringValue(row.event_type) as DeviceHistoryRecord["type"], deviceId: stringValue(row.device_id), occurredAt: stringValue(row.occurred_at), detail: stringValue(row.detail), scanId: typeof row.scan_id === "string" ? row.scan_id : undefined }));
  }

  replaceDevices(devices: readonly DeviceRecord[]): void {
    this.database.transaction(() => {
      const statement = this.database.connection.prepare("INSERT INTO devices (id, hardware_identifier, volume_serial, label, local_trust_label, first_seen, last_seen, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, local_trust_label = excluded.local_trust_label, last_seen = excluded.last_seen, metadata_json = excluded.metadata_json");
      for (const device of devices) statement.run(device.id, device.id, device.id.startsWith("volume:") ? device.id.slice("volume:".length) : null, device.friendlyName, device.isTrusted ? 1 : 0, device.firstSeen, device.lastSeen, JSON.stringify(device));
    });
  }

  appendDeviceEvents(events: readonly DeviceHistoryRecord[]): void {
    if (!events.length) return;
    this.database.transaction(() => {
      const statement = this.database.connection.prepare("INSERT OR IGNORE INTO device_events (id, device_id, event_type, occurred_at, detail, scan_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const event of events) statement.run(event.id, event.deviceId, event.type, event.occurredAt, event.detail, event.scanId ?? null, null);
      this.database.connection.exec("DELETE FROM device_events WHERE id NOT IN (SELECT id FROM device_events ORDER BY occurred_at DESC LIMIT 2000)");
    });
  }

  importDevicesAndEvents(devices: readonly DeviceRecord[], events: readonly DeviceHistoryRecord[]): void {
    const deviceStatement = this.database.connection.prepare("INSERT INTO devices (id, hardware_identifier, volume_serial, label, local_trust_label, first_seen, last_seen, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, local_trust_label = excluded.local_trust_label, last_seen = excluded.last_seen, metadata_json = excluded.metadata_json");
    for (const device of devices) deviceStatement.run(device.id, device.id, device.id.startsWith("volume:") ? device.id.slice("volume:".length) : null, device.friendlyName, device.isTrusted ? 1 : 0, device.firstSeen, device.lastSeen, JSON.stringify(device));
    const eventStatement = this.database.connection.prepare("INSERT OR IGNORE INTO device_events (id, device_id, event_type, occurred_at, detail, scan_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const event of events) eventStatement.run(event.id, event.deviceId, event.type, event.occurredAt, event.detail, event.scanId ?? null, null);
  }

  importReputation(records: readonly LegacyReputationRecord[]): void {
    const statement = this.database.connection.prepare("INSERT INTO reputation (hash, file_name, known_status, risk_level, first_seen, last_seen, scan_count, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(hash) DO UPDATE SET file_name = excluded.file_name, known_status = excluded.known_status, risk_level = excluded.risk_level, last_seen = excluded.last_seen, scan_count = MAX(reputation.scan_count, excluded.scan_count), metadata_json = excluded.metadata_json");
    for (const record of records) {
      if (!record || typeof record.hash !== "string" || typeof record.fileName !== "string" || typeof record.knownStatus !== "string" || typeof record.riskLevel !== "string" || typeof record.lastSeen !== "string") continue;
      statement.run(record.hash, record.fileName, record.knownStatus, record.riskLevel, record.firstSeen ?? record.lastSeen, record.lastSeen, positiveNumber(record.scanCount, 1), JSON.stringify(record));
    }
  }

  importBaselines(records: readonly LegacyBaselineRecord[]): void {
    const statement = this.database.connection.prepare("INSERT INTO baselines (canonical_path, file_path, hash, size, file_type, signature_state, signer, pe_json, first_seen, last_seen, scan_count, engine_version, rule_set_version, trust_policy_version, baseline_schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(canonical_path) DO UPDATE SET hash = excluded.hash, size = excluded.size, file_type = excluded.file_type, signature_state = excluded.signature_state, signer = excluded.signer, pe_json = excluded.pe_json, last_seen = excluded.last_seen, scan_count = MAX(baselines.scan_count, excluded.scan_count), engine_version = excluded.engine_version, rule_set_version = excluded.rule_set_version, trust_policy_version = excluded.trust_policy_version, baseline_schema_version = excluded.baseline_schema_version");
    for (const record of records) {
      if (!isLegacyBaseline(record)) continue;
      statement.run(canonicalPath(record.filePath), record.filePath, record.hash, record.size, record.fileType, record.signatureState, record.signer ?? null, record.pe ? JSON.stringify(record.pe) : null, record.firstSeen, record.lastSeen, positiveNumber(record.scanCount, 1), record.engineVersion ?? "unknown", record.ruleSetVersion ?? "0.3", record.trustPolicyVersion ?? "0.3", record.baselineSchemaVersion ?? "0.3");
    }
  }

  clearLocalSecurityData(): void {
    this.database.transaction(() => {
      this.database.connection.exec("DELETE FROM assessments; DELETE FROM scan_reports; DELETE FROM scan_sessions; DELETE FROM scan_cache; DELETE FROM device_events; DELETE FROM devices; DELETE FROM reputation; DELETE FROM baselines;");
    });
  }

  clearDeviceSecurityData(): void {
    this.database.transaction(() => { this.database.connection.exec("DELETE FROM device_events; DELETE FROM devices;"); });
  }
}

function summary(record: BackgroundHistoryRecord): Omit<BackgroundHistoryRecord, "report"> {
  const { report: _report, ...value } = record;
  return value;
}

function assessmentFields(record: BackgroundHistoryRecord): { verdict: string | null; recommendation: string | null; trustScore: number | null; confidence: number | null; priority: string | null; schemaVersion: string | null; category: "needs-investigation" | "monitoring" | "no-action" | "legacy" } {
  const assessment = record.assessment;
  if (!assessment || assessment.schemaVersion !== "0.3") return { verdict: null, recommendation: record.recommendation ?? null, trustScore: null, confidence: null, priority: null, schemaVersion: null, category: "legacy" };
  const recommendation = assessment.recommendation;
  const requiresInvestigation = ["MEDIUM", "HIGH", "URGENT"].includes(assessment.investigationPriority) || ["REVIEW", "DYNAMIC_ANALYSIS", "SANDBOX", "AI_ANALYSIS"].includes(recommendation) || ["SUSPICIOUS", "HIGHLY_SUSPICIOUS"].includes(assessment.verdict);
  return { verdict: assessment.verdict, recommendation, trustScore: assessment.trust.score, confidence: assessment.confidence.score, priority: assessment.investigationPriority, schemaVersion: assessment.schemaVersion, category: requiresInvestigation ? "needs-investigation" : recommendation === "MONITOR" ? "monitoring" : "no-action" };
}

function searchText(record: BackgroundHistoryRecord): string {
  return [record.filePath, record.detail, record.recommendation, record.assessment?.verdict, record.assessment?.recommendation, ...(record.matchedRules ?? []), ...(record.trustIndicators ?? [])].filter((value): value is string => typeof value === "string").join(" ").toLocaleLowerCase();
}

function recordFromSummary(row: Row): BackgroundHistoryRecord[] {
  const value = json<BackgroundHistoryRecord>(row, "summary_json");
  return value ? [value] : [];
}

function recentAssessment(row: Row): DashboardRecentAssessment {
  const schemaVersion = typeof row.assessment_schema_version === "string" ? row.assessment_schema_version : undefined;
  const verdict = typeof row.verdict === "string" ? row.verdict : undefined;
  const recommendation = typeof row.recommendation === "string" ? row.recommendation : undefined;
  const priority = typeof row.investigation_priority === "string" ? row.investigation_priority : undefined;
  const assessment = schemaVersion === "0.3" && verdict && recommendation && priority ? {
    schemaVersion: "0.3" as const,
    verdict,
    recommendation,
    investigationPriority: priority,
    suspicion: { score: numberValue(row.risk_score), level: "unknown" },
    trust: { score: numberValue(row.trust_score), level: "unknown" },
    confidence: { score: numberValue(row.confidence), level: "unknown" },
  } : undefined;
  return { id: stringValue(row.id), occurredAt: stringValue(row.occurred_at), filePath: typeof row.file_path === "string" ? row.file_path : undefined, detail: stringValue(row.detail), recommendation, engineVersion: stringValue(row.engine_version), assessment };
}

function json<T>(row: Row | undefined, key: string): T | undefined {
  const source = row?.[key];
  if (typeof source !== "string") return undefined;
  try { return JSON.parse(source) as T; } catch { return undefined; }
}

function cacheKey(filePath: string): string { return filePath.replaceAll("/", "\\").toLocaleLowerCase(); }
function fileName(filePath: string | undefined): string | null { return filePath ? basename(filePath) : null; }
function now(): string { return new Date().toISOString(); }
function trendStart(period: DashboardTrendPeriod, referenceTime: Date): Date {
  const start = new Date(referenceTime);
  if (period === "24h") start.setUTCHours(start.getUTCHours() - 24);
  else start.setUTCDate(start.getUTCDate() - (period === "7d" ? 7 : 30));
  return start;
}
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
function positiveNumber(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback; }
function canonicalPath(filePath: string): string { return filePath.replaceAll("/", "\\").toLocaleLowerCase(); }

function scanReport(row: Row): ScanReport {
  const status = row.status === "paused" || row.status === "completed" || row.status === "cancelled" || row.status === "failed" ? row.status : "running";
  const performanceMode = row.performance_mode === "light" || row.performance_mode === "deep" ? row.performance_mode : "balanced";
  const session = json<PersistedScanState>(row, "state_json");
  return { scanId: stringValue(row.scan_id), status, performanceMode, startedAt: stringValue(row.started_at), endedAt: typeof row.ended_at === "string" ? row.ended_at : undefined, elapsedMs: typeof row.elapsed_ms === "number" ? numberValue(row.elapsed_ms) : undefined, discoveredCount: numberValue(row.discovered_count), processedCount: numberValue(row.processed_count), analyzedCount: numberValue(row.analyzed_count), inventoryCount: numberValue(row.inventory_count), skippedCount: numberValue(row.skipped_count), safeCount: numberValue(row.safe_count), monitorCount: numberValue(row.monitor_count), investigationCount: numberValue(row.investigation_count), errorCount: numberValue(row.error_count), cancelledAt: typeof row.cancelled_at === "string" ? row.cancelled_at : undefined, pausedAt: typeof row.paused_at === "string" ? row.paused_at : undefined, completionPercentage: numberValue(row.completion_percentage), failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined, target: session?.target ?? "Full Device Scan" };
}

function scanReportFromState(scan: PersistedScanState, counts: { analyzed: number; safe: number; monitor: number; investigation: number }): ScanReport {
  const status: ScanReportStatus = scan.status === "paused" ? "paused" : scan.status === "completed" ? "completed" : scan.status === "cancelled" ? "cancelled" : scan.status === "failed" ? "failed" : "running";
  const performanceMode = scan.performanceMode === "light" || scan.performanceMode === "deep" ? scan.performanceMode : "balanced";
  const endedAt = scan.completedAt ?? scan.cancelledAt ?? (status === "failed" ? scan.updatedAt : undefined);
  return {
    scanId: scan.id,
    status,
    performanceMode,
    startedAt: scan.startedAt,
    endedAt,
    elapsedMs: scan.elapsedMs ?? activeElapsedMs(scan),
    discoveredCount: scan.totalFiles,
    processedCount: scan.filesCompleted,
    analyzedCount: counts.analyzed,
    inventoryCount: scan.inventoryCount ?? 0,
    skippedCount: scan.cacheSkipped ?? 0,
    safeCount: counts.safe,
    monitorCount: counts.monitor,
    investigationCount: counts.investigation,
    errorCount: scan.errorCount ?? 0,
    cancelledAt: scan.cancelledAt,
    pausedAt: scan.pausedAt,
    completionPercentage: scan.progress,
    failureReason: scan.failureReason,
    target: scan.target,
  };
}

function activeElapsedMs(scan: PersistedScanState): number {
  const end = scan.completedAt ?? scan.cancelledAt ?? (scan.status === "failed" ? scan.updatedAt : new Date().toISOString());
  const elapsed = Date.parse(end) - Date.parse(scan.startedAt) - scan.pausedDurationMs - (scan.pausedAt ? Math.max(0, Date.now() - Date.parse(scan.pausedAt)) : 0);
  return Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
}

export interface LegacyReputationRecord {
  readonly hash: string;
  readonly fileName: string;
  readonly knownStatus: string;
  readonly riskLevel: string;
  readonly lastSeen: string;
  readonly firstSeen?: string;
  readonly scanCount?: number;
}

export interface LegacyBaselineRecord {
  readonly filePath: string;
  readonly hash: string;
  readonly size: number;
  readonly fileType: string;
  readonly signatureState: string;
  readonly signer?: string;
  readonly pe?: Record<string, unknown>;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly scanCount: number;
  readonly engineVersion?: string;
  readonly ruleSetVersion?: string;
  readonly trustPolicyVersion?: string;
  readonly baselineSchemaVersion?: string;
}

function isLegacyBaseline(value: LegacyBaselineRecord): boolean {
  return typeof value.filePath === "string" && typeof value.hash === "string" && typeof value.size === "number" && Number.isFinite(value.size) && typeof value.fileType === "string" && typeof value.signatureState === "string" && typeof value.firstSeen === "string" && typeof value.lastSeen === "string";
}