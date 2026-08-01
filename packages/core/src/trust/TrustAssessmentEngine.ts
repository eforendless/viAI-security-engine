import type { TrustResult } from "./TrustResult.js";
import { createTrustResult } from "./TrustResult.js";
import type { TrustEvaluationContext } from "./TrustEvaluator.js";
import { TrustRegistry } from "./TrustRegistry.js";

export class TrustAssessmentEngine {
  constructor(private readonly registry: TrustRegistry) {}

  async assess(context: TrustEvaluationContext): Promise<TrustResult> {
    const results = await Promise.all(this.registry.evaluators.map((evaluator) => evaluator.evaluate(context)));
    return createTrustResult(results.flat());
  }
}