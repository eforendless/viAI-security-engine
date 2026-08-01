import { basename, resolve } from "node:path";
import { analyzeEntropy } from "../analyzer/entropyAnalyzer.js";
import { analyzeHashes } from "../analyzer/hashAnalyzer.js";
import { extractMetadata } from "../analyzer/metadataExtractor.js";
import { detectPacker } from "../analyzer/packerDetector.js";
import { analyzePe } from "../analyzer/peAnalyzer.js";
import { analyzeSignature } from "../analyzer/signatureAnalyzer.js";
import { CertificateValidator, FileLocationEvaluator, HashReputationEvaluator, InstallationContextEvaluator, PublisherValidator, RuleEngine, RuleLoader, TrustAssessmentEngine, TrustRegistry, VersionValidator, VrlRuleParser, type TrustedPublisher } from "../../packages/core/src/rules/index.js";
import { createRuleContext } from "./ruleContextFactory.js";
import { createTrustContext } from "./trustContextFactory.js";
import { LocalReputationDatabase } from "../reputation/localDatabase.js";
import type { AnalysisResult, InvestigationDecision, RiskLevel } from "../types.js";

export interface PipelineOptions {
  rulesDirectory: string;
  reputationDatabasePath: string;
  trustedPublishers?: readonly TrustedPublisher[];
  trustAssessmentEngine?: TrustAssessmentEngine;
}

export class AnalysisPipeline {
  private ruleEnginePromise: Promise<RuleEngine>;
  private reputationDatabase: LocalReputationDatabase;
  private trustAssessmentEngine: TrustAssessmentEngine;

  constructor(options: PipelineOptions) {
    this.ruleEnginePromise = loadRuleEngine(options.rulesDirectory);
    this.reputationDatabase = new LocalReputationDatabase(options.reputationDatabasePath);
    this.trustAssessmentEngine = options.trustAssessmentEngine ?? createTrustAssessmentEngine(options.trustedPublishers ?? []);
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
    const trust = await this.trustAssessmentEngine.assess(createTrustContext({ filePath: resolvedPath, hashes, signatureStatus: signature.status, signaturePublisher: signature.publisher }, reputation));
    const staticAnalysisReport = ruleEngine.evaluate(createRuleContext({ ...analysisContext, hashes }, reputation, source), { filePath: resolvedPath, fileType: peMetadata.isPe ? "Windows Portable Executable" : metadataResult.fileType }, trust);
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
      trustScore: staticAnalysisReport.trustScore,
      overallScore: staticAnalysisReport.overallScore,
      confidence: staticAnalysisReport.confidence,
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

function createTrustAssessmentEngine(trustedPublishers: readonly TrustedPublisher[]): TrustAssessmentEngine {
  return new TrustAssessmentEngine(new TrustRegistry([
    new CertificateValidator(),
    new PublisherValidator(trustedPublishers),
    new FileLocationEvaluator(),
    new VersionValidator(),
    new InstallationContextEvaluator(),
    new HashReputationEvaluator(),
  ]));
}