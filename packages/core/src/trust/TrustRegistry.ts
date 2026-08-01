import type { TrustEvaluator } from "./TrustEvaluator.js";

export class TrustRegistry {
  readonly evaluators: readonly TrustEvaluator[];

  constructor(evaluators: readonly TrustEvaluator[]) {
    const ids = new Set<string>();
    for (const evaluator of evaluators) {
      if (ids.has(evaluator.id)) throw new Error(`Duplicate trust evaluator ID: ${evaluator.id}`);
      ids.add(evaluator.id);
    }
    this.evaluators = Object.freeze([...evaluators]);
  }
}