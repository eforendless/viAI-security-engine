import type { StaticAnalysisReport } from "../packages/core/src/rules/index.js";

export type SignatureStatus = "trusted" | "unknown" | "invalid" | "missing";
export type RiskLevel = "low" | "medium" | "high";
export type InvestigationDecision = "no_further_investigation" | "investigate" | "investigate_urgent";
export type KnownStatus = "trusted" | "suspicious" | "unknown";

export interface FileActivityEvent {
  path: string;
  timestamp: string;
  source: "download" | "filesystem" | "removable-media";
  kind: "created" | "modified" | "discovered" | "execution-attempt";
  parentProcess?: string;
  userContext?: string;
}

export interface Hashes {
  sha256: string;
  sha1: string;
  md5: string;
}

export interface FileMetadata {
  size: number;
  createdAt: string;
  modifiedAt: string;
  extension: string;
  isExecutableCandidate: boolean;
}

export interface PeSection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawSize: number;
  rawOffset: number;
  entropy: number;
  readable: boolean;
  writable: boolean;
  executable: boolean;
}

export interface PeMetadata {
  isPe: boolean;
  machine?: string;
  compilationTimestamp?: string;
  numberOfSections?: number;
  sections: PeSection[];
  imports: string[];
  suspiciousImports: string[];
  exportsPresent?: boolean;
  parseWarnings: string[];
}

export interface PackerFinding {
  detected: boolean;
  names: string[];
  reasons: string[];
}

export interface ReputationRecord {
  hash: string;
  fileName: string;
  knownStatus: KnownStatus;
  riskLevel: RiskLevel;
  lastSeen: string;
}

export interface ReputationResult {
  record?: ReputationRecord;
  score: number;
  evidence: string[];
}

export interface HeuristicFinding {
  ruleId: string;
  score: number;
  evidence: string;
}

export interface AnalysisResult {
  filePath: string;
  analyzedAt: string;
  hashes: Hashes;
  fileType: string;
  metadata: FileMetadata;
  signatureStatus: SignatureStatus;
  signaturePublisher?: string;
  entropy: number;
  packer: PackerFinding;
  peMetadata: PeMetadata;
  heuristicScore: number;
  reputationScore: number;
  finalRiskScore: number;
  trustScore: number;
  overallScore: number;
  confidence: number;
  riskLevel: RiskLevel;
  decision: InvestigationDecision;
  recommendation: string;
  evidence: string[];
  heuristicFindings: HeuristicFinding[];
  staticAnalysisReport: StaticAnalysisReport;
}

export interface SandboxSubmission {
  analysis: AnalysisResult;
  requestedAt: string;
}

export interface SandboxClient {
  submit(submission: SandboxSubmission): Promise<void>;
}

export interface InvestigationClient {
  investigate(analysis: AnalysisResult): Promise<void>;
}

export interface MonitorObservation {
  id: string;
  timestamp: string;
  category: "process" | "scheduled-task" | "registry-run-key" | "service" | "driver";
  detail: string;
}