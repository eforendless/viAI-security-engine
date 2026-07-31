import { join } from "node:path";
import { createLocalApi } from "./api/localApi.js";
import { EventManager } from "./core/eventManager.js";
import { AnalysisPipeline } from "./core/pipeline.js";
import { DownloadMonitor } from "./watcher/downloadMonitor.js";
import { UsbMonitor } from "./watcher/usbMonitor.js";

const root = process.cwd();
const pipeline = new AnalysisPipeline({
  rulesDirectory: join(root, "rules"),
  reputationDatabasePath: join(root, "database", "reputation.json"),
});
const eventManager = new EventManager(pipeline);
const downloadMonitor = new DownloadMonitor(eventManager);
const usbMonitor = new UsbMonitor(eventManager);

eventManager.on("analysis-complete", (analysis) => console.log(JSON.stringify({ event: "analysis-complete", path: analysis.filePath, riskScore: analysis.finalRiskScore, decision: analysis.decision })));
eventManager.on("analysis-error", (error, event) => console.error("analysis error", { path: event.path, error: String(error) }));
downloadMonitor.start();
void usbMonitor.scanConnectedDrives();

const port = Number(process.env.VIAI_PORT ?? 4117);
createLocalApi(pipeline).listen(port, "127.0.0.1", () => console.log(`viAI Local Security Engine listening on http://127.0.0.1:${port}`));