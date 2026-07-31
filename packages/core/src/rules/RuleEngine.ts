import { RiskAggregator } from "./RiskAggregator.js";
import { RuleCache } from "./RuleCache.js";
import type { RuleContext } from "./RuleContext.js";
import { RuleEvaluator } from "./RuleEvaluator.js";
import { RuleLoader } from "./RuleLoader.js";
import { RuleRegistry } from "./RuleRegistry.js";
import type { StaticAnalysisReport } from "./RuleResult.js";

export class RuleEngine {
  constructor(
    private readonly loader: RuleLoader,
    private readonly cache = new RuleCache(),
    private readonly evaluator = new RuleEvaluator(),
    private readonly aggregator = new RiskAggregator(),
  ) {}

  async load(directory: string): Promise<void> {
    const rules = await this.loader.load(directory);
    this.cache.replace(new RuleRegistry(rules));
  }

  evaluate(context: RuleContext, metadata: unknown): StaticAnalysisReport {
    const snapshot = this.cache.get();
    return this.aggregator.aggregate(context.file.hash, this.evaluator.evaluate(snapshot, context), metadata);
  }

  ruleCount(): number { return this.cache.get().rules.length; }
}