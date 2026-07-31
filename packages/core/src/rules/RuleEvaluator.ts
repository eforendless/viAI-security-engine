import type { RuleContext } from "./RuleContext.js";
import type { RuleResult } from "./RuleResult.js";
import { RuleRegistry } from "./RuleRegistry.js";

export class RuleEvaluator {
  evaluate(registry: RuleRegistry, context: RuleContext): readonly RuleResult[] {
    return registry.rules.map((rule) => rule.evaluate(context)).filter((result) => result.matched);
  }
}