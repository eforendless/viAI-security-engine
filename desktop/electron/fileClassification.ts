import { stat } from "node:fs/promises";
import { extname } from "node:path";

export type FileCategory = "executable" | "script" | "document" | "archive" | "media" | "system" | "cache-temp" | "unknown";
export type AnalysisProfile = "inventory" | "standard" | "forensic";
export type PriorityBand = "critical" | "high" | "medium" | "low" | "inventory";
export type ClassificationConfidence = "very-high" | "high" | "medium" | "low" | "unknown";

export interface ScanCacheEntry {
  readonly size: number;
  readonly mtimeMs: number;
  readonly analyzedAt: string;
  readonly signatureStatus?: string;
  readonly priorityScore: number;
}

export interface FileClassification {
  readonly extension: string;
  readonly mimeType: string;
  readonly executable: boolean;
  readonly script: boolean;
  readonly archive: boolean;
  readonly documentOrMedia: boolean;
  readonly category: FileCategory;
  readonly profile: AnalysisProfile;
  readonly locationRisk: "low" | "normal" | "high";
  readonly signatureAvailability: "not-applicable" | "not-checked";
  readonly publisherTrust: "unknown" | "known-system-path";
  readonly ageMs: number;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly priorityScore?: number;
  readonly priorityBand?: PriorityBand;
  readonly confidence?: ClassificationConfidence;
  readonly reasons?: readonly string[];
  readonly cacheHit?: boolean;
}

export interface FileMetadata {
  readonly size: number;
  readonly birthtimeMs: number;
  readonly mtimeMs?: number;
}

const executableExtensions = new Set([".exe", ".dll", ".sys", ".scr", ".msi", ".cpl", ".ocx", ".drv", ".com", ".jar", ".appx", ".msp"]);
const scriptExtensions = new Set([".ps1", ".bat", ".cmd", ".vbs", ".vbe", ".wsf", ".js", ".jse", ".py", ".pyw", ".psm1", ".psd1", ".hta", ".chm"]);
const documentExtensions = new Set([".doc", ".docm", ".docx", ".xls", ".xlsm", ".xlsx", ".ppt", ".pptm", ".pptx", ".pdf", ".rtf", ".html", ".htm", ".lnk", ".url"]);
const archiveExtensions = new Set([".zip", ".rar", ".7z", ".tar", ".gz", ".cab", ".iso", ".img"]);
const mediaExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mkv", ".avi", ".mp3", ".wav", ".flac"]);
const mimeTypes: Record<string, string> = {
  ".exe": "application/vnd.microsoft.portable-executable", ".dll": "application/vnd.microsoft.portable-executable", ".sys": "application/vnd.microsoft.portable-executable", ".msi": "application/x-msi", ".ps1": "text/x-powershell", ".bat": "text/x-msdos-batch", ".cmd": "text/x-msdos-batch", ".vbs": "text/vbscript", ".js": "text/javascript", ".py": "text/x-python", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pdf": "application/pdf", ".zip": "application/zip", ".rar": "application/vnd.rar", ".7z": "application/x-7z-compressed", ".tar": "application/x-tar", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
};

export async function classifyDiscoveredFile(filePath: string, cached?: ScanCacheEntry, now = Date.now()): Promise<FileClassification> {
  try {
    const metadata = await stat(filePath);
    return classifyFile(filePath, { size: metadata.size, birthtimeMs: metadata.birthtimeMs, mtimeMs: metadata.mtimeMs }, cached, now);
  } catch {
    return classifyFile(filePath, { size: 0, birthtimeMs: now, mtimeMs: now }, cached, now);
  }
}

export function classifyFile(filePath: string, metadata: FileMetadata, now?: number): FileClassification;
export function classifyFile(filePath: string, metadata: FileMetadata, cached?: ScanCacheEntry, now?: number): FileClassification;
export function classifyFile(filePath: string, metadata: FileMetadata, cachedOrNow?: ScanCacheEntry | number, requestedNow = Date.now()): FileClassification {
  const cached = typeof cachedOrNow === "number" ? undefined : cachedOrNow;
  const now = typeof cachedOrNow === "number" ? cachedOrNow : requestedNow;
  const mtimeMs = metadata.mtimeMs ?? metadata.birthtimeMs;
  const normalizedPath = filePath.replaceAll("/", "\\").toLowerCase();
  const extension = extname(filePath).toLowerCase();
  const executable = executableExtensions.has(extension);
  const script = scriptExtensions.has(extension);
  const archive = archiveExtensions.has(extension);
  const document = documentExtensions.has(extension);
  const media = mediaExtensions.has(extension);
  const systemFile = /\\(windows|program files( \(x86\))?|winsxs|driverstore|system32)\\/.test(normalizedPath);
  const cacheOrTemp = /\\(temp|tmp|cache|code cache|gpu cache|thumbnails?)\\/.test(normalizedPath);
  const highRiskLocation = /\\(downloads|desktop|documents|startup|appdata\\(local|roaming)|temp|programdata|recycler|\$recycle\.bin|onedrive|dropbox|google drive|attachments?)\\/.test(normalizedPath);
  const trustedSystemFile = systemFile && !highRiskLocation && !script;
  const cacheHit = Boolean(cached && cached.size === metadata.size && cached.mtimeMs === mtimeMs);
  const category: FileCategory = trustedSystemFile ? "system"
    : executable ? "executable"
      : script ? "script"
        : document ? "document"
          : archive ? "archive"
            : media ? "media"
              : cacheOrTemp ? "cache-temp"
                : "unknown";
  const reasons: string[] = [];
  let score = 0;
  if (executable) { score += 45; reasons.push("Windows-executable file type"); }
  if (script) { score += 42; reasons.push("script or interpreter-executable file type"); }
  if (archive) { score += 24; reasons.push("archive or disk-image payload"); }
  if (document) { score += extension.includes("m") ? 30 : 19; reasons.push(extension.includes("m") ? "macro-capable document type" : "document or shortcut execution surface"); }
  if (highRiskLocation) { score += 24; reasons.push("high-risk user or execution-adjacent location"); }
  else if (systemFile) { score -= 24; reasons.push("known system or installed-program location"); }
  if (cacheOrTemp) { score -= 24; reasons.push("cache or temporary location"); }
  const ageMs = Math.max(0, now - metadata.birthtimeMs);
  const modifiedAgeMs = Math.max(0, now - mtimeMs);
  if (modifiedAgeMs < 24 * 60 * 60 * 1_000) { score += 14; reasons.push("modified within the last day"); }
  else if (modifiedAgeMs < 7 * 24 * 60 * 60 * 1_000) { score += 7; reasons.push("modified within the last week"); }
  if (executable && metadata.size > 0 && metadata.size <= 5 * 1024 * 1024) { score += 8; reasons.push("small executable payload"); }
  if (archive && metadata.size > 100 * 1024 * 1024) { score += 8; reasons.push("large archive or disk image"); }
  if ((media || cacheOrTemp) && !highRiskLocation) score -= 25;
  if (trustedSystemFile) score -= 20;
  if (cacheHit) { score -= 45; reasons.push("unchanged local analysis cache entry"); }
  else reasons.push("no matching local analysis cache entry");
  score = Math.max(0, Math.min(100, score));
  const profile: AnalysisProfile = cacheHit || trustedSystemFile ? "inventory"
    : executable || script ? "forensic"
      : score >= 35 && (archive || document || highRiskLocation) ? "forensic"
      : score >= 15 ? "standard"
        : "inventory";
  const priorityBand: PriorityBand = profile === "inventory" ? "inventory" : score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  const confidence: ClassificationConfidence = cacheHit || executable || script || archive || document ? "very-high" : media || cacheOrTemp || trustedSystemFile ? "high" : extension ? "medium" : "low";
  return {
    extension,
    mimeType: mimeTypes[extension] ?? "application/octet-stream",
    executable,
    script,
    archive,
    documentOrMedia: document || media,
    category,
    profile,
    locationRisk: highRiskLocation ? "high" : systemFile || cacheOrTemp ? "low" : "normal",
    signatureAvailability: executable ? "not-checked" : "not-applicable",
    publisherTrust: trustedSystemFile ? "known-system-path" : "unknown",
    ageMs,
    size: metadata.size,
    mtimeMs,
    priorityScore: score,
    priorityBand,
    confidence,
    reasons,
    cacheHit,
  };
}
