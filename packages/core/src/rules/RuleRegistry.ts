import type { CompiledRule } from "./Rule.js";

export class RuleRegistry {
  readonly rules: readonly CompiledRule[];
  private readonly byId: ReadonlyMap<string, CompiledRule>;
  private readonly byFeature: ReadonlyMap<string, readonly CompiledRule[]>;

  constructor(rules: readonly CompiledRule[]) {
    const ids = new Map<string, CompiledRule>();
    const features = new Map<string, CompiledRule[]>();
    for (const rule of rules) {
      if (ids.has(rule.id)) throw new Error(`Duplicate rule ID: ${rule.id}`);
      ids.set(rule.id, rule);
      for (const feature of rule.referencedFeatures) {
        const indexedRules = features.get(feature) ?? [];
        indexedRules.push(rule);
        features.set(feature, indexedRules);
      }
    }
    this.rules = Object.freeze([...rules]);
    this.byId = ids;
    this.byFeature = new Map([...features].map(([feature, indexedRules]) => [feature, Object.freeze([...indexedRules])]));
  }

  get(id: string): CompiledRule | undefined {
    return this.byId.get(id);
  }

  forFeature(path: string): readonly CompiledRule[] {
    return this.byFeature.get(path) ?? [];
  }
}