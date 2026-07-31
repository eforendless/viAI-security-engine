import type { ParsedRule, RuleOrigin } from "./Rule.js";

export interface RuleDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly origin: RuleOrigin;
  readonly line?: number;
  readonly column?: number;
}

export interface ParseResult {
  readonly rules: readonly ParsedRule[];
  readonly diagnostics: readonly RuleDiagnostic[];
}

export interface RuleParser {
  readonly extension: string;
  parse(source: string, origin: RuleOrigin): ParseResult;
}