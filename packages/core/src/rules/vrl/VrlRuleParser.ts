import type { ParseResult, RuleParser } from "../RuleParser.js";
import type { RuleOrigin } from "../Rule.js";
import { VrlParser } from "./VrlParser.js";

export class VrlRuleParser implements RuleParser {
  readonly extension = ".vrl";
  parse(source: string, origin: RuleOrigin): ParseResult {
    return new VrlParser().parse(source, origin);
  }
}