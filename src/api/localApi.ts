import { createServer, type Server } from "node:http";
import type { AnalysisPipeline } from "../core/pipeline.js";

export function createLocalApi(pipeline: AnalysisPipeline): Server {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ready", scope: "local-only" }));
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
        analysis,
      }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : "analysis failed" }));
    }
  });
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<{ path?: unknown }> {
  let content = "";
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 8_192) throw new Error("request body exceeds 8 KiB");
  }
  return JSON.parse(content) as { path?: unknown };
}