import { EventEmitter } from "node:events";
import type { AnalysisResult, FileActivityEvent, MonitorObservation } from "../types.js";
import type { AnalysisPipeline } from "./pipeline.js";

export class EventManager extends EventEmitter {
  constructor(private readonly pipeline: AnalysisPipeline) {
    super();
    this.on("file-activity", (event: FileActivityEvent) => void this.process(event));
  }

  publish(event: FileActivityEvent): void {
    this.emit("file-activity", event);
  }

  observe(observation: MonitorObservation): void {
    this.emit("monitor-observation", observation);
  }

  private async process(event: FileActivityEvent): Promise<void> {
    try {
      const analysis = await this.pipeline.analyze(event.path, event.source);
      this.emit("analysis-complete", analysis, event);
    } catch (error) {
      this.emit("analysis-error", error, event);
    }
  }
}

export type AnalysisCompleteListener = (analysis: AnalysisResult, event: FileActivityEvent) => void;