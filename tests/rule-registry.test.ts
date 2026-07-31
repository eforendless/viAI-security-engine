import assert from "node:assert/strict";
import test from "node:test";
import { RuleCache, RuleRegistry, type CompiledRule } from "../packages/core/src/rules/index.js";

function compiledRule(id: string, features: string[] = []): CompiledRule {
  return {
    id,
    origin: { path: `${id}.vrl` },
    referencedFeatures: features,
    evaluate: () => ({ id, matched: false, score: 0, severity: "low", evidence: "" }),
  };
}

test("registry indexes immutable compiled rules by ID and feature", () => {
  const rule = compiledRule("unsigned", ["signature.isSigned"]);
  const registry = new RuleRegistry([rule]);
  assert.equal(registry.get("unsigned"), rule);
  assert.deepEqual(registry.forFeature("signature.isSigned"), [rule]);
  assert.throws(() => new RuleRegistry([rule, rule]), /Duplicate rule ID/);
});

test("cache publishes whole registry snapshots", () => {
  const first = new RuleRegistry([compiledRule("first")]);
  const second = new RuleRegistry([compiledRule("second")]);
  const cache = new RuleCache(first);
  assert.equal(cache.get(), first);
  cache.replace(second);
  assert.equal(cache.get(), second);
});