import type { BackgroundSettings } from "./SettingsSchema.js";

export interface RealtimeMonitor {
  readonly id: string;
  isEnabled(settings: BackgroundSettings): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}