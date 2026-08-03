import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  private transaction = Promise.resolve();

  constructor(private readonly filePath: string, private readonly maximumRecords = 10_000) {}

  async evaluate(identity: BaselineIdentity): Promise<BaselineEvaluation> {
    return this.enqueue(async () => {
      const prior = (await this.read()).records.find((record) => canonicalPath(record.filePath) === canonicalPath(identity.filePath));
      if (!prior) return { state: "new" };
      if (prior.signer !== identity.signer) return { state: "signer-changed", prior };
      if (prior.signatureState !== identity.signatureState) return { state: "signature-changed", prior };
      if (prior.hash !== identity.hash || prior.size !== identity.size) return { state: "changed", prior };
      return { state: "unchanged", prior };
    });
  }

  async record(identity: BaselineIdentity, versions: { engineVersion?: string; ruleSetVersion?: string; trustPolicyVersion?: string } = {}): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.read();
      const now = new Date().toISOString();
      const key = canonicalPath(identity.filePath);
      const previous = document.records.find((record) => canonicalPath(record.filePath) === key);
      const record: BaselineRecord = {
        ...identity,
        firstSeen: previous?.firstSeen ?? now,
        lastSeen: now,
        scanCount: (previous?.scanCount ?? 0) + 1,
        engineVersion: versions.engineVersion ?? previous?.engineVersion ?? "unknown",
        ruleSetVersion: versions.ruleSetVersion ?? previous?.ruleSetVersion ?? "0.3",
        trustPolicyVersion: versions.trustPolicyVersion ?? previous?.trustPolicyVersion ?? "0.3",
        baselineSchemaVersion: BASELINE_SCHEMA_VERSION,
      };
      const records = [record, ...document.records.filter((entry) => canonicalPath(entry.filePath) !== key)]
        .sort((left, right) => right.lastSeen.localeCompare(left.lastSeen))
        .slice(0, this.maximumRecords);
      await this.write({ schemaVersion: BASELINE_SCHEMA_VERSION, records });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transaction.then(operation, operation);
    this.transaction = result.then(() => undefined, () => undefined);
    return result;
  }

  private async read(): Promise<BaselineDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<BaselineDocument>;
      if (parsed.schemaVersion !== BASELINE_SCHEMA_VERSION || !Array.isArray(parsed.records)) return { schemaVersion: BASELINE_SCHEMA_VERSION, records: [] };
      return { schemaVersion: BASELINE_SCHEMA_VERSION, records: parsed.records.filter(isBaselineRecord) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return { schemaVersion: BASELINE_SCHEMA_VERSION, records: [] };
      throw error;
    }
  }

  private async write(document: BaselineDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(document), "utf8");
    await rename(temporary, this.filePath);
  }
}

function canonicalPath(filePath: string): string { return resolve(filePath).replaceAll("/", "\\").toLocaleLowerCase(); }

function isBaselineRecord(value: unknown): value is BaselineRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BaselineRecord>;
  return typeof record.filePath === "string" && typeof record.hash === "string" && typeof record.size === "number" && typeof record.fileType === "string" && typeof record.signatureState === "string" && typeof record.firstSeen === "string" && typeof record.lastSeen === "string" && typeof record.scanCount === "number";
}