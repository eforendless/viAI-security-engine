import type { AnalysisResult, InvestigationClient, SandboxClient } from "../types.js";

export class IntegrationCoordinator {
  constructor(private readonly sandboxClient?: SandboxClient, private readonly investigationClient?: InvestigationClient) {}

  async handoff(analysis: AnalysisResult): Promise<void> {
    if (analysis.report.assessment?.recommendation !== "DYNAMIC_ANALYSIS") return;
    await this.sandboxClient?.submit({ analysis, requestedAt: new Date().toISOString() });
  }

  async notifySandboxComplete(analysis: AnalysisResult): Promise<void> {
    await this.investigationClient?.investigate(analysis);
  }
}