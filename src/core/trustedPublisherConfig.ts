import { readFile } from "node:fs/promises";
import type { TrustedPublisher } from "../../packages/core/src/trust/index.js";

interface TrustedPublisherConfig {
  readonly publishers: readonly TrustedPublisher[];
}

export async function loadTrustedPublishers(path: string): Promise<readonly TrustedPublisher[]> {
  const config = JSON.parse(await readFile(path, "utf8")) as Partial<TrustedPublisherConfig>;
  if (!Array.isArray(config.publishers)) throw new Error("trusted publisher configuration requires a publishers array");
  return Object.freeze(config.publishers.map((publisher) => validatePublisher(publisher)));
}

function validatePublisher(publisher: TrustedPublisher): TrustedPublisher {
  if (!publisher.id || !publisher.displayName || !Array.isArray(publisher.subjectNames) || publisher.subjectNames.length === 0) {
    throw new Error("trusted publisher configuration contains an invalid publisher entry");
  }
  return Object.freeze({ ...publisher, subjectNames: Object.freeze([...publisher.subjectNames]) });
}