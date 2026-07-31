import type { PackerFinding, PeMetadata } from "../types.js";

const PACKER_NAMES: Record<string, string> = {
  upx: "UPX",
  themida: "Themida",
  vmp: "VMProtect",
  aspack: "ASPack",
  pecompact: "PECompact",
};

export function detectPacker(pe: PeMetadata): PackerFinding {
  if (!pe.isPe) return { detected: false, names: [], reasons: [] };

  const names = new Set<string>();
  const reasons: string[] = [];
  for (const section of pe.sections) {
    const normalized = section.name.toLowerCase();
    for (const [marker, packer] of Object.entries(PACKER_NAMES)) {
      if (normalized.includes(marker)) {
        names.add(packer);
        reasons.push(`section name ${section.name} matches ${packer}`);
      }
    }
  }
  const highEntropyExecutableSections = pe.sections.filter((section) => section.executable && section.entropy >= 7.4);
  if (highEntropyExecutableSections.length > 0) {
    reasons.push("one or more executable PE sections have high entropy");
  }
  return { detected: names.size > 0 || highEntropyExecutableSections.length > 0, names: [...names], reasons };
}