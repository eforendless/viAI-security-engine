import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export interface TrustedPublisher {
  readonly id: string;
  readonly displayName: string;
  readonly subjectNames: readonly string[];
  readonly weight?: number;
}

export class PublisherValidator implements TrustEvaluator {
  readonly id = "publisher-validator";

  constructor(private readonly publishers: readonly TrustedPublisher[]) {}

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    if (!context.signature.isSigned || !context.signature.publisher) return [];
    const publisher = context.signature.publisher.toLocaleLowerCase();
    const trustedPublisher = this.publishers.find((candidate) => candidate.subjectNames.some((name) => publisher.includes(name.toLocaleLowerCase())));
    if (!trustedPublisher) return [];
    return [{
      id: `TRUSTED_PUBLISHER_${trustedPublisher.id}`,
      weight: trustedPublisher.weight ?? 20,
      evidence: `Digitally signed by configured trusted publisher ${trustedPublisher.displayName}.`,
      source: this.id,
    }];
  }
}