import { factorySettings, recommendedSettings, type BackgroundSettings } from "./SettingsSchema.js";
import type { SettingsRepository } from "./SettingsRepository.js";
import { validateSettings } from "./SettingsValidator.js";

export class SettingsService {
  private settings = recommendedSettings;
  private unsubscribe?: () => void;
  constructor(private readonly repository: SettingsRepository) {}

  async initialize(): Promise<BackgroundSettings> {
    this.settings = validateSettings(await this.repository.load());
    this.unsubscribe?.();
    this.unsubscribe = this.repository.subscribe((next) => { this.settings = validateSettings(next); });
    return this.settings;
  }

  current(): BackgroundSettings { return this.settings; }
  async update(changes: Partial<BackgroundSettings>): Promise<BackgroundSettings> { const next = validateSettings({ ...this.settings, ...changes }); this.settings = validateSettings(await this.repository.update(next)); return this.settings; }
  async reset(): Promise<BackgroundSettings> { this.settings = validateSettings(await this.repository.reset()); return this.settings; }
  async restoreRecommended(): Promise<BackgroundSettings> { this.settings = recommendedSettings; await this.repository.save(this.settings); return this.settings; }
  async restoreFactory(): Promise<BackgroundSettings> { this.settings = factorySettings; await this.repository.save(this.settings); return this.settings; }
  export(): string { return JSON.stringify(this.settings, null, 2); }
  async import(serialized: string): Promise<BackgroundSettings> { this.settings = validateSettings(JSON.parse(serialized)); await this.repository.save(this.settings); return this.settings; }
  dispose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
}