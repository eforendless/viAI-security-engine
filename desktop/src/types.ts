export type RiskLevel = "low" | "medium" | "high";
export interface AssessmentSummary { schemaVersion: "0.3"; verdict: string; suspicion: { score: number; level: string }; trust: { score: number; level: string }; confidence: { score: number; level: string }; investigationPriority: string; recommendation: string; }

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
  trustScore: number;
  overallScore: number;
  confidence: number;
  riskLevel: RiskLevel;
  decision: string;
  recommendation: string;
  assessment?: AssessmentSummary;
  baselineState?: string;
  evidence: string[];
}

export interface EngineResponse {
  riskScore: number;
  trustScore: number;
  overallScore: number;
  confidence: number;
  riskLevel: RiskLevel;
  decision: string;
  recommendation: string;
  evidence: string[];
  analysis: EngineAnalysis;
}

export interface HistoryItem extends EngineAnalysis {
  id: string;
}