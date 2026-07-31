import type { EngineAnalysis, EngineResponse } from "../types";

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

export interface MonitoringStatus {
  downloadMonitoring: boolean;
  executableMonitoring: boolean;
  usbMonitoring: boolean;
}

export async function getEngineEvents(): Promise<EngineAnalysis[]> {
  if (window.viai) return window.viai.engineEvents() as Promise<EngineAnalysis[]>;
  const response = await fetch("/engine/events");
  if (!response.ok) throw new Error("The local security engine did not return monitoring events.");
  const body = await response.json() as { analyses?: EngineAnalysis[] };
  return body.analyses ?? [];
}

export async function getMonitoringStatus(): Promise<MonitoringStatus> {
  if (window.viai) return window.viai.monitoringStatus() as Promise<MonitoringStatus>;
  const response = await fetch("/engine/monitoring");
  if (!response.ok) throw new Error("The local security engine did not return monitoring settings.");
  return response.json() as Promise<MonitoringStatus>;
}

export async function updateMonitoring(updates: Partial<MonitoringStatus>): Promise<MonitoringStatus> {
  if (window.viai) return window.viai.setMonitoring(updates as Record<string, boolean>) as Promise<MonitoringStatus>;
  const response = await fetch("/engine/monitoring", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(updates) });
  if (!response.ok) throw new Error("The local security engine did not accept the monitoring update.");
  return response.json() as Promise<MonitoringStatus>;
}