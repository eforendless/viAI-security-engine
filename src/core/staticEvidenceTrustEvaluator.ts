import type { TrustEvaluator, TrustEvaluationContext, TrustIndicator } from "../../packages/core/src/trust/index.js";

export class StaticEvidenceTrustEvaluator implements TrustEvaluator {
  readonly id = "static-evidence-trust-evaluator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const evidence = context.staticEvidence;
    if (!evidence) return [];
    const indicators: TrustIndicator[] = [];
    if (evidence.isPe && evidence.parseWarnings.length === 0 && evidence.entropy < 7.2 && !evidence.packerDetected) indicators.push(indicator("STRUCTURALLY_NORMAL_PE", 5, "PE structure parsed without warnings, high entropy, or supported packing indicators."));
    if (context.signature.certificateStatus === "missing") indicators.push(indicator("UNSIGNED_BINARY", -8, "No Authenticode signature is present."));
    if (context.signature.verificationState === "signed-revoked") indicators.push(indicator("REVOKED_SIGNATURE", -35, "Windows reported the signing certificate as revoked."));
    if (context.signature.verificationState === "signed-untrusted") indicators.push(indicator("UNTRUSTED_SIGNATURE", -5, "The file is signed but its chain is not trusted locally."));
    if (context.baseline?.state === "unchanged" && context.baseline.systemLocation && context.signature.certificateStatus === "trusted") indicators.push(indicator("UNCHANGED_TRUSTED_SYSTEM_BASELINE", 20, "Trusted signature and system-file baseline are unchanged."));
    if (context.baseline?.state === "signer-changed") indicators.push(indicator("BASELINE_SIGNER_CHANGED", -25, "The signer changed since the local baseline observation."));
    if (context.baseline?.state === "signature-changed") indicators.push(indicator("BASELINE_SIGNATURE_CHANGED", -20, "The signature state changed since the local baseline observation."));
    if (context.baseline?.state === "changed") indicators.push(indicator("BASELINE_HASH_CHANGED", -15, "The file hash or size changed since the local baseline observation."));
    if (evidence.zoneIdentifier?.zoneName === "internet" || evidence.zoneIdentifier?.zoneName === "restricted-sites") indicators.push(indicator("INTERNET_ZONE_ORIGIN", -3, `Windows Zone.Identifier marks this file as originating from ${evidence.zoneIdentifier.zoneName}.`));
    return indicators;
  }

  private unused(): void {}
}

function indicator(id: string, weight: number, evidence: string): TrustIndicator {
  return { id, weight, evidence, source: "static-evidence-trust-evaluator" };
}