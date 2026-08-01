import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export class FileLocationEvaluator implements TrustEvaluator {
  readonly id = "file-location-evaluator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const path = context.filePath.replace(/\//g, "\\").toLocaleLowerCase();
    if (/^[a-z]:\\windows\\system32(?:\\|$)/.test(path)) {
      return [{ id: "SYSTEM32_LOCATION", weight: 5, evidence: "Located inside Windows System32.", source: this.id }];
    }
    if (/^[a-z]:\\program files(?: \(x86\))?(?:\\|$)/.test(path)) {
      return [{ id: "PROGRAM_FILES_LOCATION", weight: 8, evidence: "Located inside Program Files.", source: this.id }];
    }
    if (/(?:^|\\)(?:temp|tmp)(?:\\|$)/.test(path)) {
      return [{ id: "TEMP_LOCATION", weight: -5, evidence: "Located inside a temporary directory.", source: this.id }];
    }
    return [];
  }
}