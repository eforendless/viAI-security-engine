import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { Hashes } from "../types.js";

export async function analyzeHashes(filePath: string): Promise<Hashes> {
  const sha256 = createHash("sha256");
  const sha1 = createHash("sha1");
  const md5 = createHash("md5");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sha256.update(bytes);
      sha1.update(bytes);
      md5.update(bytes);
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });

  return {
    sha256: sha256.digest("hex"),
    sha1: sha1.digest("hex"),
    md5: md5.digest("hex"),
  };
}

export function analyzeHashesFromBytes(bytes: Uint8Array): Hashes {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sha1: createHash("sha1").update(bytes).digest("hex"),
    md5: createHash("md5").update(bytes).digest("hex"),
  };
}