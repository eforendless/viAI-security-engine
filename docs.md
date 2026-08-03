# viAI Security Engine Documentation

viAI Security Engine provides local security visibility for Windows endpoints. It combines a desktop application with a local analysis engine to help teams review files, evidence, and device activity without uploading samples for cloud analysis.

## Getting Started

1. Install and open viAI Security Engine.
2. Confirm that the sidebar reports **Engine connected**.
3. Run a Quick Scan for a specific file or folder, or start a Full System Scan.
4. Review findings in History and open File Details for the retained evidence report.
5. Configure local monitoring from Realtime Protection and Device Security.

## Core Features

- **Quick Scan:** Analyze a selected file or folder locally.
- **Full System Scan:** Prioritize and inspect supported local file candidates.
- **Realtime Protection:** Configure local download, executable, USB, and system monitoring policies.
- **Device Security:** Review connected devices and associated scan findings.
- **History:** Retain local reports, recommendations, trust evidence, and rule matches.

## Data Handling

viAI is designed to keep file evidence, reports, and settings on the local device. Review the [Privacy Policy](privacypolicy.md) for details about local processing and update checks.

## Important Limitations

viAI provides static-analysis evidence and investigation guidance. It does not execute samples, provide a malware verdict, or replace approved incident-response and endpoint-security controls.

## Additional Technical Documentation

- [Architecture](docs/architecture.md)
- [Rule Engine Architecture](docs/rule-engine-architecture.md)
- [Trust Assessment Architecture](docs/trust-assessment-architecture.md)
- [Terms of Service](ToS.md)
- [Privacy Policy](privacypolicy.md)
