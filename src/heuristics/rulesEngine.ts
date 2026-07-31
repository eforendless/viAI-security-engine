import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisResult, HeuristicFinding } from "../types.js";

type Condition = { field: string; equals?: string | number | boolean; contains?: string; gte?: number };
type RuleExpression = Condition | { all: RuleExpression[] };
type Rule = { id: string; when: RuleExpression; score: number; evidence: string };

export interface HeuristicContext {
  signatureStatus: string;
  signaturePublisher?: string;
  isDownload: boolean;
  isExecutableCandidate: boolean;
  entropy: number;
  packerDetected: boolean;
  suspiciousImportCount: number;
  source?: string;
}

export class RulesEngine {
  constructor(private readonly rules: Rule[]) {}

  static async fromDirectory(directory: string): Promise<RulesEngine> {
    const ruleFiles = ["signatureRules.json", "entropyRules.json", "behaviorRules.json"];
    const ruleSets = await Promise.all(ruleFiles.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8")) as Rule[]));
    return new RulesEngine(ruleSets.flat());
  }

  evaluate(context: HeuristicContext): HeuristicFinding[] {
    return this.rules
      .filter((rule) => matches(rule.when, context))
      .map((rule) => ({ ruleId: rule.id, score: rule.score, evidence: rule.evidence }));
  }
}

export function contextFromAnalysis(analysis: Pick<AnalysisResult, "filePath" | "signatureStatus" | "signaturePublisher" | "metadata" | "entropy" | "packer" | "peMetadata">, source?: string): HeuristicContext {
  return {
    signatureStatus: analysis.signatureStatus,
    signaturePublisher: analysis.signaturePublisher,
    isDownload: /[\\/]downloads([\\/]|$)/i.test(analysis.filePath),
    isExecutableCandidate: analysis.metadata.isExecutableCandidate,
    entropy: analysis.entropy,
    packerDetected: analysis.packer.detected,
    suspiciousImportCount: analysis.peMetadata.suspiciousImports.length,
    source,
  };
}

function matches(expression: RuleExpression, context: HeuristicContext): boolean {
  if ("all" in expression) return expression.all.every((condition) => matches(condition, context));
  const value = context[expression.field as keyof HeuristicContext];
  if (expression.equals !== undefined) return value === expression.equals;
  if (expression.contains !== undefined) return typeof value === "string" && value.includes(expression.contains);
  if (expression.gte !== undefined) return typeof value === "number" && value >= expression.gte;
  return false;
}