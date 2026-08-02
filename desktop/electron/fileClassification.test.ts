import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile } from "./fileClassification";

const metadata = { size: 2_048, birthtimeMs: 1_000, mtimeMs: 1_000 };

test("classification routes executable and script files to forensic analysis", () => {
  const executable = classifyFile("C:\\Users\\Avery\\Downloads\\setup.exe", metadata, 5_000);
  const script = classifyFile("C:\\Users\\Avery\\AppData\\Local\\run.ps1", metadata, 5_000);
  assert.equal(executable.category, "executable");
  assert.equal(executable.profile, "forensic");
  assert.equal(executable.signatureAvailability, "not-checked");
  assert.equal(script.category, "script");
  assert.equal(script.profile, "forensic");
});

test("classification keeps media and cache files in the inventory profile", () => {
  const media = classifyFile("C:\\Users\\Avery\\Pictures\\holiday.jpg", metadata, 5_000);
  const cached = classifyFile("C:\\Users\\Avery\\AppData\\Local\\Temp\\cache.dat", metadata, 5_000);
  assert.equal(media.category, "media");
  assert.equal(media.mimeType, "image/jpeg");
  assert.equal(media.profile, "inventory");
  assert.equal(cached.category, "cache-temp");
  assert.equal(cached.profile, "inventory");
});

test("classification gives small unknown files in risky locations a standard profile", () => {
  const unknown = classifyFile("C:\\Users\\Avery\\Downloads\\payload.bin", metadata, 5_000);
  assert.equal(unknown.category, "unknown");
  assert.equal(unknown.locationRisk, "high");
  assert.equal(unknown.profile, "forensic");
});

test("classification inventories known system-path binaries but retains system scripts for forensic analysis", () => {
  const systemBinary = classifyFile("C:\\Windows\\System32\\notepad.exe", metadata, 5_000);
  const systemScript = classifyFile("C:\\Windows\\System32\\maintenance.ps1", metadata, 5_000);
  assert.equal(systemBinary.category, "system");
  assert.equal(systemBinary.profile, "inventory");
  assert.equal(systemBinary.publisherTrust, "known-system-path");
  assert.equal(systemScript.category, "script");
  assert.equal(systemScript.profile, "forensic");
});

test("classification prioritizes a recent unsigned download over an unchanged system binary", () => {
  const download = classifyFile("C:\\Users\\Avery\\Downloads\\invoice.exe", { size: 500_000, birthtimeMs: 4_900, mtimeMs: 4_900 }, undefined, 5_000);
  const system = classifyFile("C:\\Windows\\System32\\notepad.exe", metadata, { size: metadata.size, mtimeMs: metadata.mtimeMs, analyzedAt: "2026-08-01T00:00:00.000Z", priorityScore: 10 }, 5_000);
  assert.equal(download.priorityBand, "critical");
  assert.equal(system.cacheHit, true);
  assert.equal(system.profile, "inventory");
  assert.ok((download.priorityScore ?? 0) > (system.priorityScore ?? 0));
});