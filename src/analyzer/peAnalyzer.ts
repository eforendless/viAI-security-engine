import { readFile } from "node:fs/promises";
import { calculateShannonEntropy } from "./entropyAnalyzer.js";
import type { PeMetadata, PeSection } from "../types.js";

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

export function parsePe(buffer: Buffer): PeMetadata {
  const empty = (warning: string): PeMetadata => ({
    isPe: false,
    sections: [],
    imports: [],
    suspiciousImports: [],
    parseWarnings: [warning],
  });
  if (buffer.length < 64 || buffer.subarray(0, 2).toString("ascii") !== "MZ") {
    return empty("DOS MZ header not found");
  }

  try {
    const peOffset = buffer.readUInt32LE(0x3c);
    if (!hasBytes(buffer, peOffset, 24) || buffer.subarray(peOffset, peOffset + 4).toString("ascii") !== "PE\0\0") {
      return empty("PE signature not found");
    }

    const machineCode = buffer.readUInt16LE(peOffset + 4);
    const sectionCount = buffer.readUInt16LE(peOffset + 6);
    const timestamp = buffer.readUInt32LE(peOffset + 8);
    const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
    const optionalHeaderOffset = peOffset + 24;
    if (!hasBytes(buffer, optionalHeaderOffset, optionalHeaderSize)) {
      return empty("truncated PE optional header");
    }

    const optionalMagic = buffer.readUInt16LE(optionalHeaderOffset);
    const is64Bit = optionalMagic === 0x20b;
    if (optionalMagic !== 0x10b && optionalMagic !== 0x20b) {
      return empty("unsupported PE optional header");
    }

    const sectionOffset = optionalHeaderOffset + optionalHeaderSize;
    const sections = parseSections(buffer, sectionOffset, sectionCount);
    const directoryOffset = optionalHeaderOffset + (is64Bit ? 112 : 96);
    const exportRva = readUInt32IfPresent(buffer, directoryOffset);
    const importRva = readUInt32IfPresent(buffer, directoryOffset + 8);
    const clrRva = readUInt32IfPresent(buffer, directoryOffset + 14 * 8);
    const imports = importRva ? parseImports(buffer, importRva, sections, is64Bit) : [];
    const suspiciousImports = imports.filter((entry) => SUSPICIOUS_APIS.has(entry.split("!").at(-1)?.toLowerCase() ?? ""));

    return {
      isPe: true,
      machine: machineCode === 0x8664 ? "x64" : machineCode === 0x14c ? "x86" : `0x${machineCode.toString(16)}`,
      compilationTimestamp: new Date(timestamp * 1000).toISOString(),
      entryPointRva: readUInt32IfPresent(buffer, optionalHeaderOffset + 16),
      imageBase: imageBase(buffer, optionalHeaderOffset, is64Bit),
      subsystem: subsystemName(readUInt16IfPresent(buffer, optionalHeaderOffset + 68)),
      dllCharacteristics: dllCharacteristics(readUInt16IfPresent(buffer, optionalHeaderOffset + 70)),
      checksum: readUInt32IfPresent(buffer, optionalHeaderOffset + 64),
      sizeOfImage: readUInt32IfPresent(buffer, optionalHeaderOffset + 56),
      overlaySize: overlaySize(buffer, sections),
      clrPresent: clrRva !== 0,
      numberOfSections: sectionCount,
      sections,
      imports,
      suspiciousImports,
      exportsPresent: Boolean(exportRva),
      parseWarnings: [],
    };
  } catch (error) {
    return empty(`PE parse failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function parseSections(buffer: Buffer, offset: number, count: number): PeSection[] {
  const sections: PeSection[] = [];
  for (let index = 0; index < count; index += 1) {
    const sectionOffset = offset + index * 40;
    if (!hasBytes(buffer, sectionOffset, 40)) break;
    const rawSize = buffer.readUInt32LE(sectionOffset + 16);
    const rawPointer = buffer.readUInt32LE(sectionOffset + 20);
    const characteristics = buffer.readUInt32LE(sectionOffset + 36);
    const rawData = hasBytes(buffer, rawPointer, rawSize) ? buffer.subarray(rawPointer, rawPointer + rawSize) : Buffer.alloc(0);
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
  return sections;
}

function parseImports(buffer: Buffer, importRva: number, sections: PeSection[], is64Bit: boolean): string[] {
  const descriptorOffset = rvaToOffset(importRva, sections);
  if (descriptorOffset === undefined) return [];
  const imports: string[] = [];
  for (let index = 0; index < 256; index += 1) {
    const offset = descriptorOffset + index * 20;
    if (!hasBytes(buffer, offset, 20)) break;
    const lookupRva = buffer.readUInt32LE(offset) || buffer.readUInt32LE(offset + 16);
    const nameRva = buffer.readUInt32LE(offset + 12);
    if (lookupRva === 0 && nameRva === 0) break;
    const dllOffset = rvaToOffset(nameRva, sections);
    const thunkOffset = rvaToOffset(lookupRva, sections);
    if (dllOffset === undefined || thunkOffset === undefined) continue;
    const dll = readCString(buffer, dllOffset);
    const pointerSize = is64Bit ? 8 : 4;
    for (let thunk = 0; thunk < 2048; thunk += 1) {
      const entryOffset = thunkOffset + thunk * pointerSize;
      if (!hasBytes(buffer, entryOffset, pointerSize)) break;
      const value = is64Bit ? Number(buffer.readBigUInt64LE(entryOffset)) : buffer.readUInt32LE(entryOffset);
      if (value === 0) break;
      const ordinalMask = is64Bit ? 0x8000000000000000 : 0x80000000;
      if (value >= ordinalMask) continue;
      const nameOffset = rvaToOffset(value, sections);
      if (nameOffset !== undefined && hasBytes(buffer, nameOffset, 3)) {
        imports.push(`${dll}!${readCString(buffer, nameOffset + 2)}`);
      }
    }
  }
  return [...new Set(imports)];
}

function rvaToOffset(rva: number, sections: PeSection[]): number | undefined {
  const section = sections.find((candidate) => rva >= candidate.virtualAddress && rva < candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize));
  return section ? rva - section.virtualAddress + section.rawOffset : undefined;
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