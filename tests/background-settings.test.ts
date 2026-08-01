import assert from "node:assert/strict";
import test from "node:test";
import { BackgroundEngine, SettingsService, recommendedSettings, type BackgroundSettings, type RealtimeMonitor, type SettingsRepository } from "../packages/core/src/rules/index.js";

class MemorySettingsRepository implements SettingsRepository {
  saved: BackgroundSettings | undefined;
  constructor(private value: unknown) {}
  async load(): Promise<unknown> { return this.value; }
  async save(settings: BackgroundSettings): Promise<void> { this.saved = settings; }
}

test("settings service retains only validated persisted settings and supports local restoration", async () => {
  const repository = new MemorySettingsRepository({ backgroundProtection: false, maximumParallelScans: 3, mediumRiskAction: "invalid", excludedFolders: ["C:\\safe"], unknown: true });
  const service = new SettingsService(repository);
  const initial = await service.initialize();
  assert.equal(initial.backgroundProtection, false);
  assert.equal(initial.maximumParallelScans, recommendedSettings.maximumParallelScans);
  assert.equal(initial.mediumRiskAction, recommendedSettings.mediumRiskAction);
  assert.deepEqual(initial.excludedFolders, ["C:\\safe"]);
  const updated = await service.update({ maximumParallelScans: 4, notifyHighRisk: false });
  assert.equal(updated.maximumParallelScans, 4);
  assert.equal(updated.notifyHighRisk, false);
  assert.equal(repository.saved?.maximumParallelScans, 4);
  assert.equal((repository.saved as unknown as Record<string, unknown>).unknown, undefined);
});

test("background engine dynamically starts and stops only monitors enabled by settings", async () => {
  const events: string[] = [];
  const monitor = (id: string, enabled: (settings: BackgroundSettings) => boolean): RealtimeMonitor => ({ id, isEnabled: enabled, start: async () => { events.push(`start:${id}`); }, stop: async () => { events.push(`stop:${id}`); } });
  const engine = new BackgroundEngine([monitor("downloads", (settings) => settings.monitorDownloads), monitor("usb", (settings) => settings.monitorUsbStorage)]);
  await engine.apply({ ...recommendedSettings, monitorDownloads: true, monitorUsbStorage: false });
  assert.deepEqual(engine.activeIds(), ["downloads"]);
  await engine.apply({ ...recommendedSettings, monitorDownloads: false, monitorUsbStorage: true });
  assert.deepEqual(engine.activeIds(), ["usb"]);
  assert.deepEqual(events, ["start:downloads", "stop:downloads", "start:usb"]);
  await engine.stop();
  assert.deepEqual(events.at(-1), "stop:usb");
});