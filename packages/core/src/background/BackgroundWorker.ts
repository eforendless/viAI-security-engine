export interface BackgroundWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}