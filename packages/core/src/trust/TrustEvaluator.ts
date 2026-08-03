import type { TrustIndicator } from "./TrustIndicator.js";
import type { HashReputation } from "./HashReputationProvider.js";

export type CertificateTrustStatus = "trusted" | "expired" | "revoked" | "invalid" | "unknown" | "missing";

export interface VersionInformation {
  readonly companyName?: string;
  readonly productName?: string;
  readonly originalFilename?: string;
  readonly internalName?: string;
  readonly fileVersion?: string;
  readonly productVersion?: string;
}

export interface InstallationContext {
  readonly id: string;
  readonly weight: number;
  readonly evidence: string;
}

export interface TrustEvaluationContext {
  readonly filePath: string;
  readonly hash: string;
  readonly signature: {
    readonly isSigned: boolean;
    readonly publisher?: string;
    readonly certificateStatus: CertificateTrustStatus;
    readonly hasTrustedTimestamp?: boolean;
    readonly verificationState?: "signed-trusted" | "signed-valid" | "signed-untrusted" | "signed-expired" | "signed-revoked" | "signed-self-signed" | "unsigned" | "verification-unavailable" | "verification-error";
  };
  readonly version?: VersionInformation;
  readonly installationContexts?: readonly InstallationContext[];
  readonly hashReputation?: HashReputation;
  readonly baseline?: { readonly state: "new" | "unchanged" | "changed" | "signer-changed" | "signature-changed"; readonly systemLocation: boolean; };
  readonly staticEvidence?: {
    readonly previouslySeenHash: boolean;
    readonly isPe: boolean;
    readonly parseWarnings: readonly string[];
    readonly entropy: number;
    readonly packerDetected: boolean;
    readonly zoneIdentifier?: { readonly zoneName: "local-machine" | "local-intranet" | "trusted-sites" | "internet" | "restricted-sites" };
  };
}

export interface TrustEvaluator {
  readonly id: string;
  evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]>;
}