import type { BackgroundEngine } from "./BackgroundEngine.js";
import type { SettingsService } from "./SettingsService.js";
import type { BackgroundSettings } from "./SettingsSchema.js";

export class BackgroundManager {
  constructor(private readonly settings: SettingsService, private readonly engine: BackgroundEngine) {}
  async initialize(): Promise<BackgroundSettings> { const settings = await this.settings.initialize(); await this.engine.apply(settings); return settings; }
  async update(changes: Partial<BackgroundSettings>): Promise<BackgroundSettings> { const settings = await this.settings.update(changes); await this.engine.apply(settings); return settings; }
  async restoreRecommended(): Promise<BackgroundSettings> { const settings = await this.settings.restoreRecommended(); await this.engine.apply(settings); return settings; }
  async restoreFactory(): Promise<BackgroundSettings> { const settings = await this.settings.restoreFactory(); await this.engine.apply(settings); return settings; }
  async stop(): Promise<void> { await this.engine.stop(); }
  current(): BackgroundSettings { return this.settings.current(); }
}