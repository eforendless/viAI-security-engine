import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface SqlMigration {
  readonly id: string;
  readonly apply: (database: DatabaseSync) => void;
}

export class ViAiDatabase {
  readonly connection: DatabaseSync;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.connection = new DatabaseSync(filePath);
    this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
    this.connection.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
  }

  migrate(migrations: readonly SqlMigration[]): void {
    const applied = new Set(this.connection.prepare("SELECT id FROM schema_migrations").all().map((row) => String((row as { id: string }).id)));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      this.transaction(() => {
        migration.apply(this.connection);
        this.connection.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date().toISOString());
      });
    }
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}

export const desktopMigrations: readonly SqlMigration[] = [{
  id: "desktop-001-local-security-state",
  apply: (database) => database.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE scan_sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      device_id TEXT,
      volume_id TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      files_completed INTEGER NOT NULL DEFAULT 0,
      files_remaining INTEGER NOT NULL DEFAULT 0,
      total_files INTEGER NOT NULL DEFAULT 0,
      investigation_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      elapsed_ms INTEGER,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_last_completed INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL
    );
    CREATE INDEX scan_sessions_active ON scan_sessions(is_active, updated_at DESC);
    CREATE INDEX scan_sessions_completed ON scan_sessions(is_last_completed, completed_at DESC);

    CREATE TABLE assessments (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT,
      file_hash TEXT,
      scan_id TEXT,
      scan_type TEXT,
      source TEXT,
      verdict TEXT,
      recommendation TEXT,
      risk_score REAL,
      trust_score REAL,
      confidence REAL,
      investigation_priority TEXT,
      history_category TEXT NOT NULL DEFAULT 'legacy',
      device_id TEXT,
      volume_id TEXT,
      engine_version TEXT NOT NULL,
      assessment_schema_version TEXT,
      detail TEXT NOT NULL,
      search_text TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      report_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX assessments_occurred_at ON assessments(occurred_at DESC);
    CREATE INDEX assessments_file_hash ON assessments(file_hash);
    CREATE INDEX assessments_file_path ON assessments(file_path);
    CREATE INDEX assessments_filter ON assessments(history_category, occurred_at DESC);
    CREATE INDEX assessments_recommendation ON assessments(recommendation, occurred_at DESC);
    CREATE INDEX assessments_source ON assessments(source, occurred_at DESC);
    CREATE INDEX assessments_scan ON assessments(scan_id);
    CREATE INDEX assessments_device ON assessments(device_id);

    CREATE TABLE scan_cache (
      normalized_path TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      modified_at REAL NOT NULL,
      last_analysis_at TEXT NOT NULL,
      priority_score REAL NOT NULL,
      signature_status TEXT,
      assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL
    );

    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      hardware_identifier TEXT,
      volume_serial TEXT,
      label TEXT NOT NULL,
      local_trust_label INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE INDEX devices_last_seen ON devices(last_seen DESC);

    CREATE TABLE device_events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      detail TEXT NOT NULL,
      scan_id TEXT,
      metadata_json TEXT
    );
    CREATE INDEX device_events_device ON device_events(device_id, occurred_at DESC);
    CREATE INDEX device_events_occurred_at ON device_events(occurred_at DESC);

    CREATE TABLE reputation (
      hash TEXT PRIMARY KEY COLLATE NOCASE,
      file_name TEXT NOT NULL,
      known_status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      scan_count INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT
    );
    CREATE INDEX reputation_last_seen ON reputation(last_seen DESC);

    CREATE TABLE baselines (
      canonical_path TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      signature_state TEXT NOT NULL,
      signer TEXT,
      pe_json TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      scan_count INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      rule_set_version TEXT NOT NULL,
      trust_policy_version TEXT NOT NULL,
      baseline_schema_version TEXT NOT NULL
    );
    CREATE INDEX baselines_last_seen ON baselines(last_seen DESC);
    CREATE INDEX baselines_hash ON baselines(hash);

    CREATE TABLE legacy_imports (
      source_name TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      records_imported INTEGER NOT NULL,
      diagnostic TEXT
    );

    CREATE TABLE persistence_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      category TEXT NOT NULL,
      detail TEXT NOT NULL
    );
  `),
}, {
  id: "desktop-002-dashboard-assessment-queries",
  apply: (database) => database.exec(`
    CREATE INDEX assessments_dashboard_timeline ON assessments(kind, occurred_at DESC);
    CREATE INDEX assessments_dashboard_recent ON assessments(kind, history_category, occurred_at DESC);
  `),
}, {
  id: "desktop-003-scan-reports",
  apply: (database) => database.exec(`
    CREATE TABLE scan_reports (
      scan_id TEXT PRIMARY KEY REFERENCES scan_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      performance_mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      elapsed_ms INTEGER,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      analyzed_count INTEGER NOT NULL DEFAULT 0,
      inventory_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      safe_count INTEGER NOT NULL DEFAULT 0,
      monitor_count INTEGER NOT NULL DEFAULT 0,
      investigation_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      paused_at TEXT,
      completion_percentage REAL NOT NULL DEFAULT 0,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX scan_reports_scan_id ON scan_reports(scan_id);
    CREATE INDEX scan_reports_status ON scan_reports(status, started_at DESC);
    CREATE INDEX scan_reports_started_at ON scan_reports(started_at DESC);
    CREATE INDEX scan_reports_performance_mode ON scan_reports(performance_mode, started_at DESC);
  `),
}];