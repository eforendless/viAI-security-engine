export type PerformanceMode = "low" | "balanced" | "high";
export type ScanPriority = "low" | "normal" | "high";
export type MediumRiskAction = "ignore" | "notify" | "sandbox" | "ai";
export type HighRiskAction = "notify" | "sandbox" | "ai";

export interface BackgroundSettings {
  readonly backgroundProtection: boolean;
  readonly runAfterWindowCloses: boolean;
  readonly launchOnStartup: boolean;
  readonly startMinimized: boolean;
  readonly startSilently: boolean;
  readonly openDashboardAfterStartup: boolean;
  readonly minimizeToTray: boolean;
  readonly windowsNotifications: boolean;
  readonly soundNotifications: boolean;
  readonly monitorFileCreation: boolean;
  readonly monitorFileModification: boolean;
  readonly monitorFileRename: boolean;
  readonly monitorFileDeletion: boolean;
  readonly monitorDownloads: boolean;
  readonly monitorDesktop: boolean;
  readonly monitorDocuments: boolean;
  readonly monitorUsbStorage: boolean;
  readonly monitorNetworkShares: boolean;
  readonly scanExecutables: boolean;
  readonly scanDlls: boolean;
  readonly scanScripts: boolean;
  readonly scanOfficeDocuments: boolean;
  readonly scanArchives: boolean;
  readonly scanPdfs: boolean;
  readonly scanInstallers: boolean;
  readonly scanShortcuts: boolean;
  readonly scanBatchFiles: boolean;
  readonly scanPowerShellScripts: boolean;
  readonly scanJavaScriptFiles: boolean;
  readonly scanPythonScripts: boolean;
  readonly scanUnknownFileTypes: boolean;
  readonly automaticDownloadScan: boolean;
  readonly scanBrowserDownloads: boolean;
  readonly scanTorrentDownloads: boolean;
  readonly scanCompressedDownloads: boolean;
  readonly delayExecutionUntilScanCompletes: boolean;
  readonly monitorUsbInsertion: boolean;
  readonly automaticallyScanUsb: boolean;
  readonly monitorExternalSsd: boolean;
  readonly monitorExternalHdd: boolean;
  readonly monitorSdCards: boolean;
  readonly monitorSmartphones: boolean;
  readonly monitorUnknownUsbDevices: boolean;
  readonly monitorNewProcesses: boolean;
  readonly monitorChildProcesses: boolean;
  readonly monitorSuspiciousCommandLines: boolean;
  readonly monitorPowerShell: boolean;
  readonly monitorCmd: boolean;
  readonly monitorWScript: boolean;
  readonly monitorMshta: boolean;
  readonly monitorStartupFolder: boolean;
  readonly monitorScheduledTasks: boolean;
  readonly monitorRegistryRunKeys: boolean;
  readonly monitorServices: boolean;
  readonly monitorDrivers: boolean;
  readonly notifySafeScan: boolean;
  readonly notifyMediumRisk: boolean;
  readonly notifyHighRisk: boolean;
  readonly notifyUsbConnected: boolean;
  readonly notifyUsbRemoved: boolean;
  readonly notifyBackgroundStarted: boolean;
  readonly notifyBackgroundStopped: boolean;
  readonly notifyEngineUpdates: boolean;
  readonly notifyScanCompleted: boolean;
  readonly mediumRiskAction: MediumRiskAction;
  readonly highRiskAction: HighRiskAction;
  readonly performanceMode: PerformanceMode;
  readonly scanPriority: ScanPriority;
  readonly maximumParallelScans: 0 | 1 | 2 | 4 | 8;
  readonly customFolders: readonly string[];
  readonly excludedFolders: readonly string[];
  readonly excludedFiles: readonly string[];
  readonly excludedExtensions: readonly string[];
  readonly excludedProcesses: readonly string[];
}

const enabled = true;
const disabled = false;

export const recommendedSettings: BackgroundSettings = Object.freeze({
  backgroundProtection: enabled, runAfterWindowCloses: enabled, launchOnStartup: enabled, startMinimized: disabled, startSilently: disabled, openDashboardAfterStartup: enabled, minimizeToTray: enabled, windowsNotifications: enabled, soundNotifications: disabled,
  monitorFileCreation: enabled, monitorFileModification: enabled, monitorFileRename: enabled, monitorFileDeletion: disabled, monitorDownloads: enabled, monitorDesktop: disabled, monitorDocuments: disabled, monitorUsbStorage: enabled, monitorNetworkShares: disabled,
  scanExecutables: enabled, scanDlls: enabled, scanScripts: enabled, scanOfficeDocuments: disabled, scanArchives: disabled, scanPdfs: disabled, scanInstallers: enabled, scanShortcuts: disabled, scanBatchFiles: enabled, scanPowerShellScripts: enabled, scanJavaScriptFiles: enabled, scanPythonScripts: disabled, scanUnknownFileTypes: disabled,
  automaticDownloadScan: enabled, scanBrowserDownloads: enabled, scanTorrentDownloads: disabled, scanCompressedDownloads: disabled, delayExecutionUntilScanCompletes: disabled,
  monitorUsbInsertion: enabled, automaticallyScanUsb: enabled, monitorExternalSsd: enabled, monitorExternalHdd: enabled, monitorSdCards: enabled, monitorSmartphones: disabled, monitorUnknownUsbDevices: enabled,
  monitorNewProcesses: disabled, monitorChildProcesses: disabled, monitorSuspiciousCommandLines: disabled, monitorPowerShell: disabled, monitorCmd: disabled, monitorWScript: disabled, monitorMshta: disabled,
  monitorStartupFolder: disabled, monitorScheduledTasks: disabled, monitorRegistryRunKeys: disabled, monitorServices: disabled, monitorDrivers: disabled,
  notifySafeScan: disabled, notifyMediumRisk: enabled, notifyHighRisk: enabled, notifyUsbConnected: enabled, notifyUsbRemoved: enabled, notifyBackgroundStarted: enabled, notifyBackgroundStopped: disabled, notifyEngineUpdates: enabled, notifyScanCompleted: enabled,
  mediumRiskAction: "sandbox", highRiskAction: "ai", performanceMode: "balanced", scanPriority: "normal", maximumParallelScans: 0,
  customFolders: [], excludedFolders: [], excludedFiles: [], excludedExtensions: [], excludedProcesses: [],
});

export const factorySettings: BackgroundSettings = Object.freeze({ ...recommendedSettings, backgroundProtection: disabled, runAfterWindowCloses: disabled, launchOnStartup: disabled, minimizeToTray: disabled, automaticDownloadScan: disabled, automaticallyScanUsb: disabled, windowsNotifications: disabled });