import { open, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { extname } from "node:path";
import type { FileMetadata } from "../types.js";

const EXECUTABLE_EXTENSIONS = new Set([".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".jar"]);

export function isExecutableCandidate(filePath: string): boolean {
  return EXECUTABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export async function extractMetadata(filePath: string): Promise<{ metadata: FileMetadata; fileType: string }> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error("Analysis requires a regular file");
  }

  const extension = extname(filePath).toLowerCase();
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(8);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  return {
    metadata: {
      size: fileStat.size,
      createdAt: fileStat.birthtime.toISOString(),
      modifiedAt: fileStat.mtime.toISOString(),
      extension,
      isExecutableCandidate: isExecutableCandidate(filePath),
    },
    fileType: detectFileType(header, extension),
  };
}

function detectFileType(header: Buffer, extension: string): string {
  if (header.subarray(0, 2).toString("ascii") === "MZ") {
    return "Windows executable candidate";
  }
  if (header.subarray(0, 4).toString("hex") === "7f454c46") {
    return "ELF executable";
  }
  if (header.subarray(0, 4).toString("hex") === "cafebabe") {
    return "Mach-O binary";
  }
  return extension ? `${extension.slice(1).toUpperCase()} file` : "unknown";
}

export function extractMetadataFromSnapshot(filePath: string, fileStat: Stats, bytes: Uint8Array): { metadata: FileMetadata; fileType: string } {
  if (!fileStat.isFile()) {
    throw new Error("Analysis requires a regular file");
  }
  const extension = extname(filePath).toLowerCase();
  return {
    metadata: {
      size: fileStat.size,
      createdAt: fileStat.birthtime.toISOString(),
      modifiedAt: fileStat.mtime.toISOString(),
      extension,
      isExecutableCandidate: isExecutableCandidate(filePath),
    },
    fileType: detectFileType(Buffer.from(bytes.subarray(0, 8)), extension),
  };
}