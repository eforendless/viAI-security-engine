import type { HashReputation, TrustEvaluationContext } from "../../packages/core/src/trust/index.js";
import type { AnalysisResult, ReputationResult, SignatureStatus } from "../types.js";

interface TrustContextInput {
  readonly filePath: string;
  readonly hashes: AnalysisResult["hashes"];
  readonly signatureStatus: SignatureStatus;
  readonly signaturePublisher?: string;
}

export function createTrustContext(input: TrustContextInput, reputation: ReputationResult): TrustEvaluationContext {
  return {
    filePath: input.filePath,
    hash: input.hashes.sha256,
    signature: {
      isSigned: input.signatureStatus === "trusted",
      publisher: input.signaturePublisher,
      certificateStatus: certificateStatus(input.signatureStatus),
    },
    hashReputation: toHashReputation(reputation),
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