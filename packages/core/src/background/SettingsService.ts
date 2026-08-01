import { factorySettings, recommendedSettings, type BackgroundSettings } from "./SettingsSchema.js";
import type { SettingsRepository } from "./SettingsRepository.js";
import { validateSettings } from "./SettingsValidator.js";

export class SettingsService {
  private settings = recommendedSettings;
  constructor(private readonly repository: SettingsRepository) {}

  async initialize(): Promise<BackgroundSettings> {
    this.settings = validateSettings(await this.repository.load());
    return this.settings;
  }

  current(): BackgroundSettings { return this.settings; }
  async update(changes: Partial<BackgroundSettings>): Promise<BackgroundSettings> { this.settings = validateSettings({ ...this.settings, ...changes }); await this.repository.save(this.settings); return this.settings; }
  async restoreRecommended(): Promise<BackgroundSettings> { this.settings = recommendedSettings; await this.repository.save(this.settings); return this.settings; }
  async restoreFactory(): Promise<BackgroundSettings> { this.settings = factorySettings; await this.repository.save(this.settings); return this.settings; }
  export(): string { return JSON.stringify(this.settings, null, 2); }
  async import(serialized: string): Promise<BackgroundSettings> { this.settings = validateSettings(JSON.parse(serialized)); await this.repository.save(this.settings); return this.settings; }
}