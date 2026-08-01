import { homedir } from "node:os";
import { join } from "node:path";
import { createLocalApi, type MonitoringStatus } from "./api/localApi.js";
import { EventManager } from "./core/eventManager.js";
import { AnalysisPipeline } from "./core/pipeline.js";
import { loadTrustedPublishers } from "./core/trustedPublisherConfig.js";
import { DownloadMonitor } from "./watcher/downloadMonitor.js";
import { ExecutableMonitor, type FileMonitorPolicy } from "./watcher/executableMonitor.js";
import { ProcessMonitor } from "./watcher/processMonitor.js";
import { UsbMonitor } from "./watcher/usbMonitor.js";
import { WindowsConfigurationMonitor } from "./watcher/windowsConfigurationMonitor.js";

const root = process.cwd();
const trustedPublishers = await loadTrustedPublishers(join(root, "database", "trusted-publishers.json"));
const pipeline = new AnalysisPipeline({
  rulesDirectory: join(root, "rules"),
  reputationDatabasePath: join(root, "database", "reputation.json"),
  trustedPublishers,
});
const eventManager = new EventManager(pipeline);
const downloadMonitor = new DownloadMonitor(eventManager);
const usbMonitor = new UsbMonitor(eventManager);
const executableMonitor = new ExecutableMonitor(eventManager);
const processMonitor = new ProcessMonitor(eventManager);
const windowsConfigurationMonitor = new WindowsConfigurationMonitor(eventManager);
const executableDirectories = [join(homedir(), "Desktop"), join(homedir(), "Documents")];
const recentAnalyses: import("./types.js").AnalysisResult[] = [];
const deviceSecurityManaged = process.env.VIAI_DEVICE_SECURITY === "1";
let monitoring: MonitoringStatus = {
  downloadMonitoring: true, executableMonitoring: true, usbMonitoring: !deviceSecurityManaged,
  executableDirectories: [join(homedir(), "Desktop"), join(homedir(), "Documents")],
  executableExtensions: [".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".jar"],
  excludedFolders: [], excludedFiles: [], excludedExtensions: [], scanUnknownFileTypes: false, reportCreated: true, reportModified: true,
  processMonitoring: false, monitorNewProcesses: false, monitorChildProcesses: false, monitorSuspiciousCommandLines: false, monitorPowerShell: false, monitorCmd: false, monitorWScript: false, monitorMshta: false, excludedProcesses: [],
  windowsMonitoring: false, monitorScheduledTasks: false, monitorRegistryRunKeys: false, monitorServices: false, monitorDrivers: false,
};
const recentObservations: import("./types.js").MonitorObservation[] = [];

eventManager.on("analysis-complete", (analysis) => {
  recentAnalyses.unshift(analysis);
  recentAnalyses.splice(500);
  console.log(JSON.stringify({ event: "analysis-complete", path: analysis.filePath, riskScore: analysis.finalRiskScore, decision: analysis.decision }));
});
eventManager.on("analysis-error", (error, event) => console.error("analysis error", { path: event.path, error: String(error) }));
eventManager.on("monitor-observation", (observation: import("./types.js").MonitorObservation) => {
  recentObservations.unshift(observation);
  recentObservations.splice(500);
  console.log(JSON.stringify({ event: "monitor-observation", category: observation.category, detail: observation.detail }));
});

function applyMonitoring(): void {
  const policy: FileMonitorPolicy = {
    extensions: monitoring.executableExtensions,
    excludedFolders: monitoring.excludedFolders,
    excludedFiles: monitoring.excludedFiles,
    excludedExtensions: monitoring.excludedExtensions,
    scanUnknownFileTypes: monitoring.scanUnknownFileTypes,
    reportCreated: monitoring.reportCreated,
    reportModified: monitoring.reportModified,
  };
  if (monitoring.downloadMonitoring) downloadMonitor.start(policy);
  else downloadMonitor.stop();
  if (monitoring.executableMonitoring) executableMonitor.watchDirectories(monitoring.executableDirectories, policy);
  else executableMonitor.stop();
  if (monitoring.usbMonitoring) usbMonitor.start();
  else usbMonitor.stop();
  if (monitoring.processMonitoring) processMonitor.start({ monitorNewProcesses: monitoring.monitorNewProcesses, monitorChildProcesses: monitoring.monitorChildProcesses, monitorSuspiciousCommandLines: monitoring.monitorSuspiciousCommandLines, monitorPowerShell: monitoring.monitorPowerShell, monitorCmd: monitoring.monitorCmd, monitorWScript: monitoring.monitorWScript, monitorMshta: monitoring.monitorMshta, excludedProcesses: monitoring.excludedProcesses });
  else processMonitor.stop();
  if (monitoring.windowsMonitoring) windowsConfigurationMonitor.start({ monitorScheduledTasks: monitoring.monitorScheduledTasks, monitorRegistryRunKeys: monitoring.monitorRegistryRunKeys, monitorServices: monitoring.monitorServices, monitorDrivers: monitoring.monitorDrivers });
  else windowsConfigurationMonitor.stop();
}

function setMonitoringStatus(updates: Partial<MonitoringStatus>): MonitoringStatus {
  monitoring = { ...monitoring, ...updates, usbMonitoring: deviceSecurityManaged ? false : updates.usbMonitoring ?? monitoring.usbMonitoring };
  applyMonitoring();
  return monitoring;
}

applyMonitoring();

const port = Number(process.env.VIAI_PORT ?? 4117);
const server = createLocalApi(pipeline, {
  getRecentAnalyses: () => recentAnalyses,
  getRecentObservations: () => recentObservations,
  getMonitoringStatus: () => monitoring,
  setMonitoringStatus,
}).listen(port, "127.0.0.1", () => console.log(`viAI Local Security Engine listening on http://127.0.0.1:${port}`));

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  downloadMonitor.stop();
  executableMonitor.stop();
  usbMonitor.stop();
  processMonitor.stop();
  windowsConfigurationMonitor.stop();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);