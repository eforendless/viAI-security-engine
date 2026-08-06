import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { DesktopPersistence } from "./persistence/repositories";

const referenceTime = new Date("2026-08-05T12:00:00.000Z");

for (const count of [100, 1_000, 10_000, 50_000]) {
  test(`dashboard queries remain bounded for ${count.toLocaleString()} persisted assessments`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), "viai-dashboard-persistence-"));
    const persistence = new DesktopPersistence(join(directory, "viai.db"));
    const expected = { "needs-investigation": 0, monitoring: 0, "no-action": 0, legacy: 0 };
    try {
      persistence.database.transaction(() => {
        for (let index = 0; index < count; index += 1) {
          const variant = index % 4;
          const assessment = variant === 3 ? undefined : variant === 0 ? assessmentRecord("SUSPICIOUS", "REVIEW", "HIGH") : variant === 1 ? assessmentRecord("TRUSTED", "MONITOR", "LOW") : assessmentRecord("LIKELY_BENIGN", "ALLOW", "NONE");
          const category = variant === 0 ? "needs-investigation" : variant === 1 ? "monitoring" : variant === 2 ? "no-action" : "legacy";
          expected[category] += 1;
          persistence.putAssessment({
            id: `assessment-${index}`,
            kind: "scan",
            occurredAt: new Date(referenceTime.valueOf() - (index % (40 * 24)) * 3_600_000).toISOString(),
            filePath: `C:\\samples\\${index}.${["exe", "dll", "sys", "ps1", "pdf", "zip", "mp4"][index % 7]}`,
            fileHash: `hash-${index}`,
            recommendation: assessment?.recommendation,
            assessment,
            engineVersion: "0.3.14",
            detail: `Synthetic assessment ${index}`,
            report: { retainedOnlyForDetails: "x".repeat(256) },
          });
        }
      });
      persistence.database.connection.prepare("UPDATE assessments SET report_json = '{malformed' WHERE id = ?").run("assessment-0");

      const started = performance.now();
      const summary = persistence.getDashboardSummary();
      const trend24Hours = persistence.getAssessmentTrend("24h", referenceTime);
      const trend7Days = persistence.getAssessmentTrend("7d", referenceTime);
      const trend30Days = persistence.getAssessmentTrend("30d", referenceTime);
      const recent = persistence.getRecentAssessments({ limit: 8 });
      const elapsedMs = performance.now() - started;

      assert.equal(summary.totalAssessments, count);
      assert.deepEqual(summary.categories, expected);
      assert.equal(summary.fileTypes.executables + summary.fileTypes.dlls + summary.fileTypes.drivers + summary.fileTypes.scripts + summary.fileTypes.documents + summary.fileTypes.archives + summary.fileTypes.media, count);
      assert.ok(trend24Hours.every((bucket) => new Date(bucket.bucket) >= new Date("2026-08-04T12:00:00.000Z")));
      assert.ok(trend7Days.every((bucket) => new Date(bucket.bucket) >= new Date("2026-07-29T00:00:00.000Z")));
      assert.ok(trend30Days.every((bucket) => new Date(bucket.bucket) >= new Date("2026-07-06T00:00:00.000Z")));
      assert.equal(trend24Hours.reduce((total, bucket) => total + bucket.total, 0), expectedWindowCount(count, 24));
      assert.equal(trend7Days.reduce((total, bucket) => total + bucket.total, 0), expectedWindowCount(count, 7 * 24));
      assert.equal(trend30Days.reduce((total, bucket) => total + bucket.total, 0), expectedWindowCount(count, 30 * 24));
      assert.equal(recent.length, 8);
      assert.ok(recent.every((item, index) => index === 0 || item.occurredAt <= recent[index - 1]!.occurredAt));
      assert.ok(recent.every((item) => !("report" in item)));
      assert.ok(elapsedMs < 10_000, `Dashboard queries took ${elapsedMs.toFixed(1)}ms for ${count} assessments`);

      const timelinePlan = persistence.database.connection.prepare("EXPLAIN QUERY PLAN SELECT occurred_at FROM assessments WHERE kind = 'scan' AND occurred_at >= ? ORDER BY occurred_at DESC").all("2026-07-29T12:00:00.000Z") as Array<{ detail?: unknown }>;
      const recentPlan = persistence.database.connection.prepare("EXPLAIN QUERY PLAN SELECT id FROM assessments WHERE kind = 'scan' AND history_category = ? ORDER BY occurred_at DESC LIMIT ?").all("needs-investigation", 8) as Array<{ detail?: unknown }>;
      assert.match(timelinePlan.map((row) => String(row.detail)).join("\n"), /assessments_dashboard_timeline/);
      assert.match(recentPlan.map((row) => String(row.detail)).join("\n"), /assessments_dashboard_recent/);
      context.diagnostic(`${count.toLocaleString()} dashboard aggregate, three trend windows, and eight recent rows completed in ${elapsedMs.toFixed(1)}ms.`);
    } finally {
      persistence.database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

function assessmentRecord(verdict: string, recommendation: string, investigationPriority: string) {
  return { schemaVersion: "0.3" as const, verdict, recommendation, investigationPriority, suspicion: { score: 0, level: "low" }, trust: { score: 0, level: "low" }, confidence: { score: 0, level: "low" } };
}

function expectedWindowCount(total: number, hours: number): number {
  let matches = 0;
  for (let index = 0; index < total; index += 1) if (index % (40 * 24) <= hours) matches += 1;
  return matches;
}