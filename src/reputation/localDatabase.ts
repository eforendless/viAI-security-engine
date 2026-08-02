import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReputationRecord, ReputationResult } from "../types.js";

export class LocalReputationDatabase {
  private transaction = Promise.resolve();

  constructor(private readonly databasePath: string) {}

  async lookup(hash: string): Promise<ReputationResult> {
    return this.enqueue(async () => {
      const records = await this.readRecords();
      const record = records.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
      if (!record) return { score: 0, evidence: [] };
      if (record.knownStatus === "unknown") return { record, score: 0, evidence: ["hash was previously observed locally"] };
      if (record.knownStatus === "trusted") return { record, score: 0, evidence: ["hash is locally recorded as trusted"] };
      return { record, score: record.riskLevel === "high" ? 100 : 65, evidence: ["hash has a local suspicious reputation record"] };
    });
  }

  async recordSeen(hash: string, fileName: string): Promise<void> {
    await this.enqueue(async () => {
      const records = await this.readRecords();
      const existing = records.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
      if (existing) {
        existing.lastSeen = new Date().toISOString();
      } else {
        records.push({ hash, fileName, knownStatus: "unknown", riskLevel: "low", lastSeen: new Date().toISOString() });
      }
      await this.writeRecords(records);
    });
  }

  async clear(): Promise<void> { await this.enqueue(async () => rm(this.databasePath, { force: true })); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transaction.then(operation, operation);
    this.transaction = result.then(() => undefined, () => undefined);
    return result;
  }

  private async writeRecords(records: ReputationRecord[]): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const temporaryPath = `${this.databasePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(records, null, 2), "utf8");
    await rename(temporaryPath, this.databasePath);
  }

  private async readRecords(): Promise<ReputationRecord[]> {
    try {
      const content = await readFile(this.databasePath, "utf8");
      const records = JSON.parse(content) as unknown;
      return Array.isArray(records) ? records as ReputationRecord[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      if (error instanceof SyntaxError) {
        await rename(this.databasePath, `${this.databasePath}.corrupt-${Date.now()}`);
        return [];
      }
      throw error;
    }
  }
}