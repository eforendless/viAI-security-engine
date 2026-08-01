import type { TrustIndicator } from "./TrustIndicator.js";
import type { TrustEvaluationContext, TrustEvaluator } from "./TrustEvaluator.js";

export class VersionValidator implements TrustEvaluator {
  readonly id = "version-validator";

  async evaluate(context: TrustEvaluationContext): Promise<readonly TrustIndicator[]> {
    const version = context.version;
    if (!version?.companyName || !version.productName || !version.originalFilename || !version.fileVersion) return [];
    if (fileName(context.filePath).toLocaleLowerCase() !== version.originalFilename.toLocaleLowerCase()) return [];
    return [{
      id: "CONSISTENT_VERSION_INFORMATION",
      weight: 4,
      evidence: `Version information is internally consistent for ${version.companyName} ${version.productName}.`,
      source: this.id,
    }];
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}