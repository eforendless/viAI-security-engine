import { RuleRegistry } from "./RuleRegistry.js";

export class RuleCache {
  private snapshot: RuleRegistry;

  constructor(initial: RuleRegistry = new RuleRegistry([])) {
    this.snapshot = initial;
  }

  get(): RuleRegistry {
    return this.snapshot;
  }

  replace(registry: RuleRegistry): void {
    this.snapshot = registry;
  }
}