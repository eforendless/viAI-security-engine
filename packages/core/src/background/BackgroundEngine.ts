import type { RealtimeMonitor } from "./RealtimeMonitor.js";
import type { BackgroundSettings } from "./SettingsSchema.js";

export class BackgroundEngine {
  private active = new Map<string, RealtimeMonitor>();
  constructor(private readonly monitors: readonly RealtimeMonitor[]) {}

  async apply(settings: BackgroundSettings): Promise<readonly string[]> {
    const desired = settings.backgroundProtection ? this.monitors.filter((monitor) => monitor.isEnabled(settings)) : [];
    const desiredIds = new Set(desired.map((monitor) => monitor.id));
    for (const [id, monitor] of this.active) if (!desiredIds.has(id)) { await monitor.stop(); this.active.delete(id); }
    for (const monitor of desired) if (!this.active.has(monitor.id)) { await monitor.start(); this.active.set(monitor.id, monitor); }
    return [...this.active.keys()];
  }

  async stop(): Promise<void> { for (const monitor of this.active.values()) await monitor.stop(); this.active.clear(); }
  activeIds(): readonly string[] { return [...this.active.keys()]; }
}