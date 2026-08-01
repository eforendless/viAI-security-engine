import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export class CertificateValidator implements TrustEvaluator {
  readonly id = "certificate-validator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    if (!context.signature.isSigned || context.signature.certificateStatus !== "trusted") return [];
    const timestamp = context.signature.hasTrustedTimestamp ? " with a trusted timestamp" : "";
    return [{
      id: "VALID_CERTIFICATE",
      weight: 12,
      evidence: `Digital signature certificate is valid under local trust policy${timestamp}.`,
      source: this.id,
    }];
  }
}