# Static Engine Maturity: v0.3

## Scope

This document defines the static-analysis maturity boundary for v0.3.x. The engine collects local static evidence, produces a bounded assessment, and requests categories of additional evidence when static analysis is insufficient. It does not execute files, quarantine or modify files, implement realtime response, run a sandbox, or integrate an AI provider.

## Canonical Assessment

Every newly generated static report carries an additive `assessment` object with:

- suspicion score and level;
- independently bounded trust score and level;
- evidence-quality confidence with explicit deductions;
- static verdict (`TRUSTED`, `LIKELY_BENIGN`, `UNKNOWN`, `SUSPICIOUS`, or `HIGHLY_SUSPICIOUS`);
- investigation priority;
- recommendation; and
- a typed dynamic-evidence request only when `DYNAMIC_ANALYSIS` is recommended.

Legacy score, recommendation, and report fields remain present for existing history and consumers. New professional reports use schema `0.3`; consumers must tolerate schema `0.2` records with no assessment.

## Evidence and Confidence

The default extraction path streams the main file once, calculating hashes and whole-file entropy while retaining at most 16 MiB for structural inspection. Collector failures, partial or unsupported PE parsing, snapshot truncation, unavailable or failed Authenticode verification, and absence of a historical baseline lower evidence confidence. Confidence describes evidence completeness and reliability, not maliciousness.

Windows Authenticode is verified through Windows policy. The engine preserves normalized verification states, and does not turn unavailable or failed verification into unsigned evidence. Catalog-signature validation is not claimed by this version.

## Correlation and Decisions

VRL rules can declare an evidence category, strength, and correlation group. Results in the same correlation group contribute only their strongest score; declared categories have strength-based caps. Entropy and packer hints share one weak correlation group. Static import capability chains remain capability evidence, not observed runtime behavior.

A high score based only on weak evidence cannot produce a `HIGHLY_SUSPICIOUS` verdict or automatic dynamic-analysis request. Trust attenuates the derived legacy overall score only; it does not erase suspicious evidence. Recommendation policy normalizes legacy `SANDBOX` and `AI_ANALYSIS` values to `DYNAMIC_ANALYSIS` as a request contract, not an implementation.

## Local Baseline

`LocalBaselineStore` persists a bounded, versioned identity record outside reputation history. On each completed analysis, the pipeline evaluates the prior identity before trust and rules, then records the current identity after report construction. The baseline state is `new`, `unchanged`, `changed`, `signer-changed`, or `signature-changed`.

Path location and prior observation alone do not add trust. Positive system-file baseline trust requires all of: system context, an unchanged local baseline, and a trusted signature. Changed signer, signature, or file identity produces negative trust evidence.

## Reporting and Compatibility

Professional reports carry the canonical assessment, correlation trace, baseline state, and engine/rule-set/trust-policy/schema metadata additively. HTML, PDF, and Excel exports lead with the v0.3 verdict, suspicion, trust, evidence confidence, priority, recommendation, baseline, evidence, warnings, and version fields. Historical records without a v0.3 assessment are visibly labeled `LEGACY SCORE MODEL`; numeric risk remains compatibility data only.

Desktop persistence keeps the complete report and a compact v0.3 assessment summary for history/dashboard rendering. The active history, dashboard, removable-media scan, scan investigation counter, and notification paths use canonical verdict/priority/recommendation semantics when an assessment is present. Scheduler file-classification scores remain a separate pre-analysis queueing concern.

## Deferred Work

The following work remains outside the completed v0.3 static-engine slice:

- Targeted on-demand range reads for PE data beyond the bounded inspection snapshot.
- Broader PE fixture coverage and more directory semantics.
- A configurable benign corpus harness and resulting false-positive statistics.
- Monotonic end-to-end stage timing and a persisted assessment trace beyond existing collector timing.
- Realtime enforcement, quarantine, sandbox execution, and AI-provider integrations.

## Final Product-Integration Decision

**READY for the v0.3 static-engine boundary.** The engine-to-report-to-history-to-UI-to-export path now preserves and presents the canonical assessment without allowing legacy risk scores to override it. This decision does not expand the product boundary: realtime enforcement, quarantine, sandbox execution, AI-provider work, catalog-signature validation, and the deferred evidence/parser items above remain out of scope for v0.3.
