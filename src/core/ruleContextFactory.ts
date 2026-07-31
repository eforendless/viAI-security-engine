import type { RuleContext, SourceKind } from "../../packages/core/src/rules/index.js";
import type { AnalysisResult, PackerFinding, PeMetadata, ReputationResult, SignatureStatus } from "../types.js";

interface ContextInput {
  filePath: string;
  hashes: AnalysisResult["hashes"];
  metadata: AnalysisResult["metadata"];
  entropy: number;
  signatureStatus: SignatureStatus;
  signaturePublisher?: string;
  packer: PackerFinding;
  peMetadata: PeMetadata;
}

export function createRuleContext(input: ContextInput, reputation: ReputationResult, source?: "download" | "filesystem" | "removable-media"): RuleContext {
  const sourceKind: SourceKind = source ?? "unknown";
  const extension = input.metadata.extension.toLowerCase();
  return {
    file: {
      hash: input.hashes.sha256,
      name: input.filePath.split(/[\\/]/).pop() ?? input.filePath,
      extension,
      type: extension.replace(/^\./, ""),
      size: input.metadata.size,
      isExecutable: input.metadata.isExecutableCandidate,
      entropy: input.entropy,
      containsMacro: false,
    },
    signature: {
      isSigned: input.signatureStatus === "trusted",
      status: input.signatureStatus,
      publisher: input.signaturePublisher,
    },
    pe: {
      isPe: input.peMetadata.isPe,
      imports: input.peMetadata.imports,
      suspiciousImports: input.peMetadata.suspiciousImports,
      suspiciousImportCount: input.peMetadata.suspiciousImports.length,
      packerDetected: input.packer.detected,
    },
    source: { kind: sourceKind, isDownload: sourceKind === "download" || /[\\/]downloads([\\/]|$)/i.test(input.filePath) },
    reputation: { score: reputation.score, knownStatus: reputation.record?.knownStatus ?? "unknown" },
  };
}