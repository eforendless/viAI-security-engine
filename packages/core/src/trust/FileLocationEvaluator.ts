import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export class FileLocationEvaluator implements TrustEvaluator {
  readonly id = "file-location-evaluator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const path = context.filePath.replace(/\//g, "\\").toLocaleLowerCase();
    if (/(?:^|\\)(?:temp|tmp)(?:\\|$)/.test(path)) {
      return [{ id: "TEMP_LOCATION", weight: -5, evidence: "Located inside a temporary directory.", source: this.id }];
    }
    return [];
  }
}