import { basename, resolve } from "node:path";
import { analyzeEntropy } from "../analyzer/entropyAnalyzer.js";
import { analyzeHashes } from "../analyzer/hashAnalyzer.js";
import { extractMetadata } from "../analyzer/metadataExtractor.js";
import { detectPacker } from "../analyzer/packerDetector.js";
import { analyzePe } from "../analyzer/peAnalyzer.js";
import { analyzeSignature } from "../analyzer/signatureAnalyzer.js";
import { contextFromAnalysis, RulesEngine } from "../heuristics/rulesEngine.js";
import { LocalReputationDatabase } from "../reputation/localDatabase.js";
import { assessRisk } from "../scoring/riskEngine.js";
import type { AnalysisResult } from "../types.js";

export interface PipelineOptions {
  rulesDirectory: string;
  reputationDatabasePath: string;
}

export class AnalysisPipeline {
  private rulesEnginePromise: Promise<RulesEngine>;
  private reputationDatabase: LocalReputationDatabase;

  constructor(options: PipelineOptions) {
    this.rulesEnginePromise = RulesEngine.fromDirectory(options.rulesDirectory);
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
    const [rulesEngine, reputation] = await Promise.all([
      this.rulesEnginePromise,
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
    const heuristicFindings = rulesEngine.evaluate(contextFromAnalysis(analysisContext, source));
    const risk = assessRisk({
      reputationScore: reputation.score,
      signatureStatus: signature.status,
      suspiciousImportCount: peMetadata.suspiciousImports.length,
      entropy,
      packerDetected: packer.detected,
      heuristicFindings,
    });
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
      finalRiskScore: risk.score,
      riskLevel: risk.riskLevel,
      decision: risk.decision,
      recommendation: risk.recommendation,
      evidence: unique([
        ...(signature.evidence ? [signature.evidence] : []),
        ...reputation.evidence,
        ...heuristicFindings.map((finding) => finding.evidence),
        ...packer.reasons,
        ...peMetadata.suspiciousImports.map((api) => `suspicious imported API: ${api}`),
      ]),
      heuristicFindings,
    };
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}