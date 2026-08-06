import { DatabaseSync } from "node:sqlite";
import type { ReputationRecord, ReputationResult } from "../types.js";

export class LocalReputationDatabase {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS reputation (hash TEXT PRIMARY KEY COLLATE NOCASE, file_name TEXT NOT NULL, known_status TEXT NOT NULL, risk_level TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, scan_count INTEGER NOT NULL DEFAULT 1, metadata_json TEXT);");
  }

  async lookup(hash: string): Promise<ReputationResult> {
    {
      const row = this.database.prepare("SELECT hash, file_name, known_status, risk_level, last_seen FROM reputation WHERE hash = ?").get(hash) as Record<string, unknown> | undefined;
      const record = row ? { hash: String(row.hash), fileName: String(row.file_name), knownStatus: String(row.known_status), riskLevel: String(row.risk_level) } as ReputationRecord : undefined;
      if (!record) return { score: 0, evidence: [] };
      if (record.knownStatus === "unknown") return { record, score: 0, evidence: ["hash was previously observed locally"] };
      if (record.knownStatus === "trusted") return { record, score: 0, evidence: ["hash is locally recorded as trusted"] };
      return { record, score: record.riskLevel === "high" ? 100 : 65, evidence: ["hash has a local suspicious reputation record"] };
    }
  }

  async recordSeen(hash: string, fileName: string): Promise<void> {
    const timestamp = new Date().toISOString();
    this.database.prepare("INSERT INTO reputation (hash, file_name, known_status, risk_level, first_seen, last_seen, scan_count) VALUES (?, ?, 'unknown', 'low', ?, ?, 1) ON CONFLICT(hash) DO UPDATE SET last_seen = excluded.last_seen, scan_count = reputation.scan_count + 1").run(hash, fileName, timestamp, timestamp);
  }

  async clear(): Promise<void> { this.database.exec("DELETE FROM reputation"); }
  close(): void { this.database.close(); }
}