import { createServer, type Server } from "node:http";
import type { AnalysisPipeline } from "../core/pipeline.js";
import type { AnalysisResult } from "../types.js";

export interface MonitoringStatus {
  downloadMonitoring: boolean;
  executableMonitoring: boolean;
  usbMonitoring: boolean;
}

export interface LocalApiOptions {
  getRecentAnalyses?: () => AnalysisResult[];
  getMonitoringStatus?: () => MonitoringStatus;
  setMonitoringStatus?: (updates: Partial<MonitoringStatus>) => MonitoringStatus;
}

export function createLocalApi(pipeline: AnalysisPipeline, options: LocalApiOptions = {}): Server {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ready", scope: "local-only" }));
      return;
    }
    if (request.method === "GET" && request.url === "/events") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ analyses: options.getRecentAnalyses?.() ?? [] }));
      return;
    }
    if (request.method === "GET" && request.url === "/monitoring") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(options.getMonitoringStatus?.() ?? {}));
      return;
    }
    if (request.method === "PUT" && request.url === "/monitoring") {
      try {
        const body = await readJsonBody(request);
        const updates = Object.fromEntries(Object.entries(body).filter(([key, value]) => ["downloadMonitoring", "executableMonitoring", "usbMonitoring"].includes(key) && typeof value === "boolean")) as Partial<MonitoringStatus>;
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(options.setMonitoringStatus?.(updates) ?? options.getMonitoringStatus?.() ?? {}));
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "monitoring update failed" }));
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
      const analysis = await pipeline.analyze(body.path);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        riskScore: analysis.finalRiskScore,
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