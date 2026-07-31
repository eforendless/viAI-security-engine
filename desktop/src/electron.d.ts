export {};

declare global {
  interface Window {
    viai?: {
      chooseFile(): Promise<string | undefined>;
      chooseFolder(): Promise<string | undefined>;
      openPath(filePath: string): Promise<string>;
      listFiles(roots: string[], maxFiles?: number): Promise<string[]>;
      systemRoots(): Promise<string[]>;
      analyzeFile(filePath: string): Promise<unknown>;
      probeEngine(): Promise<boolean>;
    };
  }
}