# viAI Security Engine Privacy Policy

Last updated: August 3, 2026

viAI Security Engine is designed to analyze files and security evidence on the device where it is installed. This policy describes the privacy practices of the viAI Security Engine desktop application and local analysis engine.

## Information Processed Locally

viAI may process the following information on your device when you use its security features:

- File paths, names, hashes, metadata, and static-analysis evidence.
- Local scan history, reports, recommendations, rule matches, and trust indicators.
- Application settings, monitoring preferences, exclusions, and device-security records.
- Basic device identifiers used to retain local application state.

This information is stored in the application's local data directory unless you export it, clear it, or remove the application data.

## No File Uploads or Cloud Analysis

viAI does not upload scanned files, file contents, hashes, local reports, or monitoring evidence for cloud analysis. The local engine binds to `127.0.0.1` and is intended to communicate only with the desktop application on the same device.

## Updates and External Links

When you request an application update, the desktop application contacts GitHub Releases to check for and download an available release. Those requests are subject to GitHub's privacy practices and may include standard connection metadata such as your IP address and user agent. Opening a documentation, Terms of Service, or Privacy Policy link may similarly connect your browser to GitHub.

## Your Choices

You can manage local monitoring and data from the desktop application. You can clear stored local data from the History page and export reports when needed. Before exporting reports, review them carefully because exported files may contain file paths, hashes, and security findings.

## Security

viAI uses local storage and local interprocess communication to support its features. No software can guarantee absolute security. Keep your operating system, viAI installation, and access controls up to date.

## Changes to This Policy

This policy may change as the project evolves. The current version is published in the repository at this file path.

## Contact

For privacy questions or concerns, open an issue in the [viAI Security Engine repository](https://github.com/eforendless/viAI-security-engine/issues).
