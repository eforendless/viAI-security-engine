export interface TrustIndicator {
  readonly id: string;
  readonly weight: number;
  readonly evidence: string;
  readonly source: string;
}