import { createReadStream } from "node:fs";

export function calculateShannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0;
  }

  const counts = new Uint32Array(256);
  for (const byte of bytes) {
    counts[byte] += 1;
  }

  return entropyFromCounts(counts, bytes.length);
}

export async function analyzeEntropy(filePath: string): Promise<number> {
  const counts = new Uint32Array(256);
  let length = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      for (const byte of bytes) {
        counts[byte] += 1;
      }
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });

  return entropyFromCounts(counts, length);
}

export function entropyFromCounts(counts: Uint32Array, length: number): number {
  if (length === 0) {
    return 0;
  }

  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }
  }
  return entropy;
}