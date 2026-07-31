import type { HeuristicFinding, InvestigationDecision, RiskLevel, SignatureStatus } from "../types.js";

export interface RiskInput {
  reputationScore: number;
  signatureStatus: SignatureStatus;
  suspiciousImportCount: number;
  entropy: number;
  packerDetected: boolean;
  heuristicFindings: HeuristicFinding[];
}

export interface RiskAssessment {
  score: number;
  riskLevel: RiskLevel;
  decision: InvestigationDecision;
  recommendation: string;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const signatureBase = { trusted: 0, unknown: 20, missing: 65, invalid: 100 }[input.signatureStatus];
  const reputationComponent = clamp(input.reputationScore, 0, 100) * 0.3;
  const signatureComponent = signatureBase * 0.2;
  const peComponent = Math.min(100, input.suspiciousImportCount * 35) * 0.2;
  const entropyComponent = (input.entropy >= 7.2 ? 100 : 0) * 0.1;
  const packerComponent = (input.packerDetected ? 100 : 0) * 0.1;
  const heuristicRaw = input.heuristicFindings.reduce((total, finding) => total + finding.score, 0);
  const heuristicComponent = clamp(heuristicRaw, -50, 100) * 0.1;
  const score = Math.round(clamp(reputationComponent + signatureComponent + peComponent + entropyComponent + packerComponent + heuristicComponent, 0, 100));

  if (score <= 25) {
    return { score, riskLevel: "low", decision: "no_further_investigation", recommendation: "available local evidence does not currently justify deeper investigation" };
  }
  if (score <= 60) {
    return { score, riskLevel: "medium", decision: "investigate", recommendation: "available local evidence justifies deeper investigation" };
  }
  return { score, riskLevel: "high", decision: "investigate_urgent", recommendation: "available local evidence strongly justifies priority investigation" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}