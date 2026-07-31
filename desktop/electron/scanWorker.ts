import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const executableExtensions = new Set([".exe", ".dll", ".msi", ".scr", ".bat", ".cmd", ".ps1", ".jar"]);
const skippedDirectories = new Set(["$recycle.bin", "system volume information", "node_modules", "winsxs", "windows"]);
const root = (workerData as { root: string }).root;

async function scan(directory: string): Promise<void> {
  try {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name.toLowerCase())) await scan(path);
      } else if (entry.isFile() && executableExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
        parentPort?.postMessage(path);
      }
    }
  } catch {
    return;
  }
}

void scan(root);