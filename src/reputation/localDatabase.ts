import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReputationRecord, ReputationResult } from "../types.js";

export class LocalReputationDatabase {
  constructor(private readonly databasePath: string) {}

  async lookup(hash: string): Promise<ReputationResult> {
    const records = await this.readRecords();
    const record = records.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
    if (!record || record.knownStatus === "unknown") return { score: 0, evidence: [] };
    if (record.knownStatus === "trusted") return { record, score: 0, evidence: ["hash is locally recorded as trusted"] };
    return { record, score: record.riskLevel === "high" ? 100 : 65, evidence: ["hash has a local suspicious reputation record"] };
  }

  async recordSeen(hash: string, fileName: string): Promise<void> {
    const records = await this.readRecords();
    const existing = records.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
    if (existing) {
      existing.lastSeen = new Date().toISOString();
    } else {
      records.push({ hash, fileName, knownStatus: "unknown", riskLevel: "low", lastSeen: new Date().toISOString() });
    }
    await mkdir(dirname(this.databasePath), { recursive: true });
    await writeFile(this.databasePath, JSON.stringify(records, null, 2), "utf8");
  }

  private async readRecords(): Promise<ReputationRecord[]> {
    try {
      const content = await readFile(this.databasePath, "utf8");
      const records = JSON.parse(content) as unknown;
      return Array.isArray(records) ? records as ReputationRecord[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}