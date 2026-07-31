import { homedir } from "node:os";
import { join } from "node:path";
import { createLocalApi, type MonitoringStatus } from "./api/localApi.js";
import { EventManager } from "./core/eventManager.js";
import { AnalysisPipeline } from "./core/pipeline.js";
import { DownloadMonitor } from "./watcher/downloadMonitor.js";
import { ExecutableMonitor } from "./watcher/executableMonitor.js";
import { UsbMonitor } from "./watcher/usbMonitor.js";

const root = process.cwd();
const pipeline = new AnalysisPipeline({
  rulesDirectory: join(root, "rules"),
  reputationDatabasePath: join(root, "database", "reputation.json"),
});
const eventManager = new EventManager(pipeline);
const downloadMonitor = new DownloadMonitor(eventManager);
const usbMonitor = new UsbMonitor(eventManager);
const executableMonitor = new ExecutableMonitor(eventManager);
const executableDirectories = [join(homedir(), "Desktop"), join(homedir(), "Documents")];
const recentAnalyses: import("./types.js").AnalysisResult[] = [];
let monitoring: MonitoringStatus = { downloadMonitoring: true, executableMonitoring: true, usbMonitoring: true };

eventManager.on("analysis-complete", (analysis) => {
  recentAnalyses.unshift(analysis);
  recentAnalyses.splice(500);
  console.log(JSON.stringify({ event: "analysis-complete", path: analysis.filePath, riskScore: analysis.finalRiskScore, decision: analysis.decision }));
});
eventManager.on("analysis-error", (error, event) => console.error("analysis error", { path: event.path, error: String(error) }));

function applyMonitoring(): void {
  if (monitoring.downloadMonitoring) downloadMonitor.start();
  else downloadMonitor.stop();
  if (monitoring.executableMonitoring) executableMonitor.watchDirectories(executableDirectories);
  else executableMonitor.stop();
  if (monitoring.usbMonitoring) usbMonitor.start();
  else usbMonitor.stop();
}

function setMonitoringStatus(updates: Partial<MonitoringStatus>): MonitoringStatus {
  monitoring = { ...monitoring, ...updates };
  applyMonitoring();
  return monitoring;
}

applyMonitoring();

const port = Number(process.env.VIAI_PORT ?? 4117);
createLocalApi(pipeline, {
  getRecentAnalyses: () => recentAnalyses,
  getMonitoringStatus: () => monitoring,
  setMonitoringStatus,
}).listen(port, "127.0.0.1", () => console.log(`viAI Local Security Engine listening on http://127.0.0.1:${port}`));