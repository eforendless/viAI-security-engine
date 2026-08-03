import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { analyzeSignature } from "../src/analyzer/signatureAnalyzer.js";

const windowsPowerShellPath = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

test("signature analyzer reads the trusted Windows PowerShell signature", { skip: process.platform !== "win32" }, async () => {
  assert.ok(existsSync(windowsPowerShellPath), `expected signed Windows binary at ${windowsPowerShellPath}`);

  const signature = await analyzeSignature(windowsPowerShellPath);

  assert.equal(signature.status, "trusted");
  assert.equal(signature.details.present, true);
  assert.equal(signature.details.valid, true);
  assert.equal(signature.details.trusted, true);
  assert.equal(signature.details.status, "Valid");
  assert.equal(signature.details.verificationState, "signed-trusted");
  assert.match(signature.publisher ?? "", /Microsoft/i);
  assert.match(signature.details.certificateSubject ?? "", /Microsoft/i);
  assert.ok(signature.details.certificateIssuer);
  assert.ok(signature.details.certificateThumbprint);
  assert.ok(signature.details.certificateExpiresAt);
});