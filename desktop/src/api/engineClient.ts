import type { EngineResponse } from "../types";

const endpoint = "/engine/analyze";

export async function analyzeFile(filePath: string): Promise<EngineResponse> {
  if (window.viai) return window.viai.analyzeFile(filePath) as Promise<EngineResponse>;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: filePath }),
  });
  if (!response.ok) throw new Error("The local security engine did not accept this analysis request.");
  return response.json() as Promise<EngineResponse>;
}

export async function probeEngine(): Promise<boolean> {
  if (window.viai) return window.viai.probeEngine();
  try {
    const response = await fetch("/engine/health");
    return response.ok;
  } catch {
    return false;
  }
}