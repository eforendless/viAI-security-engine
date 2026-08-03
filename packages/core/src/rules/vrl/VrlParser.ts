import type { ExpressionNode, ParsedRule, RuleOrigin, SourceSpan } from "../Rule.js";
import type { EvidenceCategory, EvidenceStrength, Recommendation, RuleSeverity } from "../RuleResult.js";
import type { RuleDiagnostic } from "../RuleParser.js";
import { VrlLexer, type VrlToken } from "./VrlLexer.js";

const sections = new Set(["description", "when", "score", "severity", "recommendation", "evidence", "category", "strength", "correlationGroup"]);
const recommendations = new Set<Recommendation>(["ALLOW", "MONITOR", "REVIEW", "DYNAMIC_ANALYSIS", "SANDBOX", "AI_ANALYSIS"]);
const severities = new Set<RuleSeverity>(["low", "medium", "high"]);
const categories = new Set<EvidenceCategory>(["provenance", "execution", "memory", "process-access", "persistence", "network", "packing", "entropy", "pe-structure", "filesystem-context", "baseline", "signature", "reputation"]);
const strengths = new Set<EvidenceStrength>(["informational", "weak", "moderate", "strong", "very-strong"]);

export class VrlParser {
  parse(source: string, origin: RuleOrigin): { rules: ParsedRule[]; diagnostics: RuleDiagnostic[] } {
    try {
      const state = new ParserState(new VrlLexer().lex(source), origin);
      return { rules: [state.parseRule()], diagnostics: [] };
    } catch (error) {
      const failure = error instanceof VrlParseError ? error : new VrlParseError(String(error), { line: 1, column: 1, length: 0 });
      return { rules: [], diagnostics: [{ code: "VRL_PARSE_ERROR", message: failure.message, origin, line: failure.span.line, column: failure.span.column }] };
    }
  }
}

class ParserState {
  private index = 0;
  constructor(private readonly tokens: readonly VrlToken[], private readonly origin: RuleOrigin) {}

  parseRule(): ParsedRule {
    this.skipNewlines();
    this.expectText("rule");
    const id = this.expect("identifier").text;
    this.consumeLine();
    let description: string | undefined;
    let when: ExpressionNode | undefined;
    let score: number | undefined;
    let severity: RuleSeverity = "low";
    let recommendation: Recommendation | undefined;
    let evidence: string | undefined;
    let category: EvidenceCategory | undefined;
    let strength: EvidenceStrength | undefined;
    let correlationGroup: string | undefined;
    while (!this.at("eof")) {
      this.skipNewlines();
      if (this.at("eof")) break;
      const section = this.expect("keyword").text;
      if (!sections.has(section)) this.fail(`Unexpected section '${section}'`);
      if (section === "description") { description = this.readLine(); continue; }
      if (section === "when") { this.consumeLine(); when = this.parseExpression(); this.consumeLine(); continue; }
      if (section === "score") { score = Number(this.readValue()); continue; }
      if (section === "severity") { const value = this.readValue(); if (!severities.has(value as RuleSeverity)) this.fail(`Invalid severity '${value}'`); severity = value as RuleSeverity; continue; }
      if (section === "recommendation") { const value = this.readValue(); if (!recommendations.has(value as Recommendation)) this.fail(`Invalid recommendation '${value}'`); recommendation = value as Recommendation; continue; }
      if (section === "category") { const value = this.readValue(); if (!categories.has(value as EvidenceCategory)) this.fail(`Invalid category '${value}'`); category = value as EvidenceCategory; continue; }
      if (section === "strength") { const value = this.readValue(); if (!strengths.has(value as EvidenceStrength)) this.fail(`Invalid strength '${value}'`); strength = value as EvidenceStrength; continue; }
      if (section === "correlationGroup") { correlationGroup = this.readValue(); continue; }
      evidence = this.readValue();
    }
    if (!when) this.fail("Rule requires a when expression");
    if (score === undefined || !Number.isFinite(score)) this.fail("Rule requires a numeric score");
    if (!evidence) this.fail("Rule requires evidence");
    return { id, description, when, score, severity, recommendation, evidence, category, strength, correlationGroup, origin: this.origin };
  }

  private parseExpression(): ExpressionNode { return this.parseOr(); }
  private parseOr(): ExpressionNode {
    let left = this.parseAnd();
    while (this.matchText("or")) { const right = this.parseAnd(); left = { kind: "logical", operator: "or", left, right, span: left.span }; }
    return left;
  }
  private parseAnd(): ExpressionNode {
    let left = this.parseUnary();
    while (this.matchText("and")) { const right = this.parseUnary(); left = { kind: "logical", operator: "and", left, right, span: left.span }; }
    return left;
  }
  private parseUnary(): ExpressionNode {
    if (this.match("bang")) { const token = this.previous(); return { kind: "not", operand: this.parseUnary(), span: token.span }; }
    if (this.match("leftParen")) { const expression = this.parseExpression(); this.expect("rightParen"); return expression; }
    const left = this.parseValue();
    if (this.matchText("contains")) return { kind: "contains", left, right: this.parseValue(), span: left.span };
    if (this.at("operator")) { const operator = this.advance().text as "==" | "!=" | ">" | ">=" | "<" | "<="; return { kind: "comparison", operator, left, right: this.parseValue(), span: left.span }; }
    return left;
  }
  private parseValue(): ExpressionNode {
    const token = this.advance();
    if (token.kind === "number") return { kind: "literal", value: Number(token.text), span: token.span };
    if (token.kind === "string") return { kind: "literal", value: token.text, span: token.span };
    if (token.text === "true" || token.text === "false") return { kind: "literal", value: token.text === "true", span: token.span };
    if (token.kind === "identifier") return { kind: "feature", path: token.text, span: token.span };
    this.fail(`Expected a value, found '${token.text}'`, token.span);
  }
  private readLine(): string { this.skipNewlines(); const values: string[] = []; while (!this.at("newline") && !this.at("eof")) values.push(this.advance().text); this.consumeLine(); return values.join(" "); }
  private readValue(): string { this.skipNewlines(); const value = this.advance().text; this.consumeLine(); return value; }
  private consumeLine(): void { if (this.at("newline")) this.advance(); }
  private skipNewlines(): void { while (this.at("newline")) this.advance(); }
  private match(kind: VrlToken["kind"]): boolean { if (!this.at(kind)) return false; this.advance(); return true; }
  private matchText(text: string): boolean { this.skipNewlines(); if (!this.atText(text)) return false; this.advance(); this.skipNewlines(); return true; }
  private expect(kind: VrlToken["kind"]): VrlToken { if (!this.at(kind)) this.fail(`Expected ${kind}, found '${this.current().text}'`); return this.advance(); }
  private expectText(text: string): VrlToken { if (!this.atText(text)) this.fail(`Expected '${text}', found '${this.current().text}'`); return this.advance(); }
  private at(kind: VrlToken["kind"]): boolean { return this.current().kind === kind; }
  private atText(text: string): boolean { return this.current().text === text; }
  private current(): VrlToken { return this.tokens[this.index]!; }
  private previous(): VrlToken { return this.tokens[this.index - 1]!; }
  private advance(): VrlToken { return this.tokens[this.index++]!; }
  private fail(message: string, span = this.current().span): never { throw new VrlParseError(message, span); }
}

class VrlParseError extends Error { constructor(message: string, readonly span: SourceSpan) { super(message); } }