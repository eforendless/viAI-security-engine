import { create } from "zustand";
import type { EngineAnalysis, HistoryItem } from "../types";

export interface ScanState {
  active: boolean;
  paused: boolean;
  cancelled: boolean;
  mode: "quick" | "full" | "folder";
  target: string;
  total: number;
  completed: number;
  investigationCount: number;
  currentPath: string;
  startedAt?: number;
}

interface SecurityState {
  engineOnline: boolean;
  history: HistoryItem[];
  scan: ScanState;
  downloadMonitoring: boolean;
  usbMonitoring: boolean;
  executableMonitoring: boolean;
  darkMode: boolean;
  performanceMode: "balanced" | "quiet" | "performance";
  threadCount: number;
  setEngineOnline(online: boolean): void;
  addHistory(analysis: EngineAnalysis): void;
  beginScan(mode: ScanState["mode"], target: string, total: number): void;
  setProgress(completed: number, currentPath: string, investigationCount: number): void;
  pauseScan(): void;
  resumeScan(): void;
  cancelScan(): void;
  finishScan(): void;
  toggleMonitoring(key: "downloadMonitoring" | "usbMonitoring" | "executableMonitoring"): void;
  setMonitoringStatus(status: Pick<SecurityState, "downloadMonitoring" | "usbMonitoring" | "executableMonitoring">): void;
  setDarkMode(value: boolean): void;
  setPerformanceMode(value: SecurityState["performanceMode"]): void;
  setThreadCount(value: number): void;
}

const idleScan: ScanState = { active: false, paused: false, cancelled: false, mode: "quick", target: "", total: 0, completed: 0, investigationCount: 0, currentPath: "" };

export const useSecurityStore = create<SecurityState>((set) => ({
  engineOnline: false,
  history: [],
  scan: idleScan,
  downloadMonitoring: true,
  usbMonitoring: true,
  executableMonitoring: true,
  darkMode: false,
  performanceMode: "balanced",
  threadCount: 4,
  setEngineOnline: (engineOnline) => set({ engineOnline }),
  addHistory: (analysis) => set((state) => state.history.some((item) => item.hashes.sha256 === analysis.hashes.sha256 && item.analyzedAt === analysis.analyzedAt) ? state : ({ history: [{ ...analysis, id: crypto.randomUUID() }, ...state.history].slice(0, 500) })),
  beginScan: (mode, target, total) => set({ scan: { active: true, paused: false, cancelled: false, mode, target, total, completed: 0, investigationCount: 0, currentPath: "Preparing local analysis...", startedAt: Date.now() } }),
  setProgress: (completed, currentPath, investigationCount) => set((state) => ({ scan: { ...state.scan, completed, currentPath, investigationCount } })),
  pauseScan: () => set((state) => ({ scan: { ...state.scan, paused: true } })),
  resumeScan: () => set((state) => ({ scan: { ...state.scan, paused: false } })),
  cancelScan: () => set((state) => ({ scan: { ...state.scan, cancelled: true, paused: false } })),
  finishScan: () => set((state) => ({ scan: { ...state.scan, active: false, paused: false, currentPath: state.scan.cancelled ? "Scan cancelled" : "Local analysis complete" } })),
  toggleMonitoring: (key) => set((state) => ({ [key]: !state[key] })),
  setMonitoringStatus: (status) => set(status),
  setDarkMode: (darkMode) => set({ darkMode }),
  setPerformanceMode: (performanceMode) => set({ performanceMode }),
  setThreadCount: (threadCount) => set({ threadCount }),
}));