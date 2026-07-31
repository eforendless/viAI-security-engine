# Development Roadmap

## Foundation: delivered

- Static local analysis, compiled VRL rules, loopback API, local reputation cache, and test coverage.
- Conservative PE parsing, entropy/packer signals, Authenticode interrogation, and bounded removable-drive scanning.

## Production hardening

- Replace JSON reputation storage with encrypted SQLite and signed policy bundles.
- Add ETW-backed process creation and execution telemetry, durable event queues, backpressure, and file-stability retries.
- Add Windows certificate chain policy controls, catalog signature checks, and Authenticode timestamp validation.
- Fuzz the PE parser and enforce file-size/resource budgets on all analyzers.

## Security operations integration

- Implement authenticated IPC between the service and the viAI desktop agent.
- Implement `SandboxClient` with explicit user or policy authorization and a content-addressed handoff protocol.
- Route sandbox-completion callbacks to `InvestigationClient`; keep verdicting and user explanation outside this engine.
- Add signed rule updates, telemetry opt-in controls, audit trails, and endpoint policy administration.