export type SourceKind = "download" | "filesystem" | "removable-media" | "unknown";
export type SignatureState = "trusted" | "unknown" | "invalid" | "missing";
export type ReputationState = "trusted" | "suspicious" | "unknown";

export interface FileFeatures {
  readonly hash: string;
  readonly name: string;
  readonly extension: string;
  readonly type: string;
  readonly size: number;
  readonly isExecutable: boolean;
  readonly entropy: number;
  readonly containsMacro: boolean;
}

export interface SignatureFeatures {
  readonly isSigned: boolean;
  readonly status: SignatureState;
  readonly publisher?: string;
}

export interface PeFeatures {
  readonly isPe: boolean;
  readonly imports: readonly string[];
  readonly suspiciousImports: readonly string[];
  readonly suspiciousImportCount: number;
  readonly processInjectionCapabilityChain?: boolean;
  readonly packerDetected: boolean;
}

export interface SourceFeatures {
  readonly kind: SourceKind;
  readonly isDownload: boolean;
}

export interface ReputationFeatures {
  readonly score: number;
  readonly knownStatus: ReputationState;
}

export interface BaselineFeatures {
  readonly state: "new" | "unchanged" | "changed" | "signer-changed" | "signature-changed";
}

export interface RuleContext {
  readonly file: FileFeatures;
  readonly signature: SignatureFeatures;
  readonly pe: PeFeatures;
  readonly source: SourceFeatures;
  readonly reputation: ReputationFeatures;
  readonly baseline?: BaselineFeatures;
}