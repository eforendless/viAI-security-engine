import type { HashReputation, TrustEvaluationContext } from "../../packages/core/src/trust/index.js";
import type { AnalysisResult, EvidenceStore, FileSystemEvidence, ReputationResult, SignatureStatus } from "../types.js";
import type { BaselineEvaluation } from "../baseline/localBaselineStore.js";

interface TrustContextInput {
  readonly filePath: string;
  readonly hashes: AnalysisResult["hashes"];
  readonly signatureStatus: SignatureStatus;
  readonly signaturePublisher?: string;
  readonly entropy: number;
  readonly peIsValid: boolean;
  readonly peWarnings: readonly string[];
  readonly packerDetected: boolean;
  readonly fileSystemEvidence: FileSystemEvidence;
  readonly signatureVerificationState?: TrustEvaluationContext["signature"]["verificationState"];
  readonly baseline?: TrustEvaluationContext["baseline"];
}

export function createTrustContext(input: TrustContextInput, reputation: ReputationResult): TrustEvaluationContext {
  return {
    filePath: input.filePath,
    hash: input.hashes.sha256,
    signature: {
      isSigned: input.signatureStatus === "trusted",
      publisher: input.signaturePublisher,
      certificateStatus: certificateStatus(input.signatureStatus),
      verificationState: input.signatureVerificationState,
    },
    hashReputation: toHashReputation(reputation),
    baseline: input.baseline,
    staticEvidence: { previouslySeenHash: Boolean(reputation.record), isPe: input.peIsValid, parseWarnings: input.peWarnings, entropy: input.entropy, packerDetected: input.packerDetected, zoneIdentifier: input.fileSystemEvidence.zoneIdentifier },
  };
}

function certificateStatus(status: SignatureStatus): TrustEvaluationContext["signature"]["certificateStatus"] {
  if (status === "trusted") return "trusted";
  if (status === "missing") return "missing";
  if (status === "invalid") return "invalid";
  return "unknown";
}

function toHashReputation(reputation: ReputationResult): HashReputation {
  if (reputation.record?.knownStatus === "trusted") {
    return { status: "trusted", evidence: "Hash is trusted by the local reputation database." };
  }
  return { status: "unknown" };
}

export function createTrustContextFromEvidence(evidence: EvidenceStore, reputation: ReputationResult, baseline?: BaselineEvaluation): TrustEvaluationContext {
  const hashes = requireEvidence(evidence.hashes, "hashes");
  const signature = requireEvidence(evidence.signature, "signature");
  const portableExecutable = requireEvidence(evidence.portableExecutable, "Portable Executable metadata");
  const entropy = requireEvidence(evidence.entropy, "entropy");
  const packer = requireEvidence(evidence.packer, "packer evidence");
  const fileSystemEvidence = requireEvidence(evidence.fileSystem, "filesystem evidence");
  return createTrustContext({ filePath: evidence.file.path, hashes, signatureStatus: signature.status, signaturePublisher: signature.publisher, signatureVerificationState: signature.details.verificationState, entropy, peIsValid: portableExecutable.isPe, peWarnings: portableExecutable.parseWarnings, packerDetected: packer.detected, fileSystemEvidence, baseline: baseline ? { state: baseline.state, systemLocation: isSystemLocation(evidence.file.path) } : undefined }, reputation);
}

function isSystemLocation(filePath: string): boolean { return /^[a-z]:\\windows\\(?:system32|syswow64|system32\\drivers)(?:\\|$)/i.test(filePath.replace(/\//g, "\\")); }

function requireEvidence<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Evidence extraction did not produce ${label}`);
  return value;
}