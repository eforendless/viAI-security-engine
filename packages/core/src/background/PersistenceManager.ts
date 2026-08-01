export interface BackgroundHistoryRecord {
  readonly id: string;
  readonly kind: "scan" | "realtime-event" | "trust-evaluation" | "rule-match";
  readonly occurredAt: string;
  readonly fileHash?: string;
  readonly filePath?: string;
  readonly riskScore?: number;
  readonly trustScore?: number;
  readonly recommendation?: string;
  readonly matchedRules?: readonly string[];
  readonly engineVersion: string;
  readonly detail: string;
}

export interface PersistenceManager {
  loadHistory(): Promise<readonly BackgroundHistoryRecord[]>;
  saveHistory(records: readonly BackgroundHistoryRecord[]): Promise<void>;
  clearHistory(): Promise<void>;
}