export type ScanLifecycleState = "starting" | "running" | "pausing" | "paused" | "resuming" | "cancelling" | "finalizing" | "cancelled" | "completed" | "failed";

export class ScanController {
  readonly abortController = new AbortController();
  private readonly listeners = new Set<(state: ScanLifecycleState) => void>();
  private readonly waiters = new Set<() => void>();
  private currentState: ScanLifecycleState;

  constructor(readonly scanId: string, initialState: ScanLifecycleState = "starting") {
    this.currentState = initialState;
  }

  get state(): ScanLifecycleState { return this.currentState; }
  get signal(): AbortSignal { return this.abortController.signal; }

  onStateChange(listener: (state: ScanLifecycleState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  transition(state: ScanLifecycleState): void {
    if (this.currentState === state || isTerminal(this.currentState)) return;
    this.currentState = state;
    if (state === "cancelled" || state === "completed" || state === "failed" || state === "running") this.releaseWaiters();
    for (const listener of this.listeners) listener(state);
  }

  requestPause(): boolean {
    if (this.currentState !== "running") return false;
    this.transition("pausing");
    return true;
  }

  markPaused(): boolean {
    if (this.currentState !== "pausing") return false;
    this.transition("paused");
    return true;
  }

  beginResume(): boolean {
    if (this.currentState !== "paused") return false;
    this.transition("resuming");
    return true;
  }

  markRunning(): boolean {
    if (this.currentState !== "resuming" && this.currentState !== "starting") return false;
    this.transition("running");
    return true;
  }

  cancel(): boolean {
    if (isTerminal(this.currentState) || this.currentState === "cancelling" || this.currentState === "finalizing") return false;
    this.transition("cancelling");
    this.abortController.abort(abortError());
    this.releaseWaiters();
    return true;
  }

  async waitUntilRunnable(): Promise<boolean> {
    while (!this.signal.aborted && this.currentState !== "running") {
      if (isTerminal(this.currentState)) return false;
      await new Promise<void>((resolve) => this.waiters.add(resolve));
    }
    return !this.signal.aborted && this.currentState === "running";
  }

  private releaseWaiters(): void {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}

function isTerminal(state: ScanLifecycleState): boolean {
  return state === "cancelled" || state === "completed" || state === "failed";
}

function abortError(): Error {
  const error = new Error("Scan cancelled");
  error.name = "AbortError";
  return error;
}