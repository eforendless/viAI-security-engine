import { readFile } from "node:fs/promises";
import { calculateShannonEntropy } from "./entropyAnalyzer.js";
import type { PeDirectorySummary, PeMetadata, PeParseWarning, PeSection } from "../types.js";

const SUSPICIOUS_APIS = new Set([
  "virtualalloc",
  "writeprocessmemory",
  "createremotethread",
  "winexec",
  "shellexecutea",
  "shellexecutew",
  "regsetvaluea",
  "regsetvaluew",
]);

export async function analyzePe(filePath: string): Promise<PeMetadata> {
  return parsePe(await readFile(filePath));
}

export function parsePe(buffer: Buffer, options: { inspectionTruncated?: boolean } = {}): PeMetadata {
  const empty = (warning: string, parseStatus: PeMetadata["parseStatus"]): PeMetadata => ({
    isPe: false,
    parseStatus,
    sections: [],
    imports: [],
    suspiciousImports: [],
    parseWarnings: [warning],
    structuredWarnings: [warningForStatus(parseStatus, warning)],
  });
  if (buffer.length < 64 || buffer.subarray(0, 2).toString("ascii") !== "MZ") {
    return empty("DOS MZ header not found", "not-pe");
  }

  try {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (!hasBytes(buffer, peOffset, 24) || buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\0\0") {
      return empty("PE signature not found", "malformed");
    }

    const machineCode = buffer.readUInt16LE(peOffset + 4);
    const sectionCount = buffer.readUInt16LE(peOffset + 6);
    const timestamp = buffer.readUInt32LE(peOffset + 8);
    const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
    const optionalHeaderOffset = peOffset + 24;
    if (!hasBytes(buffer, optionalHeaderOffset, optionalHeaderSize)) {
      return empty("truncated PE optional header", "partial");
    }

    const optionalMagic = buffer.readUInt16LE(optionalHeaderOffset);
    const is64Bit = optionalMagic === 0x20b;
    if (optionalMagic !== 0x10b && optionalMagic !== 0x20b) {
      return empty("unsupported PE optional header", "unsupported");
    }

    const sectionOffset = optionalHeaderOffset + optionalHeaderSize;
    const sectionResult = parseSections(buffer, sectionOffset, sectionCount);
    const sections = sectionResult.sections;
    const directoryOffset = optionalHeaderOffset + (is64Bit ? 112 : 96);
    const sizeOfHeaders = readUInt32IfPresent(buffer, optionalHeaderOffset + 60);
    const sizeOfImage = readUInt32IfPresent(buffer, optionalHeaderOffset + 56);
    const resolver = new RvaResolver(buffer, sections, sizeOfHeaders, sizeOfImage);
    const directories = parseDirectories(buffer, directoryOffset, resolver, options.inspectionTruncated === true);
    const importResult = directories.summaries.imports.present && directories.summaries.imports.valid ? parseImports(buffer, readUInt32IfPresent(buffer, directoryOffset + 8), resolver, is64Bit) : { imports: [], warnings: [] };
    const imports = importResult.imports;
    const suspiciousImports = imports.filter((entry) => SUSPICIOUS_APIS.has(entry.split("!").at(-1)?.toLowerCase() ?? ""));
    const structuredWarnings = [...sectionResult.warnings, ...directories.warnings, ...importResult.warnings];

    return {
      isPe: true,
      parseStatus: structuredWarnings.length === 0 ? "valid" : "partial",
      machine: machineCode === 0x8664 ? "x64" : machineCode === 0x14c ? "x86" : `0x${machineCode.toString(16)}`,
      compilationTimestamp: new Date(timestamp * 1000).toISOString(),
      entryPointRva: readUInt32IfPresent(buffer, optionalHeaderOffset + 16),
      imageBase: imageBase(buffer, optionalHeaderOffset, is64Bit),
      subsystem: subsystemName(readUInt16IfPresent(buffer, optionalHeaderOffset + 68)),
      dllCharacteristics: dllCharacteristics(readUInt16IfPresent(buffer, optionalHeaderOffset + 70)),
      checksum: readUInt32IfPresent(buffer, optionalHeaderOffset + 64),
      sizeOfImage,
      overlaySize: overlaySize(buffer, sections),
      directories: directories.summaries,
      clrPresent: directories.summaries.clr.present,
      numberOfSections: sectionCount,
      sections,
      imports,
      suspiciousImports,
      exportsPresent: directories.summaries.exports.present,
      parseWarnings: structuredWarnings.map((warning) => warning.message),
      structuredWarnings,
    };
  } catch (error) {
    return empty(`PE parse failed: ${error instanceof Error ? error.message : "unknown error"}`, "malformed");
  }
}

function parseSections(buffer: Buffer, offset: number, count: number): { sections: PeSection[]; warnings: PeParseWarning[] } {
  const sections: PeSection[] = [];
  const warnings: PeParseWarning[] = [];
  for (let index = 0; index < count; index += 1) {
    const sectionOffset = offset + index * 40;
    if (!hasBytes(buffer, sectionOffset, 40)) {
      warnings.push(warning("TRUNCATED_SECTION_TABLE", `Section table is truncated before section ${index + 1} of ${count}.`));
      break;
    }
    const rawSize = buffer.readUInt32LE(sectionOffset + 16);
    const rawPointer = buffer.readUInt32LE(sectionOffset + 20);
    const characteristics = buffer.readUInt32LE(sectionOffset + 36);
    const rawData = hasBytes(buffer, rawPointer, rawSize) ? buffer.subarray(rawPointer, rawPointer + rawSize) : Buffer.alloc(0);
    if (rawSize > 0 && !hasBytes(buffer, rawPointer, rawSize)) warnings.push(warning("INVALID_SECTION_RANGE", `Section ${index + 1} declares raw data outside the retained file bytes.`));
    sections.push({
      name: buffer.subarray(sectionOffset, sectionOffset + 8).toString("ascii").replace(/\0+$/, ""),
      virtualSize: buffer.readUInt32LE(sectionOffset + 8),
      virtualAddress: buffer.readUInt32LE(sectionOffset + 12),
      rawSize,
      rawOffset: rawPointer,
      entropy: calculateShannonEntropy(rawData),
      readable: Boolean(characteristics & 0x40000000),
      writable: Boolean(characteristics & 0x80000000),
      executable: Boolean(characteristics & 0x20000000),
    });
  }
  return { sections, warnings };
}

function parseImports(buffer: Buffer, importRva: number, resolver: RvaResolver, is64Bit: boolean): { imports: string[]; warnings: PeParseWarning[] } {
  const descriptor = resolver.resolve(importRva, 20);
  if (descriptor.status !== "resolved") return { imports: [], warnings: [warning("INVALID_IMPORT_RVA", "Import directory points outside raw-backed PE data.")] };
  const descriptorOffset = descriptor.offset;
  const imports: string[] = [];
  const warnings: PeParseWarning[] = [];
  for (let index = 0; index < 256; index += 1) {
    const offset = descriptorOffset + index * 20;
    if (!hasBytes(buffer, offset, 20)) { warnings.push(warning("TRUNCATED_IMPORT_DESCRIPTOR", "Import descriptor table is truncated.")); break; }
    const lookupRva = buffer.readUInt32LE(offset) || buffer.readUInt32LE(offset + 16);
    const nameRva = buffer.readUInt32LE(offset + 12);
    if (lookupRva === 0 && nameRva === 0) break;
    const dll = resolver.resolve(nameRva, 1);
    const thunkLocation = resolver.resolve(lookupRva, is64Bit ? 8 : 4);
    if (dll.status !== "resolved" || thunkLocation.status !== "resolved") { warnings.push(warning("INVALID_IMPORT_RVA", "Import descriptor references data outside raw-backed PE data.")); continue; }
    const dllName = readCString(buffer, dll.offset);
    const pointerSize = is64Bit ? 8 : 4;
    for (let thunk = 0; thunk < 2048; thunk += 1) {
      const entryOffset = thunkLocation.offset + thunk * pointerSize;
      if (!hasBytes(buffer, entryOffset, pointerSize)) break;
      const value = is64Bit ? Number(buffer.readBigUInt64LE(entryOffset)) : buffer.readUInt32LE(entryOffset);
      if (value === 0) break;
      const ordinalMask = is64Bit ? 0x8000000000000000 : 0x80000000;
      if (value >= ordinalMask) continue;
      const name = resolver.resolve(value, 3);
      if (name.status === "resolved" && hasBytes(buffer, name.offset, 3)) {
        imports.push(`${dllName}!${readCString(buffer, name.offset + 2)}`);
      }
    }
  }
  return { imports: [...new Set(imports)], warnings };
}

type RvaResolution = { status: "resolved"; offset: number; section: string } | { status: "virtual-only"; section: string } | { status: "unmapped" | "out-of-bounds" | "truncated" };

class RvaResolver {
  constructor(private readonly buffer: Buffer, private readonly sections: readonly PeSection[], private readonly sizeOfHeaders: number, private readonly sizeOfImage: number) {}

  resolve(rva: number, length: number): RvaResolution {
    if (rva >= this.sizeOfImage && this.sizeOfImage > 0) return { status: "out-of-bounds" };
    if (rva < this.sizeOfHeaders) return hasBytes(this.buffer, rva, length) ? { status: "resolved", offset: rva, section: "headers" } : { status: "truncated" };
    const section = this.sections.find((candidate) => rva >= candidate.virtualAddress && rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize));
    if (!section) return { status: "unmapped" };
    const relativeOffset = rva - section.virtualAddress;
    if (relativeOffset + length > section.rawSize) return { status: "virtual-only", section: section.name };
    const offset = section.rawOffset + relativeOffset;
    return hasBytes(this.buffer, offset, length) ? { status: "resolved", offset, section: section.name } : { status: "truncated" };
  }
}

function parseDirectories(buffer: Buffer, offset: number, resolver: RvaResolver, inspectionTruncated: boolean): { summaries: NonNullable<PeMetadata["directories"]>; warnings: PeParseWarning[] } {
  const definitions = [
    ["exports", 0, "rva", "INVALID_EXPORT_DIRECTORY"], ["imports", 1, "rva", "DIRECTORY_OUT_OF_BOUNDS"], ["resources", 2, "rva", "INVALID_RESOURCE_DIRECTORY"], ["security", 4, "file-offset", "INVALID_CERTIFICATE_DIRECTORY"], ["debug", 6, "rva", "INVALID_DEBUG_DIRECTORY"], ["relocations", 5, "rva", "INVALID_RELOCATION_DIRECTORY"], ["clr", 14, "rva", "DIRECTORY_OUT_OF_BOUNDS"],
  ] as const;
  const summaries: Record<string, PeDirectorySummary> = {};
  const warnings: PeParseWarning[] = [];
  for (const [name, index, location, code] of definitions) {
    const entryOffset = offset + index * 8;
    const address = readUInt32IfPresent(buffer, entryOffset);
    const size = readUInt32IfPresent(buffer, entryOffset + 4);
    if (address === 0 || size === 0) { summaries[name] = { present: false, valid: true, location, status: "not-present" }; continue; }
    const resolution = location === "file-offset" ? (hasBytes(buffer, address, size) ? { status: "resolved" as const } : { status: inspectionTruncated ? "truncated" as const : "out-of-bounds" as const }) : resolver.resolve(address, Math.min(size, 1));
    const status = resolution.status;
    const valid = status === "resolved";
    summaries[name] = { present: true, valid, size, location, status };
    if (!valid) warnings.push(warning(code, `${name[0].toUpperCase()}${name.slice(1)} directory is ${status === "truncated" ? "outside retained snapshot bytes" : `not raw-backed (${status})`}.`));
  }
  return { summaries: summaries as NonNullable<PeMetadata["directories"]>, warnings };
}

function readCString(buffer: Buffer, offset: number): string {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end === -1 ? buffer.length : end).toString("ascii");
}

function hasBytes(buffer: Buffer, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= buffer.length;
}

function readUInt32IfPresent(buffer: Buffer, offset: number): number {
  return hasBytes(buffer, offset, 4) ? buffer.readUInt32LE(offset) : 0;
}

function readUInt16IfPresent(buffer: Buffer, offset: number): number {
  return hasBytes(buffer, offset, 2) ? buffer.readUInt16LE(offset) : 0;
}

function imageBase(buffer: Buffer, offset: number, is64Bit: boolean): string {
  const value = is64Bit && hasBytes(buffer, offset + 24, 8) ? buffer.readBigUInt64LE(offset + 24) : BigInt(readUInt32IfPresent(buffer, offset + 28));
  return `0x${value.toString(16)}`;
}

function subsystemName(value: number): string {
  return value === 2 ? "Windows GUI" : value === 3 ? "Windows CUI" : value === 1 ? "Native" : value === 0 ? "Unknown" : `0x${value.toString(16)}`;
}

function dllCharacteristics(value: number): string[] {
  const flags: ReadonlyArray<readonly [number, string]> = [
    [0x0040, "DYNAMIC_BASE"],
    [0x0100, "NX_COMPAT"],
    [0x0400, "NO_SEH"],
    [0x4000, "GUARD_CF"],
    [0x8000, "TERMINAL_SERVER_AWARE"],
  ];
  return flags.flatMap(([flag, name]) => value & flag ? [name] : []);
}

function overlaySize(buffer: Buffer, sections: PeSection[]): number {
  const sectionEnd = sections.reduce((largest, section) => Math.max(largest, section.rawOffset + section.rawSize), 0);
  return Math.max(0, buffer.length - sectionEnd);
}

function warning(code: string, message: string): PeParseWarning { return { code, severity: "warning", message }; }
function warningForStatus(status: PeMetadata["parseStatus"], message: string): PeParseWarning { return warning(status === "not-pe" ? "NOT_PE" : "PE_PARSE_FAILURE", message); }