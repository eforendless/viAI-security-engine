import type { CompiledRule, ExpressionNode, ParsedRule } from "./Rule.js";
import type { RuleContext } from "./RuleContext.js";

type FeatureValue = boolean | number | string | readonly string[] | undefined;
type FeatureType = "boolean" | "number" | "string" | "strings";

const features: Readonly<Record<string, FeatureType>> = {
  "file.hash": "string", "file.name": "string", "file.extension": "string", "file.type": "string", "file.size": "number", "file.isExecutable": "boolean", "file.entropy": "number", "file.containsMacro": "boolean",
  "signature.isSigned": "boolean", "signature.status": "string", "signature.publisher": "string",
  "pe.isPe": "boolean", "pe.imports": "strings", "pe.suspiciousImports": "strings", "pe.suspiciousImportCount": "number", "pe.packerDetected": "boolean",
  "source.kind": "string", "source.isDownload": "boolean", "reputation.score": "number", "reputation.knownStatus": "string",
};

export class RuleCompiler {
  compile(rule: ParsedRule): CompiledRule {
    const predicate = this.compileBoolean(rule.when);
    const referencedFeatures = [...new Set(this.featuresOf(rule.when))];
    return {
      id: rule.id,
      origin: rule.origin,
      referencedFeatures,
      evaluate: (context) => {
        const matched = predicate(context);
        return { id: rule.id, matched, score: matched ? rule.score : 0, severity: rule.severity, evidence: rule.evidence, recommendation: matched ? rule.recommendation : undefined };
      },
    };
  }

  private compileBoolean(node: ExpressionNode): (context: RuleContext) => boolean {
    const type = this.typeOf(node);
    if (type !== "boolean") throw this.error(node, `Expected a boolean expression, found ${type}`);
    return this.compileValue(node) as (context: RuleContext) => boolean;
  }
  private compileValue(node: ExpressionNode): (context: RuleContext) => FeatureValue {
    if (node.kind === "literal") return () => node.value;
    if (node.kind === "feature") return (context) => this.valueFor(context, node.path);
    if (node.kind === "not") { const operand = this.compileBoolean(node.operand); return (context) => !operand(context); }
    if (node.kind === "logical") { const left = this.compileBoolean(node.left); const right = this.compileBoolean(node.right); return node.operator === "and" ? (context) => left(context) && right(context) : (context) => left(context) || right(context); }
    if (node.kind === "comparison") { const left = this.compileValue(node.left); const right = this.compileValue(node.right); return (context) => this.compare(node.operator, left(context) as boolean | number | string, right(context) as boolean | number | string); }
    const left = this.compileValue(node.left); const right = this.compileValue(node.right); return (context) => {
      const value = left(context);
      const expected = right(context);
      if (value === undefined || typeof expected !== "string") return false;
      return typeof value === "string" ? value.includes(expected) : (value as readonly string[]).includes(expected);
    };
  }
  private typeOf(node: ExpressionNode): FeatureType {
    if (node.kind === "literal") return typeof node.value as FeatureType;
    if (node.kind === "feature") { const type = features[node.path]; if (!type) throw this.error(node, `Unknown feature '${node.path}'`); return type; }
    if (node.kind === "not") { this.require(node.operand, "boolean"); return "boolean"; }
    if (node.kind === "logical") { this.require(node.left, "boolean"); this.require(node.right, "boolean"); return "boolean"; }
    if (node.kind === "comparison") { const left = this.typeOf(node.left); const right = this.typeOf(node.right); if (left !== right || left === "strings") throw this.error(node, "Comparisons require matching scalar types"); if ([">", ">=", "<", "<="].includes(node.operator) && left !== "number") throw this.error(node, "Ordering comparisons require numeric operands"); return "boolean"; }
    const left = this.typeOf(node.left); const right = this.typeOf(node.right); if (!((left === "strings" || left === "string") && right === "string")) throw this.error(node, "contains requires a string or string collection and a string value"); return "boolean";
  }
  private require(node: ExpressionNode, type: FeatureType): void { if (this.typeOf(node) !== type) throw this.error(node, `Expected ${type} expression`); }
  private valueFor(context: RuleContext, path: string): FeatureValue { const [section, property] = path.split(".") as [keyof RuleContext, string]; return context[section][property as never] as FeatureValue; }
  private compare(operator: "==" | "!=" | ">" | ">=" | "<" | "<=", left: boolean | number | string | undefined, right: boolean | number | string | undefined): boolean { if (left === undefined || right === undefined) return false; return operator === "==" ? left === right : operator === "!=" ? left !== right : operator === ">" ? left > right : operator === ">=" ? left >= right : operator === "<" ? left < right : left <= right; }
  private featuresOf(node: ExpressionNode): string[] { if (node.kind === "feature") return [node.path]; if (node.kind === "literal") return []; if (node.kind === "not") return this.featuresOf(node.operand); return [...this.featuresOf(node.left), ...this.featuresOf(node.right)]; }
  private error(node: ExpressionNode, message: string): Error { return new Error(`${message} at ${node.span.line}:${node.span.column}`); }
}