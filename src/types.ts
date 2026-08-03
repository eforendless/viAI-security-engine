import type { StaticAnalysisReport } from "../packages/core/src/rules/index.js";
import type { StaticAssessment } from "../packages/core/src/rules/RuleResult.js";
import type { BaselineEvaluation } from "./baseline/localBaselineStore.js";

export type SignatureStatus = "trusted" | "unknown" | "invalid" | "missing";
export type SignatureVerificationState = "signed-trusted" | "signed-valid" | "signed-untrusted" | "signed-expired" | "signed-revoked" | "signed-self-signed" | "unsigned" | "verification-unavailable" | "verification-error";
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

export interface ZoneIdentifier {
  zoneId: number;
  zoneName: "local-machine" | "local-intranet" | "trusted-sites" | "internet" | "restricted-sites";
  hostUrl?: string;
  referrerUrl?: string;
}

export interface FileSystemEvidence {
  isSymbolicLink: boolean;
  isHiddenByName: boolean;
  zoneIdentifier?: ZoneIdentifier;
}

export interface EvidenceCollectorExecution {
  id: string;
  status: "completed" | "failed";
  durationMs: number;
  warning?: string;
}

export interface EvidenceProcessingMetadata {
  startedAt: string;
  completedAt?: string;
  cacheHit: boolean;
  fileReadCount: number;
  peParseCount: number;
  collectors: readonly EvidenceCollectorExecution[];
}

export interface EvidenceStore {
  schemaVersion: "0.2";
  file: { path: string; name: string; source?: "download" | "filesystem" | "removable-media"; fileType?: string };
  hashes?: Hashes;
  metadata?: FileMetadata;
  signature?: { status: SignatureStatus; publisher?: string; details: DigitalSignatureDetails };
  entropy?: number;
  portableExecutable?: PeMetadata;
  packer?: PackerFinding;
  fileSystem?: FileSystemEvidence;
  sections?: readonly PeSection[];
  imports?: readonly string[];
  exportsPresent?: boolean;
  warnings: readonly string[];
  processingMetadata: EvidenceProcessingMetadata;
}

export interface DigitalSignatureDetails {
  verificationState: SignatureVerificationState;
  present: boolean;
  valid: boolean;
  trusted: boolean;
  status: string;
  statusMessage?: string;
  publisher?: string;
  certificateSubject?: string;
  certificateIssuer?: string;
  certificateThumbprint?: string;
  certificateExpiresAt?: string;
  timestamped: boolean;
  revoked: boolean;
  selfSigned: boolean;
  verificationError?: string;
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

export type PeParseStatus = "valid" | "partial" | "malformed" | "unsupported" | "not-pe";

export interface PeParseWarning {
  code: string;
  severity: "warning" | "info";
  message: string;
}

export interface PeDirectorySummary {
  present: boolean;
  valid: boolean;
  size?: number;
  location: "rva" | "file-offset";
  status: "not-present" | "resolved" | "virtual-only" | "unmapped" | "out-of-bounds" | "truncated";
}

export interface PeMetadata {
  isPe: boolean;
  parseStatus?: PeParseStatus;
  machine?: string;
  compilationTimestamp?: string;
  entryPointRva?: number;
  imageBase?: string;
  subsystem?: string;
  dllCharacteristics?: string[];
  checksum?: number;
  sizeOfImage?: number;
  overlaySize?: number;
  directories?: {
    exports: PeDirectorySummary;
    imports: PeDirectorySummary;
    resources: PeDirectorySummary;
    security: PeDirectorySummary;
    debug: PeDirectorySummary;
    relocations: PeDirectorySummary;
    clr: PeDirectorySummary;
  };
  clrPresent?: boolean;
  numberOfSections?: number;
  sections: PeSection[];
  imports: string[];
  suspiciousImports: string[];
  exportsPresent?: boolean;
  parseWarnings: string[];
  structuredWarnings?: PeParseWarning[];
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

export type TrustLevel = "low" | "limited" | "established" | "high";

export interface ScoreBreakdownItem {
  id: string;
  category: string;
  score: number;
  reason: string;
  recommendation?: string;
}

export interface ProfessionalReport {
  schemaVersion: "0.2" | "0.3";
  summary: string;
  trust: { score: number; level: TrustLevel; indicators: Array<{ id: string; category: string; weight: number; impact: "positive" | "negative"; reason: string }> };
  risk: { score: number; level: RiskLevel; breakdown: ScoreBreakdownItem[] };
  confidence: { score: number; explanation: string[] };
  recommendation: string;
  indicators: string[];
  warnings: string[];
  fileSystem: FileSystemEvidence;
  assessment?: StaticAssessment;
  correlations?: StaticAnalysisReport["correlations"];
  baseline?: { state: "new" | "unchanged" | "changed" | "signer-changed" | "signature-changed" };
  analysisMetadata?: { engineVersion: string; ruleSetVersion: string; trustPolicyVersion: string; assessmentSchemaVersion: "0.3" };
}

export interface AnalysisResult {
  filePath: string;
  analyzedAt: string;
  hashes: Hashes;
  fileType: string;
  metadata: FileMetadata;
  fileSystemEvidence: FileSystemEvidence;
  signatureStatus: SignatureStatus;
  signaturePublisher?: string;
  digitalSignature: DigitalSignatureDetails;
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
  report: ProfessionalReport;
  baseline?: BaselineEvaluation;
  evidenceStore?: EvidenceStore;
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