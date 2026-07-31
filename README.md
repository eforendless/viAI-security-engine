# viAI Local Security Engine

viAI Local Security Engine is a privacy-first, static evidence collector for endpoint security workflows. Its only decision is whether available local evidence justifies deeper investigation. It does not execute files, upload files, classify malware, or present a user-facing threat explanation.

## Capabilities

- Watches configured download locations and executable file changes.
- Performs local SHA-256, SHA-1, MD5, metadata, entropy, Authenticode, PE import/section, and packer-indicator analysis.
- Maintains a local JSON reputation cache at `database/reputation.json`.
- Evaluates editable JSON rules in `rules/` and produces a 0-100 investigation-priority score.
- Exposes `POST /analyze` on loopback only at `127.0.0.1:4117`.

## Quick Start

```powershell
npm install
npm test
npm run build
npm start
```

Analyze a local path through the API:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4117/analyze -ContentType application/json -Body '{"path":"C:\\Users\\example\\Downloads\\setup.exe"}'
```

## Decision Model

| Score | Level | Decision |
| --- | --- | --- |
| 0-25 | Low | No further investigation |
| 26-60 | Medium | Investigate |
| 61-100 | High | Priority investigation |

The score measures investigation justification, not a malware probability. `high` results can be handed to a sandbox through the `SandboxClient` contract; the AI investigation contract is intentionally separate.

See [docs/architecture.md](docs/architecture.md), [docs/example-analysis-report.json](docs/example-analysis-report.json), and [docs/development-roadmap.md](docs/development-roadmap.md).