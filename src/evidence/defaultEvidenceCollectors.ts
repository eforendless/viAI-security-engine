import { collectFileSystemEvidenceFromSnapshot } from "../analyzer/fileSystemEvidenceCollector.js";
import { extractMetadataFromSnapshot } from "../analyzer/metadataExtractor.js";
import { detectPacker } from "../analyzer/packerDetector.js";
import { parsePe } from "../analyzer/peAnalyzer.js";
import { analyzeSignature } from "../analyzer/signatureAnalyzer.js";
import { throwIfAborted } from "../core/cancellation.js";
import { EvidenceExtractionPipeline, enrichEvidence, type EvidenceCollector } from "./evidenceExtractionPipeline.js";

export function createDefaultEvidenceExtractionPipeline(): EvidenceExtractionPipeline {
  return new EvidenceExtractionPipeline({ collectors: [new HashEvidenceCollector(), new MetadataEvidenceCollector(), new PeEvidenceCollector(), new SignatureEvidenceCollector(), new EntropyEvidenceCollector(), new FileSystemEvidenceCollector(), new PackerEvidenceCollector()] });
}

class HashEvidenceCollector implements EvidenceCollector {
  readonly id = "hash";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    return enrichEvidence(evidence, { hashes: context.snapshot.hashes });
  }
}

class MetadataEvidenceCollector implements EvidenceCollector {
  readonly id = "metadata";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    const result = extractMetadataFromSnapshot(context.filePath, context.snapshot.fileStat, context.snapshot.bytes);
    return enrichEvidence(evidence, { metadata: result.metadata, file: { ...evidence.file, fileType: result.fileType } });
  }
}

class PeEvidenceCollector implements EvidenceCollector {
  readonly id = "portable-executable";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    const portableExecutable = parsePe(context.snapshot.bytes, { inspectionTruncated: context.snapshot.inspectionTruncated });
    return enrichEvidence(evidence, { portableExecutable, sections: portableExecutable.sections, imports: portableExecutable.imports, exportsPresent: portableExecutable.exportsPresent, processingMetadata: { ...evidence.processingMetadata, peParseCount: evidence.processingMetadata.peParseCount + 1 } });
  }
}

class SignatureEvidenceCollector implements EvidenceCollector {
  readonly id = "signature";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    const signature = await analyzeSignature(context.filePath, context.signal);
    return enrichEvidence(evidence, { signature: { status: signature.status, publisher: signature.publisher, details: signature.details } });
  }
}

class EntropyEvidenceCollector implements EvidenceCollector {
  readonly id = "entropy";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    return enrichEvidence(evidence, { entropy: context.snapshot.entropy });
  }
}

class FileSystemEvidenceCollector implements EvidenceCollector {
  readonly id = "filesystem";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    return enrichEvidence(evidence, { fileSystem: await collectFileSystemEvidenceFromSnapshot(context.filePath, context.snapshot.linkStat) });
  }
}

class PackerEvidenceCollector implements EvidenceCollector {
  readonly id = "packer";
  async collect(context: Parameters<EvidenceCollector["collect"]>[0], evidence: Parameters<EvidenceCollector["collect"]>[1]) {
    throwIfAborted(context.signal);
    return enrichEvidence(evidence, { packer: evidence.portableExecutable ? detectPacker(evidence.portableExecutable) : { detected: false, names: [], reasons: [] } });
  }
}

