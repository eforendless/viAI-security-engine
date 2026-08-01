import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export class InstallationContextEvaluator implements TrustEvaluator {
  readonly id = "installation-context-evaluator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    return (context.installationContexts ?? []).filter((installation) => installation.weight > 0).map((installation) => ({
      id: `INSTALLATION_${installation.id}`,
      weight: installation.weight,
      evidence: installation.evidence,
      source: this.id,
    }));
  }
}