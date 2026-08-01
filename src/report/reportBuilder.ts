import type { StaticAnalysisReport } from "../../packages/core/src/rules/index.js";
import type { EvidenceStore, FileSystemEvidence, PackerFinding, PeMetadata, ProfessionalReport, RiskLevel, SignatureStatus, TrustLevel } from "../types.js";

export interface ReportBuilderInput {
  fileName: string;
  fileType: string;
  riskLevel: RiskLevel;
  signatureStatus: SignatureStatus;
  signaturePublisher?: string;
  entropy: number;
  packer: PackerFinding;
  peMetadata: PeMetadata;
  fileSystemEvidence: FileSystemEvidence;
  staticAnalysisReport: StaticAnalysisReport;
}

export class ReportBuilder {
  buildFromEvidence(evidence: EvidenceStore, riskLevel: RiskLevel, staticAnalysisReport: StaticAnalysisReport): ProfessionalReport {
    const signature = requireEvidence(evidence.signature, "signature");
    return this.build({ fileName: evidence.file.name, fileType: evidence.portableExecutable?.isPe ? "Windows Portable Executable" : evidence.file.fileType ?? "unknown", riskLevel, signatureStatus: signature.status, signaturePublisher: signature.publisher, entropy: requireEvidence(evidence.entropy, "entropy"), packer: requireEvidence(evidence.packer, "packer evidence"), peMetadata: requireEvidence(evidence.portableExecutable, "Portable Executable metadata"), fileSystemEvidence: requireEvidence(evidence.fileSystem, "filesystem evidence"), staticAnalysisReport });
  }

  build(input: ReportBuilderInput): ProfessionalReport {
    const trustIndicators = input.staticAnalysisReport.trustIndicators.map((indicator) => ({
      id: indicator.id,
      category: categoryForIndicator(indicator.id),
      weight: indicator.weight,
      impact: indicator.weight >= 0 ? "positive" as const : "negative" as const,
      reason: indicator.evidence,
    }));
    const riskBreakdown = input.staticAnalysisReport.matchedRules.map((rule) => ({
      id: rule.id,
      category: "static-rule",
      score: rule.score,
      reason: rule.evidence,
      recommendation: rule.recommendation,
    }));
    const warnings = [...input.peMetadata.parseWarnings];
    if (input.signatureStatus === "missing") warnings.push("No Authenticode signature is present.");
    if (input.packer.detected) warnings.push(...input.packer.reasons);
    if (input.fileSystemEvidence.zoneIdentifier) warnings.push(`Windows Zone.Identifier: ${input.fileSystemEvidence.zoneIdentifier.zoneName}.`);
    return {
      schemaVersion: "0.2",
      summary: executiveSummary(input),
      trust: { score: input.staticAnalysisReport.trustScore, level: trustLevel(input.staticAnalysisReport.trustScore), indicators: trustIndicators },
      risk: { score: input.staticAnalysisReport.riskScore, level: input.riskLevel, breakdown: riskBreakdown },
      confidence: { score: input.staticAnalysisReport.confidence, explanation: confidenceExplanation(input) },
      recommendation: input.staticAnalysisReport.recommendation,
      indicators: [...input.staticAnalysisReport.indicators],
      warnings: [...new Set(warnings)],
      fileSystem: input.fileSystemEvidence,
    };
  }
}

function trustLevel(score: number): TrustLevel {
  return score >= 75 ? "high" : score >= 45 ? "established" : score > 0 ? "limited" : "low";
}

function categoryForIndicator(id: string): string {
  if (id.includes("CERTIFICATE")) return "certificate";
  if (id.includes("PUBLISHER")) return "publisher";
  if (id.includes("LOCATION")) return "location";
  if (id.includes("VERSION")) return "version";
  if (id.includes("HASH")) return "reputation";
  return "context";
}

function confidenceExplanation(input: ReportBuilderInput): string[] {
  const reasons = [`${input.staticAnalysisReport.matchedRules.length} static rule${input.staticAnalysisReport.matchedRules.length === 1 ? "" : "s"} matched.`];
  reasons.push(input.peMetadata.isPe ? "Portable Executable structure was inspected." : "No Portable Executable structure was available for inspection.");
  reasons.push("No behavioral, sandbox, or cloud-reputation analysis was used.");
  return reasons;
}

function executiveSummary(input: ReportBuilderInput): string {
  const signature = input.signatureStatus === "trusted" ? `It has a valid local signature${input.signaturePublisher ? ` from ${input.signaturePublisher}` : ""}.` : input.signatureStatus === "missing" ? "It is unsigned." : "Its signature could not be established as trusted.";
  const structure = input.peMetadata.isPe ? "Portable Executable metadata was inspected." : `${input.fileType} structure was inspected where available.`;
  const packing = input.packer.detected ? "Packing indicators were observed." : "No supported packing indicators were observed.";
  return `${input.fileName} received a ${input.riskLevel} static-analysis risk score. ${signature} ${structure} ${packing} viAI recommends ${input.staticAnalysisReport.recommendation} as the next action; static analysis does not determine intent.`;
}

function requireEvidence<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Evidence extraction did not produce ${label}`);
  return value;
}