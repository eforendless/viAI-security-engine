import type { BackgroundSettings } from "./SettingsSchema.js";

export interface SettingsRepository {
  load(): Promise<unknown>;
  save(settings: BackgroundSettings): Promise<void>;
}