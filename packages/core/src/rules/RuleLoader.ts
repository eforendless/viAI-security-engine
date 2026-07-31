import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { RuleCompiler } from "./RuleCompiler.js";
import type { CompiledRule } from "./Rule.js";
import type { RuleDiagnostic, RuleParser } from "./RuleParser.js";

export class RuleLoadError extends Error {
  constructor(readonly diagnostics: readonly RuleDiagnostic[]) {
    super(diagnostics.map((diagnostic) => `${diagnostic.origin.path}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0} ${diagnostic.message}`).join("\n"));
  }
}

export class RuleLoader {
  private readonly parsers: ReadonlyMap<string, RuleParser>;

  constructor(parsers: readonly RuleParser[], private readonly compiler = new RuleCompiler()) {
    this.parsers = new Map(parsers.map((parser) => [parser.extension.toLowerCase(), parser]));
  }

  async load(directory: string): Promise<readonly CompiledRule[]> {
    const files = await this.findRuleFiles(directory);
    const compiled: CompiledRule[] = [];
    const diagnostics: RuleDiagnostic[] = [];
    for (const path of files) {
      const parser = this.parsers.get(extname(path).toLowerCase());
      if (!parser) continue;
      const parsed = parser.parse(await readFile(path, "utf8"), { path });
      diagnostics.push(...parsed.diagnostics);
      if (parsed.diagnostics.length === 0) {
        for (const rule of parsed.rules) {
          try { compiled.push(this.compiler.compile(rule)); }
          catch (error) { diagnostics.push({ code: "RULE_COMPILE_ERROR", message: error instanceof Error ? error.message : String(error), origin: rule.origin }); }
        }
      }
    }
    if (diagnostics.length > 0) throw new RuleLoadError(diagnostics);
    return compiled;
  }

  private async findRuleFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return this.findRuleFiles(path);
      return this.parsers.has(extname(entry.name).toLowerCase()) ? [path] : [];
    }));
    return nested.flat().sort();
  }
}