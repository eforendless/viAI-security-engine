import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { PeParseStatus, SignatureVerificationState } from "../types.js";

export const BASELINE_SCHEMA_VERSION = "0.3";

export type BaselineState = "new" | "unchanged" | "changed" | "signer-changed" | "signature-changed";

export interface BaselineIdentity {
  readonly filePath: string;
  readonly hash: string;
  readonly size: number;
  readonly fileType: string;
  readonly signatureState: SignatureVerificationState;
  readonly signer?: string;
  readonly pe?: { readonly machine?: string; readonly subsystem?: string; readonly parseStatus?: PeParseStatus };
}

export interface BaselineEvaluation {
  readonly state: BaselineState;
  readonly prior?: BaselineRecord;
}

export interface BaselineRecord extends BaselineIdentity {
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly scanCount: number;
  readonly engineVersion: string;
  readonly ruleSetVersion: string;
  readonly trustPolicyVersion: string;
  readonly baselineSchemaVersion: typeof BASELINE_SCHEMA_VERSION;
}

interface BaselineDocument {
  readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION;
  readonly records: readonly BaselineRecord[];
}

export class LocalBaselineStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string, _maximumRecords = 10_000) {
    this.database = new DatabaseSync(filePath);
    this.database.exec("PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS baselines (canonical_path TEXT PRIMARY KEY, file_path TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, file_type TEXT NOT NULL, signature_state TEXT NOT NULL, signer TEXT, pe_json TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, scan_count INTEGER NOT NULL, engine_version TEXT NOT NULL, rule_set_version TEXT NOT NULL, trust_policy_version TEXT NOT NULL, baseline_schema_version TEXT NOT NULL);");
  }

  async evaluate(identity: BaselineIdentity): Promise<BaselineEvaluation> {
    {
      const row = this.database.prepare("SELECT * FROM baselines WHERE canonical_path = ?").get(canonicalPath(identity.filePath)) as Record<string, unknown> | undefined;
      const prior = row ? baselineRecord(row) : undefined;
      if (!prior) return { state: "new" };
      if (prior.signer !== identity.signer) return { state: "signer-changed", prior };
      if (prior.signatureState !== identity.signatureState) return { state: "signature-changed", prior };
      if (prior.hash !== identity.hash || prior.size !== identity.size) return { state: "changed", prior };
      return { state: "unchanged", prior };
    }
  }

  async record(identity: BaselineIdentity, versions: { engineVersion?: string; ruleSetVersion?: string; trustPolicyVersion?: string } = {}): Promise<void> {
    {
      const now = new Date().toISOString();
      const key = canonicalPath(identity.filePath);
      this.database.prepare("INSERT INTO baselines (canonical_path, file_path, hash, size, file_type, signature_state, signer, pe_json, first_seen, last_seen, scan_count, engine_version, rule_set_version, trust_policy_version, baseline_schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(canonical_path) DO UPDATE SET hash = excluded.hash, size = excluded.size, file_type = excluded.file_type, signature_state = excluded.signature_state, signer = excluded.signer, pe_json = excluded.pe_json, last_seen = excluded.last_seen, scan_count = baselines.scan_count + 1, engine_version = excluded.engine_version, rule_set_version = excluded.rule_set_version, trust_policy_version = excluded.trust_policy_version, baseline_schema_version = excluded.baseline_schema_version").run(key, identity.filePath, identity.hash, identity.size, identity.fileType, identity.signatureState, identity.signer ?? null, identity.pe ? JSON.stringify(identity.pe) : null, now, now, versions.engineVersion ?? "unknown", versions.ruleSetVersion ?? "0.3", versions.trustPolicyVersion ?? "0.3", BASELINE_SCHEMA_VERSION);
    }
  }
  async clear(): Promise<void> { this.database.exec("DELETE FROM baselines"); }
  close(): void { this.database.close(); }
}

function canonicalPath(filePath: string): string { return resolve(filePath).replaceAll("/", "\\").toLocaleLowerCase(); }

function baselineRecord(row: Record<string, unknown>): BaselineRecord { return { filePath: String(row.file_path), hash: String(row.hash), size: Number(row.size), fileType: String(row.file_type), signatureState: String(row.signature_state) as BaselineIdentity["signatureState"], signer: typeof row.signer === "string" ? row.signer : undefined, pe: typeof row.pe_json === "string" ? JSON.parse(row.pe_json) as BaselineIdentity["pe"] : undefined, firstSeen: String(row.first_seen), lastSeen: String(row.last_seen), scanCount: Number(row.scan_count), engineVersion: String(row.engine_version), ruleSetVersion: String(row.rule_set_version), trustPolicyVersion: String(row.trust_policy_version), baselineSchemaVersion: BASELINE_SCHEMA_VERSION }; }