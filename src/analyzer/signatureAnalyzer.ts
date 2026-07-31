import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SignatureStatus } from "../types.js";

const execFileAsync = promisify(execFile);

export interface SignatureResult {
  status: SignatureStatus;
  publisher?: string;
  evidence?: string;
}

export async function analyzeSignature(filePath: string): Promise<SignatureResult> {
  if (process.platform !== "win32") {
    return { status: "unknown", evidence: "signature verification is only available on Windows" };
  }

  const script = [
    "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
    "$subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }",
    "[pscustomobject]@{ Status = $signature.Status.ToString(); Subject = $subject } | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, filePath], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 32_768,
    });
    const result = JSON.parse(stdout) as { Status?: string; Subject?: string };
    const publisher = result.Subject || undefined;

    if (result.Status === "Valid") {
      return { status: "trusted", publisher, evidence: "signature is valid under local Windows trust policy" };
    }
    if (result.Status === "NotSigned") {
      return { status: "missing", evidence: "no Authenticode signature is present" };
    }
    if (["HashMismatch", "NotTrusted", "UnknownError"].includes(result.Status ?? "")) {
      return { status: "invalid", publisher, evidence: `Authenticode status: ${result.Status}` };
    }
    return { status: "unknown", publisher, evidence: `Authenticode status: ${result.Status ?? "unavailable"}` };
  } catch {
    return { status: "unknown", evidence: "local signature verification could not be completed" };
  }
}