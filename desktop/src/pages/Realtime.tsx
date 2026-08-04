import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Activity, Bell, Download, FolderCog, HardDrive, History, MonitorDot, Power, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Upload, X } from "lucide-react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Button, Panel, Toggle } from "../components/ui";
import { pageMotion } from "../animations/motion";
import { matchesRealtimeSearch } from "../realtimeSearch";

type Settings = Record<string, boolean | string | number | string[]>;
interface Snapshot { settings: Settings; history: unknown[]; activeMonitors: string[]; }
interface SettingGroup { title: string; icon: typeof Power; advanced?: boolean; options: Array<[string, string, string]>; }
const empty: Snapshot = { settings: {}, history: [], activeMonitors: [] };

const groups: SettingGroup[] = [
  { title: "Monitoring service", icon: Power, options: [["backgroundProtection", "Enable background monitoring", "Runs enabled local monitors when the desktop window is hidden."], ["runAfterWindowCloses", "Continue after window closes", "Closing the desktop window leaves enabled local monitoring running."], ["launchOnStartup", "Launch viAI on Windows startup", "Registers this local desktop application at Windows sign-in."], ["startMinimized", "Start minimized", "Minimizes the desktop window when viAI launches at sign-in."], ["startSilently", "Start silently", "At Windows startup, starts without opening a visible window."], ["minimizeToTray", "Minimize to tray", "Hides the window when minimized; use the tray icon to restore it."]] },
  { title: "Candidate observation", icon: FolderCog, options: [["monitorFileCreationOrRename", "Observe created or renamed files", "Queues eligible candidate files that arrive through a create or rename filesystem event."], ["monitorFileModification", "Observe modified files", "Queues eligible files modified in selected local locations for static analysis."], ["monitorDownloads", "Monitor Downloads", "Enables the local download candidate monitor."], ["monitorDesktop", "Monitor Desktop", "Adds the current user's Desktop to filesystem candidate observation."], ["monitorDocuments", "Monitor Documents", "Adds the current user's Documents to filesystem candidate observation."], ["monitorStartupFolder", "Monitor Startup folder", "Adds the current user's Windows Startup folder to candidate observation."]] },
  { title: "Static analysis scope", icon: ShieldCheck, options: [["scanExecutables", "Executable files", "Include .exe, .scr, and .com candidates."], ["scanDlls", "DLL and control files", "Include .dll, .ocx, and .cpl candidates."], ["scanInstallers", "Installer packages", "Include .msi, .msp, and .appx candidates."], ["scanScripts", "Windows Script Host files", "Include .vbs, .vbe, and .wsf candidates."], ["scanBatchFiles", "Batch and CMD files", "Include .bat and .cmd candidates."], ["scanPowerShellScripts", "PowerShell scripts", "Include .ps1, .psm1, and .psd1 candidates."], ["scanJavaScriptFiles", "JavaScript and HTA files", "Include .js, .jse, and .hta candidates."], ["scanPythonScripts", "Python scripts", "Include .py and .pyw candidates."], ["scanOfficeDocuments", "Office documents", "Include supported Office document candidates for static inspection."], ["scanArchives", "Archives", "Include archive candidates without extracting or executing contents."], ["scanPdfs", "PDF documents", "Include PDF candidates for static inspection."], ["scanShortcuts", "Shortcuts", "Include .lnk and .url candidates for static inspection."], ["scanUnknownFileTypes", "Unknown file types", "Queue files outside the selected extensions for local static analysis."]] },
  { title: "Downloads and removable media", icon: Download, options: [["automaticDownloadScan", "Analyze downloaded candidates", "Submits eligible downloaded files to the local static-analysis pipeline."], ["scanBrowserDownloads", "Include standard Downloads folder", "Applies download monitoring to the current user's standard Downloads folder."], ["monitorUsbStorage", "Show removable storage activity", "Displays removable-device activity through Device Security."], ["monitorUsbInsertion", "Record USB arrival", "Records Windows Plug and Play device arrivals locally."], ["automaticallyScanUsb", "Analyze removable-media candidates", "Submits eligible removable-media files to local static analysis."]] },
  { title: "Process and Windows observation", icon: Settings2, advanced: true, options: [["monitorNewProcesses", "Observe new processes", "Analyzes the executable path of newly observed Windows processes locally."], ["monitorChildProcesses", "Observe child processes", "Includes newly observed child-process activity."], ["monitorSuspiciousCommandLines", "Observe high-signal command patterns", "Selects processes with high-signal patterns; command lines are not retained."], ["monitorPowerShell", "Observe PowerShell hosts", "Analyzes the executable path of newly observed PowerShell hosts."], ["monitorCmd", "Observe CMD hosts", "Analyzes the executable path of newly observed CMD hosts."], ["monitorWScript", "Observe Windows Script Host", "Analyzes the executable path of newly observed Windows Script Host processes."], ["monitorMshta", "Observe MSHTA", "Analyzes the executable path of newly observed MSHTA processes."], ["monitorScheduledTasks", "Observe scheduled tasks", "Records scheduled-task additions or changes locally."], ["monitorRegistryRunKeys", "Observe Registry Run keys", "Records Windows Run-key additions or changes locally."], ["monitorServices", "Observe services", "Records service additions or changes locally."], ["monitorDrivers", "Observe drivers", "Records driver additions or changes locally."]] },
  { title: "Notifications", icon: Bell, options: [["windowsNotifications", "Enable Windows notifications", "Shows native Windows notifications for selected local events."], ["soundNotifications", "Enable notification sounds", "Allows Windows to play notification sounds."], ["notifyMediumRisk", "Investigation recommended", "Notify when a static assessment needs investigation."], ["notifyHighRisk", "High-priority investigation", "Notify when static evidence requires urgent investigation."], ["notifyUsbConnected", "USB connected", "Notify when Device Security records a USB arrival."], ["notifyUsbRemoved", "USB removed", "Notify when Device Security records a USB removal."], ["notifyProtectionFailures", "Protection needs attention", "Notify when an enabled local monitoring component is degraded."], ["notifyScanCompleted", "Static analysis completed", "Notify when a local analysis reaches completion."]] },
];

export default function Realtime() {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    void window.viai?.background.snapshot().then((value) => { if (mounted && value) setSnapshot(value as Snapshot); });
    return window.viai?.background.onChanged((value) => { if (mounted && value) setSnapshot(value as Snapshot); });
  }, []);

  const update = async (changes: Record<string, unknown>) => {
    try {
      const next = await window.viai?.background.update(changes);
      if (next) setSnapshot(next as Snapshot);
    } catch {
      toast.error("Could not save realtime monitoring settings.");
    }
  };
  const toggle = (key: string) => {
    if (key === "monitorFileCreationOrRename") {
      const enabled = snapshot.settings.monitorFileCreation === true || snapshot.settings.monitorFileRename === true;
      void update({ monitorFileCreation: !enabled, monitorFileRename: !enabled });
      return;
    }
    void update({ [key]: snapshot.settings[key] !== true });
  };
  const choosePath = async (key: "customFolders" | "excludedFolders" | "excludedFiles") => {
    const path = key === "excludedFiles" ? await window.viai?.chooseFile() : await window.viai?.chooseFolder();
    if (!path) return;
    const values = list(snapshot.settings[key]);
    if (!values.includes(path)) await update({ [key]: [...values, path] });
  };
  const removePath = (key: "customFolders" | "excludedFolders" | "excludedFiles", path: string) => void update({ [key]: list(snapshot.settings[key]).filter((entry) => entry !== path) });
  const restore = async (kind: "recommended" | "factory") => {
    const next = kind === "recommended" ? await window.viai?.background.restoreRecommended() : await window.viai?.background.restoreFactory();
    if (next) {
      setSnapshot(next as Snapshot);
      toast.success(kind === "recommended" ? "Recommended settings restored." : "Factory defaults restored.");
    }
  };
  const exportSettings = async () => {
    const serialized = await window.viai?.background.exportSettings();
    if (!serialized) return;
    const url = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "viai-realtime-settings.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const next = await window.viai?.background.importSettings(await file.text());
      if (next) {
        setSnapshot(next as Snapshot);
        toast.success("Settings imported locally.");
      }
    } catch {
      toast.error("That settings file is invalid.");
    } finally {
      event.target.value = "";
    }
  };

  const normalizedQuery = query.trim();
  const visible = groups.filter((group) => (!group.advanced || advanced) && matchesRealtimeSearch(group, normalizedQuery));
  const enabled = snapshot.settings.backgroundProtection === true;

  return <motion.div {...pageMotion} className="page-stack realtime-page">
    <div className="page-title split-title">
      <div><p className="eyebrow">STATIC ENGINE V0.3</p><h2>Realtime Protection</h2><p>Local monitors submit eligible candidates for static evidence collection. viAI reports an assessment and recommended next step; it does not block, quarantine, sandbox, or execute files.</p></div>
      <div className={`realtime-state ${enabled ? "ready" : ""}`}><span className={enabled ? "status-dot ready" : "status-dot"} />{enabled ? "Monitoring active" : "Monitoring paused"}</div>
    </div>
    <Panel className="realtime-hero">
      <div><span className={`realtime-hero-icon ${enabled ? "ready" : ""}`}><Activity size={21} /></span><div><p className="eyebrow">LOCAL OBSERVATION</p><h3>{enabled ? "Monitors are ready for candidate files" : "Local monitoring is paused"}</h3><p>{enabled ? "Enabled monitors submit eligible files to the bounded v0.3 static-analysis pipeline." : "Turn on background monitoring to start the enabled local observers."}</p></div></div>
      <Button className={enabled ? "" : "primary"} onClick={() => toggle("backgroundProtection")}>{enabled ? "Pause monitoring" : "Enable monitoring"}</Button>
    </Panel>
    <section className="realtime-monitor-grid" aria-label="Monitor status">
      <MonitorStatus icon={Download} label="Downloads" detail="Downloaded candidates" configured={enabled && snapshot.settings.monitorDownloads === true && snapshot.settings.automaticDownloadScan === true && snapshot.settings.scanBrowserDownloads === true} active={snapshot.activeMonitors.includes("download-files")} />
      <MonitorStatus icon={FolderCog} label="File candidates" detail="Selected local locations" configured={enabled && (snapshot.settings.monitorDesktop === true || snapshot.settings.monitorDocuments === true || snapshot.settings.monitorStartupFolder === true || list(snapshot.settings.customFolders).length > 0)} active={snapshot.activeMonitors.includes("filesystem-candidates")} />
      <MonitorStatus icon={HardDrive} label="Removable media" detail="Device Security activity" configured={enabled && (snapshot.settings.monitorUsbStorage === true || snapshot.settings.monitorUsbInsertion === true)} active={snapshot.activeMonitors.includes("device-security")} />
      <MonitorStatus icon={MonitorDot} label="System observation" detail="Process and Windows events" configured={enabled && (snapshot.settings.monitorNewProcesses === true || snapshot.settings.monitorChildProcesses === true || snapshot.settings.monitorSuspiciousCommandLines === true || snapshot.settings.monitorPowerShell === true || snapshot.settings.monitorCmd === true || snapshot.settings.monitorWScript === true || snapshot.settings.monitorMshta === true || snapshot.settings.monitorScheduledTasks === true || snapshot.settings.monitorRegistryRunKeys === true || snapshot.settings.monitorServices === true || snapshot.settings.monitorDrivers === true)} active={snapshot.activeMonitors.some((id) => id === "process-observation" || id === "windows-startup-folder" || id === "windows-configuration-observation")} />
    </section>
    <Panel className="recommended-panel">
      <div><span className="recommendation-mark"><ShieldCheck size={20} /></span><div><h3>v0.3 response boundary</h3><p>Static analysis preserves evidence, confidence, verdict, investigation priority, and recommendation. A dynamic-analysis recommendation is a request for additional evidence, not an automated sandbox or AI action.</p></div></div>
      <Button onClick={() => void restore("recommended")}>Restore recommended</Button>
    </Panel>
    <div className="realtime-toolbar"><div className="realtime-search" role="search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search protection settings..." aria-label="Search protection settings" autoComplete="off" />{query && <button type="button" className="realtime-search-clear" aria-label="Clear protection settings search" title="Clear search" onClick={() => setQuery("")}><X size={15} /></button>}</div><Button onClick={() => setAdvanced((value) => !value)}><SlidersHorizontal size={15} />{advanced ? "Hide advanced" : "Show advanced"}</Button><span>{snapshot.activeMonitors.length} active monitor{snapshot.activeMonitors.length === 1 ? "" : "s"}</span></div>
    {visible.length ? visible.map((group) => <SettingsGroup key={group.title} {...group} settings={snapshot.settings} toggle={toggle} query={normalizedQuery.toLowerCase()} />) : <Panel className="realtime-search-empty"><Search size={20} /><div><strong>No protection settings found</strong><p>Try a setting name or a more general term.</p></div></Panel>}
    <Exclusions settings={snapshot.settings} choosePath={choosePath} removePath={removePath} update={update} />
    <Panel className="realtime-reset"><div><h3>Local settings and history</h3><p>Export or import local monitoring settings, clear locally retained report metadata, or return to factory defaults.</p></div><div><Button onClick={exportSettings}><Upload size={15} />Export</Button><Button onClick={() => importRef.current?.click()}><Download size={15} />Import</Button><Button className="danger" onClick={() => void window.viai?.background.clearHistory().then(() => toast.success("Background history cleared."))}><History size={15} />Clear history</Button><Button className="danger" onClick={() => void restore("factory")}><RotateCcw size={15} />Factory defaults</Button><input ref={importRef} type="file" accept="application/json" className="sr-only" onChange={importSettings} /></div></Panel>
  </motion.div>;
}

function MonitorStatus({ icon: Icon, label, detail, configured, active }: { icon: typeof Activity; label: string; detail: string; configured: boolean; active: boolean }) {
  const status = active ? "Active" : configured ? "Needs review" : "Off";
  return <Panel className={`realtime-monitor-card ${active ? "active" : ""}`}><span className="realtime-monitor-icon"><Icon size={18} /></span><div><strong>{label}</strong><small>{detail}</small></div><span className={`monitor-status ${active ? "active" : configured ? "attention" : ""}`}>{status}</span></Panel>;
}

function SettingsGroup({ title, icon: Icon, options, settings, toggle, query }: SettingGroup & { settings: Settings; toggle: (key: string) => void; query: string }) {
  const visible = options.filter(([, label, detail]) => !query || `${label} ${detail}`.toLowerCase().includes(query));
  if (!visible.length) return null;
  return <Panel className="realtime-section"><div className="setting-heading"><Icon size={18} /><h3>{title}</h3></div>{visible.map(([key, label, detail]) => <div className="setting-row" key={key}><div><strong>{label}</strong><p title={detail}>{detail}</p></div><Toggle checked={key === "monitorFileCreationOrRename" ? settings.monitorFileCreation === true || settings.monitorFileRename === true : settings[key] === true} label={label} onChange={() => toggle(key)} /></div>)}</Panel>;
}

function Exclusions({ settings, choosePath, removePath, update }: { settings: Settings; choosePath: (key: "customFolders" | "excludedFolders" | "excludedFiles") => Promise<void>; removePath: (key: "customFolders" | "excludedFolders" | "excludedFiles", path: string) => void; update: (changes: Record<string, unknown>) => Promise<void> }) {
  return <Panel className="realtime-section"><div className="setting-heading"><FolderCog size={18} /><h3>Locations and exclusions</h3></div><p className="section-note">Custom folders extend local candidate observation. Exclusions prevent matching local paths, extensions, or process names from entering the static-analysis queue.</p><PathList title="Custom folders" values={list(settings.customFolders)} onAdd={() => void choosePath("customFolders")} onRemove={(value) => removePath("customFolders", value)} /><PathList title="Excluded folders" values={list(settings.excludedFolders)} onAdd={() => void choosePath("excludedFolders")} onRemove={(value) => removePath("excludedFolders", value)} /><PathList title="Excluded files" values={list(settings.excludedFiles)} onAdd={() => void choosePath("excludedFiles")} onRemove={(value) => removePath("excludedFiles", value)} /><TextList title="Excluded extensions" values={list(settings.excludedExtensions)} onChange={(values) => void update({ excludedExtensions: values })} /><TextList title="Excluded processes" values={list(settings.excludedProcesses)} onChange={(values) => void update({ excludedProcesses: values })} /></Panel>;
}

function PathList({ title, values, onAdd, onRemove }: { title: string; values: string[]; onAdd: () => void; onRemove: (value: string) => void }) {
  return <div className="path-list"><div><strong>{title}</strong><Button onClick={onAdd}>Add</Button></div>{values.map((value) => <span key={value}><code>{value}</code><button type="button" onClick={() => onRemove(value)} aria-label={`Remove ${value}`}>x</button></span>)}</div>;
}

function TextList({ title, values, onChange }: { title: string; values: string[]; onChange: (values: string[]) => void }) {
  return <label className="text-list"><strong>{title}</strong><input value={values.join(", ")} placeholder="Comma-separated values" onChange={(event) => onChange(event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} /></label>;
}

function list(value: Settings[string] | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}