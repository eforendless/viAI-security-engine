import { useCallback } from "react";
import toast from "react-hot-toast";
import { analyzeFile } from "../api/engineClient";
import { useSecurityStore } from "../store/securityStore";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function useScan() {
  const runPaths = useCallback(async (paths: string[], mode: "quick" | "full" | "folder", target: string) => {
    if (paths.length === 0) {
      toast.error("No eligible executable files were found in this location.");
      return;
    }
    useSecurityStore.getState().beginScan(mode, target, paths.length);
    let investigationCount = 0;
    let nextIndex = 0;
    let completed = 0;
    const settings = useSecurityStore.getState();
    const concurrency = settings.performanceMode === "quiet" ? 1 : settings.performanceMode === "balanced" ? Math.min(settings.threadCount, 4) : settings.threadCount;
    const analyzeNext = async () => {
      while (true) {
        while (useSecurityStore.getState().scan.paused) await wait(200);
        if (useSecurityStore.getState().scan.cancelled || nextIndex >= paths.length) return;
        const index = nextIndex;
        nextIndex += 1;
        const filePath = paths[index];
        try {
          const result = await analyzeFile(filePath);
          useSecurityStore.getState().addHistory(result.analysis);
          if (result.riskScore > 25) investigationCount += 1;
        } catch {
          toast.error(`Could not analyze ${filePath.split(/[\\/]/).pop()}`, { id: `failure-${index}` });
        }
        completed += 1;
        useSecurityStore.getState().setProgress(completed, filePath, investigationCount);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => analyzeNext()));
    const current = useSecurityStore.getState().scan;
    useSecurityStore.getState().finishScan();
    if (!current.cancelled) toast.success(`Scan complete: ${investigationCount} item${investigationCount === 1 ? "" : "s"} need investigation.`);
  }, []);

  const quickScan = useCallback(async (path: string) => runPaths([path], "quick", path), [runPaths]);
  const folderScan = useCallback(async (path: string) => runPaths(await window.viai?.listFiles([path], 1000) ?? [], "folder", path), [runPaths]);
  const fullScan = useCallback(async () => {
    if (!window.viai) {
      toast.error("Full system scanning is available in the Electron desktop app.");
      return;
    }
    toast.loading("Collecting executable candidates from protected scan locations...", { id: "collecting" });
    const roots = await window.viai.systemRoots();
    const files = await window.viai.listFiles(roots, 2500);
    toast.dismiss("collecting");
    await runPaths(files, "full", "Windows system locations");
  }, [runPaths]);

  return { quickScan, folderScan, fullScan };
}