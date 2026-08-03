import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbortError, throwIfAborted } from "../core/cancellation.js";
import type { DigitalSignatureDetails, SignatureStatus } from "../types.js";

const execFileAsync = promisify(execFile);

export interface SignatureResult {
  status: SignatureStatus;
  publisher?: string;
  evidence?: string;
  details: DigitalSignatureDetails;
}

export async function analyzeSignature(filePath: string, signal?: AbortSignal): Promise<SignatureResult> {
  throwIfAborted(signal);
  if (process.platform !== "win32") {
    return { status: "unknown", evidence: "signature verification is only available on Windows", details: unavailableSignature("Signature inspection is only available on Windows.") };
  }

  const script = [
    "& { param([string]$filePath)",
    "$signature = Get-AuthenticodeSignature -LiteralPath $filePath",
    "$certificate = $signature.SignerCertificate",
    "$timestamp = $signature.TimeStamperCertificate",
    "[pscustomobject]@{ Status = $signature.Status.ToString(); StatusMessage = $signature.StatusMessage; Subject = if ($certificate) { $certificate.Subject } else { '' }; Issuer = if ($certificate) { $certificate.Issuer } else { '' }; Thumbprint = if ($certificate) { $certificate.Thumbprint } else { '' }; NotAfter = if ($certificate) { $certificate.NotAfter.ToUniversalTime().ToString('o') } else { '' }; Timestamped = [bool]$timestamp; SelfSigned = [bool]($certificate -and $certificate.Subject -eq $certificate.Issuer) } | ConvertTo-Json -Compress",
    "}",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, filePath], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 32_768,
      signal,
    });
    const result = JSON.parse(stdout) as PowerShellSignatureResult;
    const publisher = result.Subject || undefined;
    const details = detailsFromPowerShell(result);

    if (result.Status === "Valid") {
      return { status: "trusted", publisher, evidence: "signature is valid under local Windows trust policy", details };
    }
    if (result.Status === "NotSigned") {
      return { status: "missing", evidence: "no Authenticode signature is present", details };
    }
    if (["HashMismatch", "NotTrusted"].includes(result.Status ?? "")) {
      return { status: "invalid", publisher, evidence: `Authenticode status: ${result.Status}`, details };
    }
    return { status: "unknown", publisher, evidence: `Authenticode status: ${result.Status ?? "unavailable"}`, details };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw signal?.reason instanceof Error ? signal.reason : error;
    return { status: "unknown", evidence: "local signature verification could not be completed", details: unavailableSignature("Local signature verification could not be completed.") };
  }
}

interface PowerShellSignatureResult { Status?: string; StatusMessage?: string; Subject?: string; Issuer?: string; Thumbprint?: string; NotAfter?: string; Timestamped?: boolean; SelfSigned?: boolean; }

function detailsFromPowerShell(result: PowerShellSignatureResult): DigitalSignatureDetails {
  const status = result.Status ?? "Unknown";
  return {
    verificationState: verificationState(status, result),
    present: status !== "NotSigned",
    valid: status === "Valid",
    trusted: status === "Valid",
    status,
    statusMessage: result.StatusMessage || undefined,
    publisher: result.Subject || undefined,
    certificateSubject: result.Subject || undefined,
    certificateIssuer: result.Issuer || undefined,
    certificateThumbprint: result.Thumbprint || undefined,
    certificateExpiresAt: result.NotAfter || undefined,
    timestamped: result.Timestamped === true,
    revoked: status === "Revoked",
    selfSigned: result.SelfSigned === true,
    verificationError: status === "Valid" || status === "NotSigned" ? undefined : result.StatusMessage || `Authenticode status: ${status}`,
  };
}

function unavailableSignature(statusMessage: string): DigitalSignatureDetails {
  return { verificationState: "verification-unavailable", present: false, valid: false, trusted: false, status: "Unavailable", statusMessage, timestamped: false, revoked: false, selfSigned: false, verificationError: statusMessage };
}

function verificationState(status: string, result: PowerShellSignatureResult): DigitalSignatureDetails["verificationState"] {
  if (status === "NotSigned") return "unsigned";
  if (status === "Valid") return result.SelfSigned ? "signed-self-signed" : "signed-trusted";
  if (status === "Revoked") return "signed-revoked";
  if (status === "NotTrusted") return "signed-untrusted";
  if (status === "Expired") return "signed-expired";
  if (status === "HashMismatch") return "verification-error";
  return "verification-error";
}