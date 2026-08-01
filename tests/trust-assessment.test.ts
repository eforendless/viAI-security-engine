import assert from "node:assert/strict";
import test from "node:test";
import {
  CertificateValidator,
  FileLocationEvaluator,
  HashReputationEvaluator,
  InstallationContextEvaluator,
  PublisherValidator,
  TrustAssessmentEngine,
  TrustRegistry,
  VersionValidator,
  type HashReputationProvider,
} from "../packages/core/src/trust/index.js";
import { loadTrustedPublishers } from "../src/core/trustedPublisherConfig.js";
import { StaticEvidenceTrustEvaluator } from "../src/core/staticEvidenceTrustEvaluator.js";

const trustedHashProvider: HashReputationProvider = {
  lookup: async () => ({ status: "trusted", evidence: "Hash is trusted by an offline test provider." }),
};

test("trust assessment combines configured independent positive signals into an immutable result", async () => {
  const engine = new TrustAssessmentEngine(new TrustRegistry([
    new CertificateValidator(),
    new PublisherValidator([{ id: "CONTOSO", displayName: "Contoso", subjectNames: ["Contoso Corporation"] }]),
    new FileLocationEvaluator(),
    new VersionValidator(),
    new InstallationContextEvaluator(),
    new HashReputationEvaluator(trustedHashProvider),
  ]));
  const result = await engine.assess({
    filePath: "C:\\Program Files\\Contoso\\contoso.exe",
    hash: "trusted-hash",
    signature: { isSigned: true, publisher: "CN=Contoso Corporation", certificateStatus: "trusted", hasTrustedTimestamp: true },
    version: { companyName: "Contoso", productName: "Contoso App", originalFilename: "contoso.exe", fileVersion: "1.0.0" },
    installationContexts: [{ id: "WINDOWS_INSTALLER", weight: 6, evidence: "Installed by Windows Installer." }],
  });
  assert.equal(result.trustScore, 75);
  assert.deepEqual(result.indicators.map((indicator) => indicator.id), [
    "VALID_CERTIFICATE",
    "TRUSTED_PUBLISHER_CONTOSO",
    "PROGRAM_FILES_LOCATION",
    "CONSISTENT_VERSION_INFORMATION",
    "INSTALLATION_WINDOWS_INSTALLER",
    "TRUSTED_HASH_REPUTATION",
  ]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.indicators));
});

test("location alone provides limited context and temporary paths do not imply malware", async () => {
  const evaluator = new FileLocationEvaluator();
  const context = { hash: "hash", signature: { isSigned: false, certificateStatus: "missing" as const } };
  const system32 = await evaluator.evaluate({ ...context, filePath: "C:\\Windows\\System32\\sample.exe" });
  const temporary = await evaluator.evaluate({ ...context, filePath: "C:\\Users\\A\\AppData\\Local\\Temp\\sample.exe" });
  assert.equal(system32[0]?.weight, 5);
  assert.equal(temporary[0]?.weight, -5);
});

test("trusted publisher identities are loaded from deployable configuration", async () => {
  const publishers = await loadTrustedPublishers("database/trusted-publishers.json");
  assert.ok(publishers.some((publisher) => publisher.id === "MICROSOFT"));
  assert.ok(publishers.every((publisher) => publisher.subjectNames.length > 0));
});

test("static evidence emits independent weighted trust indicators", async () => {
  const evaluator = new StaticEvidenceTrustEvaluator();
  const indicators = await evaluator.evaluate({ filePath: "C:\\Samples\\tool.exe", hash: "known", signature: { isSigned: false, certificateStatus: "missing" }, staticEvidence: { previouslySeenHash: true, isPe: true, parseWarnings: [], entropy: 5.2, packerDetected: false } });
  assert.deepEqual(indicators.map((indicator) => indicator.id), ["PREVIOUSLY_SEEN_HASH", "STRUCTURALLY_NORMAL_PE", "UNSIGNED_BINARY"]);
  assert.equal(indicators.reduce((total, indicator) => total + indicator.weight, 0), 1);
});

test("Internet Zone Identifier is a bounded static trust signal", async () => {
  const evaluator = new StaticEvidenceTrustEvaluator();
  const indicators = await evaluator.evaluate({ filePath: "C:\\Samples\\download.exe", hash: "unknown", signature: { isSigned: true, certificateStatus: "trusted" }, staticEvidence: { previouslySeenHash: false, isPe: false, parseWarnings: [], entropy: 1, packerDetected: false, zoneIdentifier: { zoneName: "internet" } } });
  assert.deepEqual(indicators.map((indicator) => indicator.id), ["INTERNET_ZONE_ORIGIN"]);
  assert.equal(indicators[0]?.weight, -3);
});