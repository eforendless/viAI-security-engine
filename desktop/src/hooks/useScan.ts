import { useCallback } from "react";
import toast from "react-hot-toast";

export function useScan() {
  const start = useCallback(async (mode: "quick" | "full" | "folder", target?: string) => {
    if (!window.viai) { toast.error("Scanning is available in the Electron desktop app."); return; }
    try { await window.viai.scans.start(mode, target); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not start the local scan."); }
  }, []);
  const quickScan = useCallback(async (path: string) => start("quick", path), [start]);
  const folderScan = useCallback(async (path: string) => start("folder", path), [start]);
  const fullScan = useCallback(async () => start("full"), [start]);

  return { quickScan, folderScan, fullScan };
}