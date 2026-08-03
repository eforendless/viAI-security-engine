import { createServer, type Server } from "node:http";
import type { AnalysisPipeline } from "../core/pipeline.js";
import type { AnalysisResult, MonitorObservation } from "../types.js";

export interface MonitoringStatus {
  downloadMonitoring: boolean;
  executableMonitoring: boolean;
  usbMonitoring: boolean;
  executableDirectories: string[];
  executableExtensions: string[];
  excludedFolders: string[];
  excludedFiles: string[];
  excludedExtensions: string[];
  scanUnknownFileTypes: boolean;
  reportCreated: boolean;
  reportModified: boolean;
  processMonitoring: boolean;
  monitorNewProcesses: boolean;
  monitorChildProcesses: boolean;
  monitorSuspiciousCommandLines: boolean;
  monitorPowerShell: boolean;
  monitorCmd: boolean;
  monitorWScript: boolean;
  monitorMshta: boolean;
  excludedProcesses: string[];
  windowsMonitoring: boolean;
  monitorScheduledTasks: boolean;
  monitorRegistryRunKeys: boolean;
  monitorServices: boolean;
  monitorDrivers: boolean;
}

export interface LocalApiOptions {
  getRecentAnalyses?: () => AnalysisResult[];
  getRecentObservations?: () => MonitorObservation[];
  getMonitoringStatus?: () => MonitoringStatus;
  setMonitoringStatus?: (updates: Partial<MonitoringStatus>) => MonitoringStatus;
}

export function createLocalApi(pipeline: AnalysisPipeline, options: LocalApiOptions = {}): Server {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ready", scope: "local-only" }));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/events") {
      const since = Date.parse(requestUrl.searchParams.get("since") ?? "");
      const after = Number.isFinite(since) ? since : Number.NEGATIVE_INFINITY;
      const analyses = (options.getRecentAnalyses?.() ?? []).filter((analysis) => Date.parse(analysis.analyzedAt) > after);
      const observations = (options.getRecentObservations?.() ?? []).filter((observation) => Date.parse(observation.timestamp) > after);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ analyses, observations }));
      return;
    }
    if (request.method === "GET" && request.url === "/monitoring") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(options.getMonitoringStatus?.() ?? {}));
      return;
    }
    if (request.method === "PUT" && request.url === "/monitoring") {
      try {
        const body = await readJsonBody(request);
        const updates = monitoringUpdates(body);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(options.setMonitoringStatus?.(updates) ?? options.getMonitoringStatus?.() ?? {}));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "monitoring update failed" }));
      }
      return;
    }
      if (request.method === "POST" && request.url === "/data/reset") {
        try {
          await pipeline.clearReputation();
          response.writeHead(204).end();
        } catch (error) {
          response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "local data reset failed" }));
        }
        return;
      }
    if (request.method !== "POST" || request.url !== "/analyze") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (typeof body.path !== "string" || body.path.length === 0) throw new Error("'path' must be a non-empty string");
      const source = body.source === "download" || body.source === "filesystem" || body.source === "removable-media" ? body.source : undefined;
      const analysis = await pipeline.analyze(body.path, source);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        riskScore: analysis.finalRiskScore,
        trustScore: analysis.trustScore,
        overallScore: analysis.overallScore,
        confidence: analysis.confidence,
        riskLevel: analysis.riskLevel,
        decision: analysis.decision,
        recommendation: analysis.recommendation,
        evidence: analysis.evidence,
        staticAnalysisReport: analysis.staticAnalysisReport,
        analysis,
      }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "analysis failed" }));
    }
  });
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let content = "";
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 8_192) throw new Error("request body exceeds 8 KiB");
  }
  return JSON.parse(content) as Record<string, unknown>;
}

function monitoringUpdates(body: Record<string, unknown>): Partial<MonitoringStatus> {
  const booleans = ["downloadMonitoring", "executableMonitoring", "usbMonitoring", "scanUnknownFileTypes", "reportCreated", "reportModified", "processMonitoring", "monitorNewProcesses", "monitorChildProcesses", "monitorSuspiciousCommandLines", "monitorPowerShell", "monitorCmd", "monitorWScript", "monitorMshta", "windowsMonitoring", "monitorScheduledTasks", "monitorRegistryRunKeys", "monitorServices", "monitorDrivers"];
  const lists = ["executableDirectories", "executableExtensions", "excludedFolders", "excludedFiles", "excludedExtensions", "excludedProcesses"];
  const updates: Partial<MonitoringStatus> = {};
  for (const key of booleans) if (typeof body[key] === "boolean") (updates as Record<string, unknown>)[key] = body[key];
  for (const key of lists) {
    const value = body[key];
    if (Array.isArray(value) && value.length <= 64 && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 512)) (updates as Record<string, unknown>)[key] = value;
  }
  return updates;
}