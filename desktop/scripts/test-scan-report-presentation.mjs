import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import typescript from "typescript";

const source = await readFile(join(process.cwd(), "src", "scanReportPresentation.ts"), "utf8");
const compiled = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.ESNext, target: typescript.ScriptTarget.ES2022 } }).outputText;
const presentation = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const report = {
  scanId: "report-fixture-331",
  status: "completed",
  performanceMode: "balanced",
  startedAt: "2026-08-06T15:42:00.000Z",
  endedAt: "2026-08-06T15:43:16.000Z",
  elapsedMs: 76_000,
  discoveredCount: 331,
  processedCount: 331,
  analyzedCount: 29,
  inventoryCount: 302,
  skippedCount: 12,
  safeCount: 302,
  monitorCount: 25,
  investigationCount: 4,
  errorCount: 0,
  completionPercentage: 100,
  target: "Important Windows locations",
};
const model = presentation.presentScanReport(report, new Date("2026-08-06T15:44:00.000Z"));
assert.equal(model.statusLabel, "COMPLETED");
assert.equal(model.durationLabel, "1m 16s");
for (const format of ["html", "pdf", "excel", "json"]) {
  const artifact = presentation.exportScanReport(report, format);
  assert.match(artifact.content, /viAI Security/);
  assert.match(artifact.content, /331/);
  assert.match(artifact.content, /4/);
  assert.match(artifact.content, /1m 16s|76000/);
}
const json = JSON.parse(presentation.exportScanReport(report, "json").content);
assert.equal(json.generatedBy, "viAI Security");
assert.equal(json.scan.status, "completed");
assert.equal(json.summary.processed, 331);
assert.equal(json.assessmentSummary.needsInvestigation, 4);

const cancelled = presentation.presentScanReport({ ...report, status: "cancelled", endedAt: "2026-08-06T15:42:34.000Z", elapsedMs: 34_000, completionPercentage: 27, cancelledAt: "2026-08-06T15:42:34.000Z" }, new Date("2026-08-06T15:44:00.000Z"));
assert.equal(cancelled.durationDescription, "Cancelled after");
assert.equal(cancelled.durationLabel, "34s");
