import type { TrustEvaluator, TrustEvaluationContext, TrustIndicator } from "../../packages/core/src/trust/index.js";

export class StaticEvidenceTrustEvaluator implements TrustEvaluator {
  readonly id = "static-evidence-trust-evaluator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const evidence = context.staticEvidence;
    if (!evidence) return [];
    const indicators: TrustIndicator[] = [];
    if (evidence.previouslySeenHash) indicators.push(indicator("PREVIOUSLY_SEEN_HASH", 4, "This hash was previously observed by the local engine."));
    if (evidence.isPe && evidence.parseWarnings.length === 0 && evidence.entropy < 7.2 && !evidence.packerDetected) indicators.push(indicator("STRUCTURALLY_NORMAL_PE", 5, "PE structure parsed without warnings, high entropy, or supported packing indicators."));
    if (!context.signature.isSigned) indicators.push(indicator("UNSIGNED_BINARY", -8, "No trusted Authenticode signature was available."));
    if (evidence.entropy >= 7.2) indicators.push(indicator("HIGH_ENTROPY", -8, "High file entropy limits confidence in static inspection."));
    if (evidence.packerDetected) indicators.push(indicator("PACKED_BINARY", -10, "Supported packing indicators were observed."));
    if (evidence.isPe && evidence.parseWarnings.length > 0) indicators.push(indicator("PE_PARSE_WARNING", -8, "PE parsing reported structural warnings."));
    if (evidence.zoneIdentifier?.zoneName === "internet" || evidence.zoneIdentifier?.zoneName === "restricted-sites") indicators.push(indicator("INTERNET_ZONE_ORIGIN", -3, `Windows Zone.Identifier marks this file as originating from ${evidence.zoneIdentifier.zoneName}.`));
    return indicators;
  }

  private unused(): void {}
}

function indicator(id: string, weight: number, evidence: string): TrustIndicator {
  return { id, weight, evidence, source: "static-evidence-trust-evaluator" };
}