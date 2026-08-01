import { calculateShannonEntropy } from "../analyzer/entropyAnalyzer.js";
import { collectFileSystemEvidenceFromSnapshot } from "../analyzer/fileSystemEvidenceCollector.js";
import { analyzeHashesFromBytes } from "../analyzer/hashAnalyzer.js";
import { extractMetadataFromSnapshot } from "../analyzer/metadataExtractor.js";
import { detectPacker } from "../analyzer/packerDetector.js";
import { parsePe } from "../analyzer/peAnalyzer.js";
import { analyzeSignature } from "../analyzer/signatureAnalyzer.js";
import { EvidenceExtractionPipeline, enrichEvidence, type EvidenceCollector } from "./evidenceExtractionPipeline.js";

export function createDefaultEvidenceExtractionPipeline(): EvidenceExtractionPipeline {
  return new EvidenceExtractionPipeline({ collectors: [new HashEvidenceCollector(), new MetadataEvidenceCollector(), new PeEvidenceCollector(), new SignatureEvidenceCollector(), new EntropyEvidenceCollector(), new FileSystemEvidenceCollector(), new PackerEvidenceCollector()] });
}

class HashEvidenceCollector implements EvidenceCollector {
  readonly id = "hash";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    return enrichEvidence(evidence, { hashes: analyzeHashesFromBytes(context.snapshot.bytes) });
  }
}

class MetadataEvidenceCollector implements EvidenceCollector {
  readonly id = "metadata";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    const result = extractMetadataFromSnapshot(context.filePath, context.snapshot.fileStat, context.snapshot.bytes);
    return enrichEvidence(evidence, { metadata: result.metadata, file: { ...evidence.file, fileType: result.fileType } });
  }
}

class PeEvidenceCollector implements EvidenceCollector {
  readonly id = "portable-executable";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    const portableExecutable = parsePe(context.snapshot.bytes);
    return enrichEvidence(evidence, { portableExecutable, sections: portableExecutable.sections, imports: portableExecutable.imports, exportsPresent: portableExecutable.exportsPresent, processingMetadata: { ...evidence.processingMetadata, peParseCount: evidence.processingMetadata.peParseCount + 1 } });
  }
}

class SignatureEvidenceCollector implements EvidenceCollector {
  readonly id = "signature";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    const signature = await analyzeSignature(context.filePath);
    return enrichEvidence(evidence, { signature: { status: signature.status, publisher: signature.publisher, details: signature.details } });
  }
}

class EntropyEvidenceCollector implements EvidenceCollector {
  readonly id = "entropy";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    return enrichEvidence(evidence, { entropy: calculateShannonEntropy(context.snapshot.bytes) });
  }
}

class FileSystemEvidenceCollector implements EvidenceCollector {
  readonly id = "filesystem";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    return enrichEvidence(evidence, { fileSystem: await collectFileSystemEvidenceFromSnapshot(context.filePath, context.snapshot.linkStat) });
  }
}

class PackerEvidenceCollector implements EvidenceCollector {
  readonly id = "packer";
  async collect(_context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    return enrichEvidence(evidence, { packer: evidence.portableExecutable ? detectPacker(evidence.portableExecutable) : { detected: false, names: [], reasons: [] } });
  }
}

