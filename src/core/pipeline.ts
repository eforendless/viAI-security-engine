import { basename, resolve } from "node:path";
import { analyzeEntropy } from "../analyzer/entropyAnalyzer.js";
import { analyzeHashes } from "../analyzer/hashAnalyzer.js";
import { extractMetadata } from "../analyzer/metadataExtractor.js";
import { detectPacker } from "../analyzer/packerDetector.js";
import { analyzePe } from "../analyzer/peAnalyzer.js";
import { analyzeSignature } from "../analyzer/signatureAnalyzer.js";
import { RuleEngine, RuleLoader, VrlRuleParser } from "../../packages/core/src/rules/index.js";
import { createRuleContext } from "./ruleContextFactory.js";
import { LocalReputationDatabase } from "../reputation/localDatabase.js";
import type { AnalysisResult, InvestigationDecision, RiskLevel } from "../types.js";

export interface PipelineOptions {
  rulesDirectory: string;
  reputationDatabasePath: string;
}

export class AnalysisPipeline {
  private ruleEnginePromise: Promise<RuleEngine>;
  private reputationDatabase: LocalReputationDatabase;

  constructor(options: PipelineOptions) {
    this.ruleEnginePromise = loadRuleEngine(options.rulesDirectory);
    this.reputationDatabase = new LocalReputationDatabase(options.reputationDatabasePath);
  }

  async analyze(filePath: string, source?: "download" | "filesystem" | "removable-media"): Promise<AnalysisResult> {
    const resolvedPath = resolve(filePath);
    const [hashes, metadataResult, entropy, peMetadata, signature] = await Promise.all([
      analyzeHashes(resolvedPath),
      extractMetadata(resolvedPath),
      analyzeEntropy(resolvedPath),
      analyzePe(resolvedPath),
      analyzeSignature(resolvedPath),
    ]);
    const [ruleEngine, reputation] = await Promise.all([
      this.ruleEnginePromise,
      this.reputationDatabase.lookup(hashes.sha256),
    ]);
    const packer = detectPacker(peMetadata);
    const analysisContext = {
      filePath: resolvedPath,
      signatureStatus: signature.status,
      signaturePublisher: signature.publisher,
      metadata: metadataResult.metadata,
      entropy,
      packer,
      peMetadata,
    };
    const staticAnalysisReport = ruleEngine.evaluate(createRuleContext({ ...analysisContext, hashes }, reputation, source), { filePath: resolvedPath, fileType: peMetadata.isPe ? "Windows Portable Executable" : metadataResult.fileType });
    const heuristicFindings = staticAnalysisReport.matchedRules.map((result) => ({ ruleId: result.id, score: result.score, evidence: result.evidence }));
    const riskLevel = toRiskLevel(staticAnalysisReport.riskScore);
    const decision = toDecision(staticAnalysisReport.recommendation);
    await this.reputationDatabase.recordSeen(hashes.sha256, basename(resolvedPath));

    return {
      filePath: resolvedPath,
      analyzedAt: new Date().toISOString(),
      hashes,
      fileType: peMetadata.isPe ? "Windows Portable Executable" : metadataResult.fileType,
      metadata: metadataResult.metadata,
      signatureStatus: signature.status,
      signaturePublisher: signature.publisher,
      entropy,
      packer,
      peMetadata,
      heuristicScore: heuristicFindings.reduce((total, finding) => total + finding.score, 0),
      reputationScore: reputation.score,
      finalRiskScore: staticAnalysisReport.riskScore,
      riskLevel,
      decision,
      recommendation: staticAnalysisReport.recommendation,
      evidence: unique([
        ...staticAnalysisReport.indicators,
      ]),
      heuristicFindings,
      staticAnalysisReport,
    };
  }
}

async function loadRuleEngine(directory: string): Promise<RuleEngine> {
  const engine = new RuleEngine(new RuleLoader([new VrlRuleParser()]));
  await engine.load(directory);
  return engine;
}

function toRiskLevel(score: number): RiskLevel { return score <= 25 ? "low" : score <= 60 ? "medium" : "high"; }
function toDecision(recommendation: string): InvestigationDecision { return recommendation === "ALLOW" ? "no_further_investigation" : recommendation === "AI_ANALYSIS" ? "investigate_urgent" : "investigate"; }

function unique(values: string[]): string[] {
  return [...new Set(values)];
}