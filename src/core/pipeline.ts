import { basename, resolve } from "node:path";
import { CertificateValidator, FileLocationEvaluator, HashReputationEvaluator, InstallationContextEvaluator, PublisherValidator, RuleEngine, RuleLoader, TrustAssessmentEngine, TrustRegistry, VersionValidator, VrlRuleParser, type TrustedPublisher } from "../../packages/core/src/rules/index.js";
import { createDefaultEvidenceExtractionPipeline } from "../evidence/defaultEvidenceCollectors.js";
import { type EvidenceExtractionPipeline, type EvidencePipelineEvent } from "../evidence/evidenceExtractionPipeline.js";
import { createRuleContextFromEvidence } from "./ruleContextFactory.js";
import { createTrustContextFromEvidence } from "./trustContextFactory.js";
import { StaticEvidenceTrustEvaluator } from "./staticEvidenceTrustEvaluator.js";
import { LocalReputationDatabase } from "../reputation/localDatabase.js";
import { ReportBuilder } from "../report/reportBuilder.js";
import type { AnalysisResult, InvestigationDecision, RiskLevel } from "../types.js";

export interface PipelineOptions {
  rulesDirectory: string;
  reputationDatabasePath: string;
  trustedPublishers?: readonly TrustedPublisher[];
  trustAssessmentEngine?: TrustAssessmentEngine;
  evidencePipeline?: EvidenceExtractionPipeline;
}

export class AnalysisPipeline {
  private ruleEnginePromise: Promise<RuleEngine>;
  private reputationDatabase: LocalReputationDatabase;
  private trustAssessmentEngine: TrustAssessmentEngine;
  private reportBuilder = new ReportBuilder();
  private evidencePipeline: EvidenceExtractionPipeline;

  constructor(options: PipelineOptions) {
    this.ruleEnginePromise = loadRuleEngine(options.rulesDirectory);
    this.reputationDatabase = new LocalReputationDatabase(options.reputationDatabasePath);
    this.trustAssessmentEngine = options.trustAssessmentEngine ?? createTrustAssessmentEngine(options.trustedPublishers ?? []);
    this.evidencePipeline = options.evidencePipeline ?? createDefaultEvidenceExtractionPipeline();
  }

  onEvidenceEvent(listener: (event: EvidencePipelineEvent) => void): () => void {
    return this.evidencePipeline.onEvent(listener);
  }

  async analyze(filePath: string, source?: "download" | "filesystem" | "removable-media"): Promise<AnalysisResult> {
    const resolvedPath = resolve(filePath);
    const evidenceStore = await this.evidencePipeline.extract(resolvedPath, source);
    const hashes = requireEvidence(evidenceStore.hashes, "hashes");
    const metadata = requireEvidence(evidenceStore.metadata, "metadata");
    const fileSystemEvidence = requireEvidence(evidenceStore.fileSystem, "filesystem evidence");
    const entropy = requireEvidence(evidenceStore.entropy, "entropy");
    const peMetadata = requireEvidence(evidenceStore.portableExecutable, "Portable Executable metadata");
    const signature = requireEvidence(evidenceStore.signature, "signature");
    const packer = requireEvidence(evidenceStore.packer, "packer evidence");
    const [ruleEngine, reputation] = await Promise.all([
      this.ruleEnginePromise,
      this.reputationDatabase.lookup(hashes.sha256),
    ]);
    const analysisContext = {
      filePath: resolvedPath,
      signatureStatus: signature.status,
      signaturePublisher: signature.publisher,
      metadata,
      entropy,
      packer,
      peMetadata,
    };
    const trust = await this.trustAssessmentEngine.assess(createTrustContextFromEvidence(evidenceStore, reputation));
    const fileType = peMetadata.isPe ? "Windows Portable Executable" : evidenceStore.file.fileType ?? "unknown";
    const staticAnalysisReport = ruleEngine.evaluate(createRuleContextFromEvidence(evidenceStore, reputation), { filePath: resolvedPath, fileType }, trust);
    const heuristicFindings = staticAnalysisReport.matchedRules.map((result) => ({ ruleId: result.id, score: result.score, evidence: result.evidence }));
    const riskLevel = toRiskLevel(staticAnalysisReport.riskScore);
    const decision = toDecision(staticAnalysisReport.recommendation);
    const report = this.reportBuilder.buildFromEvidence(evidenceStore, riskLevel, staticAnalysisReport);
    await this.reputationDatabase.recordSeen(hashes.sha256, basename(resolvedPath));

    return {
      filePath: resolvedPath,
      analyzedAt: new Date().toISOString(),
      hashes,
      fileType,
      metadata,
      fileSystemEvidence,
      signatureStatus: signature.status,
      signaturePublisher: signature.publisher,
      digitalSignature: signature.details,
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
      report,
      evidenceStore,
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
    new StaticEvidenceTrustEvaluator(),
  ]));
}

function requireEvidence<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Evidence extraction did not produce ${label}`);
  return value;
}