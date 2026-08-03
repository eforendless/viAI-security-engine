import type { RuleContext } from "./RuleContext.js";
import type { Recommendation, RuleResult, RuleSeverity } from "./RuleResult.js";
import type { EvidenceCategory, EvidenceStrength } from "./RuleResult.js";

export interface SourceSpan {
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

export interface RuleOrigin {
  readonly path: string;
}

export type LiteralValue = boolean | number | string;

export type ExpressionNode =
  | { readonly kind: "literal"; readonly value: LiteralValue; readonly span: SourceSpan }
  | { readonly kind: "feature"; readonly path: string; readonly span: SourceSpan }
  | { readonly kind: "not"; readonly operand: ExpressionNode; readonly span: SourceSpan }
  | { readonly kind: "logical"; readonly operator: "and" | "or"; readonly left: ExpressionNode; readonly right: ExpressionNode; readonly span: SourceSpan }
  | { readonly kind: "comparison"; readonly operator: "==" | "!=" | ">" | ">=" | "<" | "<="; readonly left: ExpressionNode; readonly right: ExpressionNode; readonly span: SourceSpan }
  | { readonly kind: "contains"; readonly left: ExpressionNode; readonly right: ExpressionNode; readonly span: SourceSpan };

export interface ParsedRule {
  readonly id: string;
  readonly description?: string;
  readonly when: ExpressionNode;
  readonly score: number;
  readonly severity: RuleSeverity;
  readonly recommendation?: Recommendation;
  readonly evidence: string;
  readonly category?: EvidenceCategory;
  readonly strength?: EvidenceStrength;
  readonly correlationGroup?: string;
  readonly origin: RuleOrigin;
}

export interface CompiledRule {
  readonly id: string;
  readonly origin: RuleOrigin;
  readonly referencedFeatures: readonly string[];
  evaluate(context: RuleContext): RuleResult;
}