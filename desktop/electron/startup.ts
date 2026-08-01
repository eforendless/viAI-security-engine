import { EventEmitter } from "node:events";

export interface StartupTask {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
  readonly dependencies?: readonly string[];
  execute(): Promise<void>;
}

export type StartupEventType = "started" | "completed" | "failed" | "ready";

export interface StartupProgress {
  readonly type: StartupEventType;
  readonly task?: Pick<StartupTask, "id" | "name" | "weight">;
  readonly progress: number;
  readonly completedWeight: number;
  readonly totalWeight: number;
  readonly durationMs?: number;
  readonly error?: string;
}

export class StartupEvents extends EventEmitter {}

export class StartupProgressService extends StartupEvents {
  private latest: StartupProgress = { type: "started", progress: 0, completedWeight: 0, totalWeight: 0 };

  snapshot(): StartupProgress { return this.latest; }
  publish(progress: StartupProgress): void { this.latest = progress; this.emit("progress", progress); }
  subscribe(listener: (progress: StartupProgress) => void): () => void { this.on("progress", listener); return () => this.off("progress", listener); }
}

export class StartupPipeline {
  private readonly tasks = new Map<string, StartupTask>();
  private readonly completed = new Set<string>();

  constructor(tasks: readonly StartupTask[], private readonly progress: StartupProgressService) {
    for (const task of tasks) {
      if (!task.id || task.weight <= 0 || this.tasks.has(task.id)) throw new Error(`Invalid startup task '${task.id}'`);
      this.tasks.set(task.id, task);
    }
    for (const task of this.tasks.values()) for (const dependency of task.dependencies ?? []) if (!this.tasks.has(dependency)) throw new Error(`Startup task '${task.id}' depends on unknown task '${dependency}'`);
  }

  async execute(): Promise<void> {
    const totalWeight = [...this.tasks.values()].reduce((total, task) => total + task.weight, 0);
    while (this.completed.size < this.tasks.size) {
      const task = [...this.tasks.values()].find((candidate) => !this.completed.has(candidate.id) && (candidate.dependencies ?? []).every((dependency) => this.completed.has(dependency)));
      if (!task) throw new Error("Startup task dependencies cannot be resolved");
      const completedWeight = this.completedWeight();
      this.progress.publish({ type: "started", task, progress: percent(completedWeight, totalWeight), completedWeight, totalWeight });
      const startedAt = Date.now();
      try {
        await task.execute();
      } catch (error) {
        this.progress.publish({ type: "failed", task, progress: percent(completedWeight, totalWeight), completedWeight, totalWeight, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      this.completed.add(task.id);
      const nextWeight = this.completedWeight();
      this.progress.publish({ type: "completed", task, progress: percent(nextWeight, totalWeight), completedWeight: nextWeight, totalWeight, durationMs: Date.now() - startedAt });
    }
    this.progress.publish({ type: "ready", progress: 100, completedWeight: totalWeight, totalWeight });
  }

  private completedWeight(): number { return [...this.completed].reduce((total, id) => total + (this.tasks.get(id)?.weight ?? 0), 0); }
}

export class StartupManager {
  readonly progress = new StartupProgressService();
  private pipeline?: StartupPipeline;

  register(tasks: readonly StartupTask[]): void {
    if (this.pipeline) throw new Error("Startup tasks are already registered");
    this.pipeline = new StartupPipeline(tasks, this.progress);
  }

  async start(): Promise<void> {
    if (!this.pipeline) throw new Error("No startup tasks are registered");
    await this.pipeline.execute();
  }

  retry(): Promise<void> { return this.start(); }
}

function percent(completedWeight: number, totalWeight: number): number { return totalWeight === 0 ? 100 : Math.round((completedWeight / totalWeight) * 100); }