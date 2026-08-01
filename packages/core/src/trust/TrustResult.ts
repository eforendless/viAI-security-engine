import type { TrustIndicator } from "./TrustIndicator.js";

export interface TrustResult {
  readonly trustScore: number;
  readonly indicators: readonly TrustIndicator[];
}

export function createTrustResult(indicators: readonly TrustIndicator[]): TrustResult {
  const immutableIndicators = Object.freeze([...indicators]);
  return Object.freeze({
    trustScore: clamp(immutableIndicators.reduce((total, indicator) => total + indicator.weight, 0), 0, 100),
    indicators: immutableIndicators,
  });
}

export function emptyTrustResult(): TrustResult {
  return createTrustResult([]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}