export type RiskLevel = "low" | "medium" | "high";

export interface EngineAnalysis {
  filePath: string;
  analyzedAt: string;
  hashes: { sha256: string; sha1: string; md5: string };
  fileType: string;
  metadata: { size: number; extension: string; createdAt: string; modifiedAt: string; isExecutableCandidate: boolean };
  signatureStatus: "trusted" | "unknown" | "invalid" | "missing";
  signaturePublisher?: string;
  entropy: number;
  packer: { detected: boolean; names: string[]; reasons: string[] };
  peMetadata: { isPe: boolean; machine?: string; compilationTimestamp?: string; numberOfSections?: number; imports: string[]; suspiciousImports: string[]; sections: Array<{ name: string; entropy: number; readable: boolean; writable: boolean; executable: boolean }> };
  heuristicScore: number;
  reputationScore: number;
  finalRiskScore: number;
  riskLevel: RiskLevel;
  decision: string;
  recommendation: string;
  evidence: string[];
}

export interface EngineResponse {
  riskScore: number;
  riskLevel: RiskLevel;
  decision: string;
  recommendation: string;
  evidence: string[];
  analysis: EngineAnalysis;
}

export interface HistoryItem extends EngineAnalysis {
  id: string;
}