import type { BackgroundSettings } from "./SettingsSchema.js";

export interface SettingsRepository {
  load(): Promise<unknown>;
  save(settings: BackgroundSettings): Promise<void>;
  update(changes: Partial<BackgroundSettings>): Promise<unknown>;
  reset(): Promise<unknown>;
  subscribe(listener: (settings: unknown) => void): () => void;
}