import { basename, dirname, resolve } from "node:path";
import { CertificateValidator, FileLocationEvaluator, HashReputationEvaluator, InstallationContextEvaluator, PublisherValidator, RuleEngine, RuleLoader, TrustAssessmentEngine, TrustRegistry, VersionValidator, VrlRuleParser, type TrustedPublisher } from "../../packages/core/src/rules/index.js";
import { createDefaultEvidenceExtractionPipeline } from "../evidence/defaultEvidenceCollectors.js";
import { type EvidenceExtractionPipeline, type EvidencePipelineEvent } from "../evidence/evidenceExtractionPipeline.js";
import { createRuleContextFromEvidence } from "./ruleContextFactory.js";
import { createTrustContextFromEvidence } from "./trustContextFactory.js";
import { StaticEvidenceTrustEvaluator } from "./staticEvidenceTrustEvaluator.js";
import { LocalBaselineStore, type BaselineIdentity } from "../baseline/localBaselineStore.js";
import type { AssessmentEvidenceQuality } from "../../packages/core/src/rules/RuleResult.js";
import { LocalReputationDatabase } from "../reputation/localDatabase.js";
import { ReportBuilder } from "../report/reportBuilder.js";
import { throwIfAborted } from "./cancellation.js";
import type { AnalysisResult, InvestigationDecision, RiskLevel } from "../types.js";

export interface PipelineOptions {
  rulesDirectory: string;
  reputationDatabasePath: string;
  trustedPublishers?: readonly TrustedPublisher[];
  trustAssessmentEngine?: TrustAssessmentEngine;
  evidencePipeline?: EvidenceExtractionPipeline;
  baselineDatabasePath?: string;
  baselineStore?: LocalBaselineStore;
  maxConcurrentAnalyses?: number;
}

export class AnalysisPipeline {
  private ruleEnginePromise: Promise<RuleEngine>;
  private reputationDatabase: LocalReputationDatabase;
  private trustAssessmentEngine: TrustAssessmentEngine;
  private reportBuilder = new ReportBuilder();
  private evidencePipeline: EvidenceExtractionPipeline;
  private baselineStore: LocalBaselineStore;
  private analysisLimiter: AnalysisLimiter;

  constructor(options: PipelineOptions) {
    this.ruleEnginePromise = loadRuleEngine(options.rulesDirectory);
    this.reputationDatabase = new LocalReputationDatabase(options.reputationDatabasePath);
    this.trustAssessmentEngine = options.trustAssessmentEngine ?? createTrustAssessmentEngine(options.trustedPublishers ?? []);
    this.evidencePipeline = options.evidencePipeline ?? createDefaultEvidenceExtractionPipeline();
    this.baselineStore = options.baselineStore ?? new LocalBaselineStore(options.baselineDatabasePath ?? options.reputationDatabasePath);
    this.analysisLimiter = new AnalysisLimiter(options.maxConcurrentAnalyses ?? 2);
  }

  async clearReputation(): Promise<void> { await this.reputationDatabase.clear(); }
  async clearLocalSecurityData(): Promise<void> { await Promise.all([this.reputationDatabase.clear(), this.baselineStore.clear()]); }
  close(): void { this.reputationDatabase.close(); this.baselineStore.close(); }

  onEvidenceEvent(listener: (event: EvidencePipelineEvent) => void): () => void {
    return this.evidencePipeline.onEvent(listener);
  }

  async analyze(filePath: string, source?: "download" | "filesystem" | "removable-media", signal?: AbortSignal): Promise<AnalysisResult> {
    return this.analysisLimiter.run(() => this.analyzeFile(filePath, source, signal), signal);
  }

  private async analyzeFile(filePath: string, source?: "download" | "filesystem" | "removable-media", signal?: AbortSignal): Promise<AnalysisResult> {
    throwIfAborted(signal);
    const resolvedPath = resolve(filePath);
    const evidenceStore = await this.evidencePipeline.extract(resolvedPath, source, signal);
    throwIfAborted(signal);
    const hashes = requireEvidence(evidenceStore.hashes, "hashes");
    const metadata = requireEvidence(evidenceStore.metadata, "metadata");
    const fileSystemEvidence = requireEvidence(evidenceStore.fileSystem, "filesystem evidence");
    const entropy = requireEvidence(evidenceStore.entropy, "entropy");
    const peMetadata = requireEvidence(evidenceStore.portableExecutable, "Portable Executable metadata");
    const signature = requireEvidence(evidenceStore.signature, "signature");
    const packer = requireEvidence(evidenceStore.packer, "packer evidence");
    const baselineIdentity = createBaselineIdentity(evidenceStore);
    const [ruleEngine, reputation, baseline] = await Promise.all([
      this.ruleEnginePromise,
      this.reputationDatabase.lookup(hashes.sha256),
      this.baselineStore.evaluate(baselineIdentity),
    ]);
    throwIfAborted(signal);
    const analysisContext = {
      filePath: resolvedPath,
      signatureStatus: signature.status,
      signaturePublisher: signature.publisher,
      metadata,
      entropy,
      packer,
      peMetadata,
    };
    const trust = await this.trustAssessmentEngine.assess(createTrustContextFromEvidence(evidenceStore, reputation, baseline));
    throwIfAborted(signal);
    const fileType = peMetadata.isPe ? "Windows Portable Executable" : evidenceStore.file.fileType ?? "unknown";
    const staticAnalysisReport = ruleEngine.evaluate(createRuleContextFromEvidence(evidenceStore, reputation, baseline), { filePath: resolvedPath, fileType, baseline }, trust, evidenceQuality(evidenceStore));
    const heuristicFindings = staticAnalysisReport.matchedRules.map((result) => ({ ruleId: result.id, score: result.score, evidence: result.evidence }));
    const riskLevel = toRiskLevel(staticAnalysisReport.riskScore);
    const decision = toDecision(staticAnalysisReport.recommendation);
    const report = this.reportBuilder.buildFromEvidence(evidenceStore, riskLevel, staticAnalysisReport, baseline, { engineVersion: "0.3.5", ruleSetVersion: "0.3", trustPolicyVersion: "0.3" });
    throwIfAborted(signal);
    await Promise.all([
      this.reputationDatabase.recordSeen(hashes.sha256, basename(resolvedPath)),
      this.baselineStore.record(baselineIdentity, { engineVersion: "0.3.5", ruleSetVersion: "0.3", trustPolicyVersion: "0.3" }),
    ]);

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
      baseline,
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

class AnalysisLimiter {
  private active = 0;
  private readonly waiting: Array<{ resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; onAbort?: () => void }> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    if (this.active >= this.maximum) await new Promise<void>((resolve, reject) => {
      const entry = { resolve: () => { signal?.removeEventListener("abort", entry.onAbort!); resolve(); }, reject, signal, onAbort: () => { this.waiting.splice(this.waiting.indexOf(entry), 1); reject(signal?.reason instanceof Error ? signal.reason : new Error("Operation cancelled")); } };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.waiting.push(entry);
    });
    throwIfAborted(signal);
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.resolve();
    }
  }
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

function createBaselineIdentity(evidence: import("../types.js").EvidenceStore): BaselineIdentity {
  const hashes = requireEvidence(evidence.hashes, "hashes");
  const metadata = requireEvidence(evidence.metadata, "metadata");
  const signature = requireEvidence(evidence.signature, "signature");
  const portableExecutable = requireEvidence(evidence.portableExecutable, "Portable Executable metadata");
  return {
    filePath: evidence.file.path,
    hash: hashes.sha256,
    size: metadata.size,
    fileType: portableExecutable.isPe ? "Windows Portable Executable" : (evidence.file.fileType ?? metadata.extension ?? "unknown"),
    signatureState: signature.details.verificationState,
    signer: signature.details.certificateThumbprint ?? signature.publisher,
    pe: { machine: portableExecutable.machine, subsystem: portableExecutable.subsystem, parseStatus: portableExecutable.parseStatus },
  };
}

function evidenceQuality(evidence: import("../types.js").EvidenceStore): AssessmentEvidenceQuality {
  return {
    collectorFailures: evidence.processingMetadata.collectors.filter((collector) => collector.status === "failed").length,
    peParseStatus: evidence.portableExecutable?.parseStatus,
    snapshotTruncated: evidence.warnings.some((warning) => warning.startsWith("Inspection was limited to the first ")),
    signatureState: evidence.signature?.details.verificationState,
  };
}