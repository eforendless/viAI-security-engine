import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DigitalSignatureDetails, SignatureStatus } from "../types.js";

const execFileAsync = promisify(execFile);

export interface SignatureResult {
  status: SignatureStatus;
  publisher?: string;
  evidence?: string;
  details: DigitalSignatureDetails;
}

export async function analyzeSignature(filePath: string): Promise<SignatureResult> {
  if (process.platform !== "win32") {
    return { status: "unknown", evidence: "signature verification is only available on Windows", details: unavailableSignature("Signature inspection is only available on Windows.") };
  }

  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
    "$certificate = $signature.SignerCertificate",
    "$timestamp = $signature.TimeStamperCertificate",
    "[pscustomobject]@{ Status = $signature.Status.ToString(); StatusMessage = $signature.StatusMessage; Subject = if ($certificate) { $certificate.Subject } else { '' }; Issuer = if ($certificate) { $certificate.Issuer } else { '' }; NotAfter = if ($certificate) { $certificate.NotAfter.ToUniversalTime().ToString('o') } else { '' }; Timestamped = [bool]$timestamp; SelfSigned = [bool]($certificate -and $certificate.Subject -eq $certificate.Issuer) } | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, filePath], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 32_768,
    });
    const result = JSON.parse(stdout) as { Status?: string; StatusMessage?: string; Subject?: string; Issuer?: string; NotAfter?: string; Timestamped?: boolean; SelfSigned?: boolean };
    const publisher = result.Subject || undefined;
    const details = detailsFromPowerShell(result);

    if (result.Status === "Valid") {
      return { status: "trusted", publisher, evidence: "signature is valid under local Windows trust policy", details };
    }
    if (result.Status === "NotSigned") {
      return { status: "missing", evidence: "no Authenticode signature is present", details };
    }
    if (["HashMismatch", "NotTrusted", "UnknownError"].includes(result.Status ?? "")) {
      return { status: "invalid", publisher, evidence: `Authenticode status: ${result.Status}`, details };
    }
    return { status: "unknown", publisher, evidence: `Authenticode status: ${result.Status ?? "unavailable"}`, details };
  } catch {
    return { status: "unknown", evidence: "local signature verification could not be completed", details: unavailableSignature("Local signature verification could not be completed.") };
  }
}

function detailsFromPowerShell(result: { Status?: string; StatusMessage?: string; Subject?: string; Issuer?: string; NotAfter?: string; Timestamped?: boolean; SelfSigned?: boolean }): DigitalSignatureDetails {
  const status = result.Status ?? "Unknown";
  return {
    present: status !== "NotSigned",
    valid: status === "Valid",
    trusted: status === "Valid",
    status,
    statusMessage: result.StatusMessage || undefined,
    publisher: result.Subject || undefined,
    certificateSubject: result.Subject || undefined,
    certificateIssuer: result.Issuer || undefined,
    certificateExpiresAt: result.NotAfter || undefined,
    timestamped: result.Timestamped === true,
    revoked: status === "Revoked",
    selfSigned: result.SelfSigned === true,
  };
}

function unavailableSignature(statusMessage: string): DigitalSignatureDetails {
  return { present: false, valid: false, trusted: false, status: "Unavailable", statusMessage, timestamped: false, revoked: false, selfSigned: false };
}