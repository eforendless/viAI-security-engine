import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export interface HashReputation {
  readonly status: "trusted" | "unknown";
  readonly evidence?: string;
  readonly weight?: number;
}

export interface HashReputationProvider {
  lookup(hash: string): Promise<HashReputation>;
}

export class HashReputationEvaluator implements TrustEvaluator {
  readonly id = "hash-reputation-evaluator";

  constructor(private readonly provider?: HashReputationProvider) {}

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const reputation = context.hashReputation ?? await this.provider?.lookup(context.hash) ?? { status: "unknown" as const };
    if (reputation.status !== "trusted") return [];
    return [{
      id: "TRUSTED_HASH_REPUTATION",
      weight: reputation.weight ?? 25,
      evidence: reputation.evidence ?? "Hash is trusted by the configured reputation provider.",
      source: this.id,
    }];
  }
}