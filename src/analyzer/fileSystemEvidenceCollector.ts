import { lstat, readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename } from "node:path";
import type { FileSystemEvidence, ZoneIdentifier } from "../types.js";

export async function collectFileSystemEvidence(filePath: string): Promise<FileSystemEvidence> {
  const entry = await lstat(filePath);
  return collectFileSystemEvidenceFromSnapshot(filePath, entry);
}

export async function collectFileSystemEvidenceFromSnapshot(filePath: string, linkStat: Stats): Promise<FileSystemEvidence> {
  return {
    isSymbolicLink: linkStat.isSymbolicLink(),
    isHiddenByName: basename(filePath).startsWith("."),
    zoneIdentifier: await readZoneIdentifier(filePath),
  };
}

async function readZoneIdentifier(filePath: string): Promise<ZoneIdentifier | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const values = parseZoneIdentifier(await readFile(`${filePath}:Zone.Identifier`, "utf8"));
    const zoneId = Number.parseInt(values.ZoneId ?? "", 10);
    if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 4) return undefined;
    return { zoneId, zoneName: zoneName(zoneId), hostUrl: values.HostUrl, referrerUrl: values.ReferrerUrl };
  } catch {
    return undefined;
  }
}

function parseZoneIdentifier(content: string): Record<string, string> {
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

function zoneName(zoneId: number): ZoneIdentifier["zoneName"] {
  return ["local-machine", "local-intranet", "trusted-sites", "internet", "restricted-sites"][zoneId] as ZoneIdentifier["zoneName"];
}