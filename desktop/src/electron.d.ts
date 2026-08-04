export {};

declare global {
  interface Window {
    viai?: {
      application: {
        version(): Promise<string>;
        engineVersion(): Promise<string>;
        clearLocalData(): Promise<void>;
      };
      system: {
        overview(): Promise<unknown>;
      };
      updates: {
        snapshot(): Promise<unknown>;
        check(): Promise<unknown>;
        download(): Promise<unknown>;
        install(): Promise<void>;
        onChanged(listener: (update: unknown) => void): () => void;
      };
      background: {
        snapshot(): Promise<unknown>;
        historyRecord(id: string): Promise<unknown>;
        update(changes: Record<string, unknown>): Promise<unknown>;
        restoreRecommended(): Promise<unknown>;
        restoreFactory(): Promise<unknown>;
        exportSettings(): Promise<string | undefined>;
        importSettings(serialized: string): Promise<unknown>;
        clearHistory(scope?: "all" | "low" | "medium" | "high"): Promise<void>;
        removeHistory(ids: string[]): Promise<unknown>;
        onChanged(listener: (snapshot: unknown) => void): () => void;
        onCommand(listener: (command: "quick-scan" | "realtime" | "history" | "settings") => void): () => void;
      };
      deviceSecurity: {
        snapshot(): Promise<unknown>;
        setTrust(deviceId: string, trusted: boolean): Promise<void>;
        scan(deviceId: string): Promise<void>;
        onChanged(listener: (update: unknown) => void): () => void;
      };
      windowControls: {
        minimize(): Promise<void>;
        maximize(): Promise<void>;
        close(): Promise<void>;
      };
      chooseFile(): Promise<string | undefined>;
      chooseFolder(): Promise<string | undefined>;
      openPath(filePath?: string): Promise<string>;
      scans: {
        start(mode: "quick" | "full" | "folder", target?: string): Promise<unknown>;
        pause(): Promise<void>;
        resume(): Promise<void>;
        cancel(): Promise<void>;
        onEvent(listener: (update: unknown) => void): () => void;
      };
      listFiles(roots: string[], maxFiles?: number): Promise<string[]>;
      systemRoots(): Promise<string[]>;
      analyzeFile(filePath: string): Promise<unknown>;
      probeEngine(): Promise<boolean>;
      engineEvents(): Promise<unknown[]>;
      monitoringStatus(): Promise<unknown>;
      setMonitoring(updates: Record<string, boolean | string[]>): Promise<unknown>;
    };
  }
}