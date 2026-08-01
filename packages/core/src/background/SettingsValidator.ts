import { recommendedSettings, type BackgroundSettings } from "./SettingsSchema.js";

const enumValues = {
  mediumRiskAction: new Set(["ignore", "notify", "sandbox", "ai"]),
  highRiskAction: new Set(["notify", "sandbox", "ai"]),
  performanceMode: new Set(["low", "balanced", "high"]),
  scanPriority: new Set(["low", "normal", "high"]),
  maximumParallelScans: new Set([0, 1, 2, 4, 8]),
} as const;

export function validateSettings(value: unknown, fallback: BackgroundSettings = recommendedSettings): BackgroundSettings {
  if (!value || typeof value !== "object") return fallback;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof BackgroundSettings>) {
    const candidate = source[key];
    if (typeof fallback[key] === "boolean" && typeof candidate === "boolean") result[key] = candidate;
    if (Array.isArray(fallback[key]) && Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string")) result[key] = Object.freeze([...candidate]);
  }
  for (const [key, valid] of Object.entries(enumValues)) if (valid.has(source[key] as never)) result[key] = source[key];
  return Object.freeze(result as unknown as BackgroundSettings);
}