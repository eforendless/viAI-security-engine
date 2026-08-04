import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Bluetooth, CircleHelp, Cpu, Gamepad2, HardDrive, Headphones, Keyboard, Laptop, Mouse, Network, Printer, ShieldCheck, Smartphone, Usb, Video } from "lucide-react";
import { Button, Panel } from "../components/ui";
import { presentAssessment, type AssessmentPresentation } from "../assessmentPresentation";
import { pageMotion } from "../animations/motion";

type DeviceStatus = "connected" | "disconnected" | "unknown";
type MonitoringState = "disabled" | "active" | "degraded";
type Tab = "overview" | "devices" | "media" | "activity";

interface Device {
  id: string;
  friendlyName: string;
  manufacturer?: string;
  serialNumber?: string;
  deviceType: string;
  connectionType: string;
  vendorId?: string;
  productId?: string;
  firstSeen: string;
  lastSeen: string;
  status: DeviceStatus;
  isTrusted: boolean;
  isStorageDevice: boolean;
  isHumanInterfaceDevice: boolean;
  driver?: string;
  driverVersion?: string;
  capacity?: number;
  mountPoint?: string;
  fileSystem?: string;
  autoRunEnabled?: boolean;
  trustIndicators: Array<{ id: string; evidence: string }>;
}

interface DeviceEvent { id: string; type: string; deviceId: string; occurredAt: string; detail: string; }
interface DeviceSnapshot { devices: Device[]; history: DeviceEvent[]; policies: { automaticallyScanUsb?: boolean }; monitoringState: MonitoringState; }
interface HistoryRecord { id: string; occurredAt: string; detail: string; engineVersion: string; source?: string; filePath?: string; assessment?: unknown; }
interface ScanState { source?: string; status: string; target: string; currentFile: string; filesCompleted: number; totalFiles: number; }
interface BackgroundSnapshot { history: HistoryRecord[]; activeScan?: ScanState; }
interface RemovableAssessment extends HistoryRecord { presentation: AssessmentPresentation; }

const emptySnapshot: DeviceSnapshot = { devices: [], history: [], policies: {}, monitoringState: "disabled" };
const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["devices", "Devices"], ["media", "Removable media"], ["activity", "Activity"]];

export default function DeviceSecurity() {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot>(emptySnapshot);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [activeScan, setActiveScan] = useState<ScanState>();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string>();
  const connected = snapshot.devices.filter((device) => device.status === "connected");
  const storage = connected.filter((device) => device.isStorageDevice);
  const selected = connected.find((device) => device.id === selectedId) ?? connected[0];
  const assessments = history.filter((record) => record.source === "removable-media").map((record) => ({ ...record, presentation: presentAssessment(record, record.engineVersion) })).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const removableScan = activeScan?.source === "removable-media" ? activeScan : undefined;

  useEffect(() => {
    let mounted = true;
    void window.viai?.deviceSecurity.snapshot().then((value) => { if (mounted && value) setSnapshot(value as DeviceSnapshot); });
    const unsubscribe = window.viai?.deviceSecurity.onChanged((update) => {
      if (!mounted || !update || typeof update !== "object") return;
      const next = update as { snapshot?: DeviceSnapshot; events?: DeviceEvent[] };
      if (next.snapshot) setSnapshot(next.snapshot);
      next.events?.forEach(notify);
    });
    return () => { mounted = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const apply = (value: unknown) => {
      if (!mounted || !value || typeof value !== "object") return;
      const next = value as BackgroundSnapshot;
      setHistory(Array.isArray(next.history) ? next.history : []);
      setActiveScan(next.activeScan);
    };
    void window.viai?.background.snapshot().then(apply);
    const unsubscribe = window.viai?.background.onChanged(apply);
    return () => { mounted = false; unsubscribe?.(); };
  }, []);

  const updateTrust = async (device: Device, trusted: boolean) => {
    try {
      await window.viai?.deviceSecurity.setTrust(device.id, trusted);
      toast.success(trusted ? "Local trust label added." : "Local trust label removed.");
    } catch {
      toast.error("Could not update the local trust label.");
    }
  };
  const scanDevice = async (device: Device) => {
    try {
      await window.viai?.deviceSecurity.scan(device.id);
      toast.success("Removable-media scan started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start the removable-media scan.");
    }
  };
  const selectDevice = (id: string) => { setSelectedId(id); setTab("devices"); };

  return <motion.div {...pageMotion} className="page-stack device-security-page">
    <div className="page-title"><p className="eyebrow">WINDOWS DEVICE OBSERVATION</p><h2>Device Security</h2><p>Windows Plug and Play inventory, local labels, and static analysis for removable media.</p></div>
    <MonitoringNotice state={snapshot.monitoringState} automaticScan={snapshot.policies.automaticallyScanUsb === true} />
    <div className="device-tabs" role="tablist" aria-label="Device Security views">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <Overview devices={connected} storage={storage} events={snapshot.history} state={snapshot.monitoringState} onSelect={selectDevice} />}
    {tab === "devices" && <Devices devices={connected} selected={selected} onSelect={setSelectedId} onTrust={updateTrust} onScan={scanDevice} />}
    {tab === "media" && <RemovableMedia devices={storage} scan={removableScan} assessments={assessments} />}
    {tab === "activity" && <Activity events={snapshot.history} devices={snapshot.devices} />}
  </motion.div>;
}

function MonitoringNotice({ state, automaticScan }: { state: MonitoringState; automaticScan: boolean }) {
  const detail = state === "active" ? `Windows device-change listener is active. ${automaticScan ? "New removable storage can start a shared scan." : "Automatic removable-media scans are disabled."}` : state === "degraded" ? "Windows device discovery is available, but the live change listener is unavailable." : "Device observation is disabled by Background Protection settings.";
  return <Panel className="recommended-panel"><div><span className="recommendation-mark"><Usb size={19} /></span><div><h3>{state === "active" ? "Device observation active" : state === "degraded" ? "Device observation degraded" : "Device observation disabled"}</h3><p>{detail}</p></div></div></Panel>;
}

function Overview({ devices, storage, events, state, onSelect }: { devices: Device[]; storage: Device[]; events: DeviceEvent[]; state: MonitoringState; onSelect: (id: string) => void }) {
  return <><section className="metrics-grid"><Metric icon={Usb} label="Connected devices" value={devices.length} detail="Windows Plug and Play inventory" tone="blue" /><Metric icon={HardDrive} label="Removable storage" value={storage.length} detail="Connected mounted storage" tone={storage.length ? "warning" : "success"} /><Metric icon={ShieldCheck} label="Local labels" value={devices.filter((device) => device.isTrusted).length} detail="Do not alter Windows access or scanning" tone="indigo" /><Metric icon={CircleHelp} label="Observation" value={state === "active" ? 1 : 0} detail={state === "active" ? "Live listener active" : "Listener unavailable or disabled"} tone={state === "active" ? "success" : "warning"} /></section><div className="dashboard-grid"><Panel><div className="panel-heading"><div><h3>Connected now</h3><p>Observed devices reported by Windows.</p></div></div><div className="device-compact-list">{devices.length ? devices.slice(0, 5).map((device) => <button type="button" key={device.id} className="device-compact-row" onClick={() => onSelect(device.id)}><DeviceIcon type={device.deviceType} /><span><strong>{device.friendlyName}</strong><small>{device.connectionType}{device.manufacturer ? ` - ${device.manufacturer}` : ""}</small></span><Status status={device.status} /></button>) : <Empty icon={Usb} title="No devices detected" detail="Connected devices will appear here when Windows reports them." />}</div></Panel><Panel><div className="panel-heading"><div><h3>Latest activity</h3><p>Connection and local-label events stored on this computer.</p></div></div><div className="device-event-list">{events.length ? events.slice(0, 5).map((event) => <EventRow event={event} key={event.id} />) : <Empty icon={ShieldCheck} title="No device activity yet" detail="Observed device changes will appear here." />}</div></Panel></div></>;
}

function Devices({ devices, selected, onSelect, onTrust, onScan }: { devices: Device[]; selected?: Device; onSelect: (id: string) => void; onTrust: (device: Device, trusted: boolean) => Promise<void>; onScan: (device: Device) => Promise<void> }) {
  return <div className="device-content-grid"><div className="device-card-grid">{devices.length ? devices.map((device) => <Panel key={device.id} className={`device-card ${selected?.id === device.id ? "selected" : ""}`}><button type="button" className="device-card-main" onClick={() => onSelect(device.id)}><span className="device-icon"><DeviceIcon type={device.deviceType} /></span><span className="device-card-copy"><strong>{device.friendlyName}</strong><small>{device.manufacturer ?? "Reported by Windows"}</small><small>{device.connectionType} - observed {formatTime(device.lastSeen)}</small></span><span className="device-card-badges"><Status status={device.status} />{device.isTrusted && <Trust />}</span></button><div className="device-card-actions">{device.isStorageDevice && device.mountPoint && <Button onClick={() => void onScan(device)}>Scan storage</Button>}<Button onClick={() => void onTrust(device, !device.isTrusted)}>{device.isTrusted ? "Remove local label" : "Add local label"}</Button></div></Panel>) : <Panel><Empty icon={Usb} title="No connected devices" detail="Connect a device and Windows will publish it here." /></Panel>}</div>{selected && <DeviceDetails device={selected} />}</div>;
}

function DeviceDetails({ device }: { device: Device }) {
  const rows: Array<[string, string | undefined]> = [["Manufacturer", device.manufacturer], ["Driver", device.driver], ["Driver version", device.driverVersion], ["VID", device.vendorId], ["PID", device.productId], ["Serial number", device.serialNumber], ["Mount path", device.mountPoint], ["Storage capacity", device.capacity ? formatBytes(device.capacity) : undefined], ["Filesystem", device.fileSystem]];
  return <Panel className="device-details"><div className="panel-heading"><div><h3>{device.friendlyName}</h3><p>Windows-reported details and local annotations</p></div><DeviceIcon type={device.deviceType} /></div><div className="device-details-list">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="trust-evidence"><h4>Local observation evidence</h4>{device.trustIndicators.map((indicator) => <p key={indicator.id}><ShieldCheck size={14} />{indicator.evidence}</p>)}</div><p className="device-connection-note">First observed {formatDate(device.firstSeen)}. Last observed {formatDate(device.lastSeen)}. Local labels do not permit, block, or suppress analysis.</p></Panel>;
}

function RemovableMedia({ devices, scan, assessments }: { devices: Device[]; scan?: ScanState; assessments: RemovableAssessment[] }) {
  return <div className="page-stack"><Panel><div className="panel-heading"><div><h3>Connected removable storage</h3><p>Only storage devices with a Windows mount path can be submitted to local static analysis.</p></div></div><div className="storage-table">{devices.length ? devices.map((device) => <div className="storage-row" key={device.id}><HardDrive size={20} /><div><strong>{device.friendlyName}</strong><span>{device.mountPoint ?? "Mount path unavailable"}{device.fileSystem ? ` - ${device.fileSystem}` : ""}</span></div><span>{device.capacity ? formatBytes(device.capacity) : "Capacity unavailable"}</span><Status status={device.status} /></div>) : <Empty icon={HardDrive} title="No removable storage connected" detail="Windows-reported removable volumes will appear here." />}</div></Panel>{scan && <Panel><div className="panel-heading"><div><h3>Removable-media scan running</h3><p>{scan.filesCompleted} of {scan.totalFiles} discovered files processed. {scan.currentFile || scan.target}</p></div><Status status="connected" /></div></Panel>}<Panel><div className="panel-heading"><div><h3>Removable-media assessments</h3><p>Completed local static analyses retained in Analysis History.</p></div></div><div className="device-event-list">{assessments.length ? assessments.slice(0, 20).map((item) => <AssessmentRow key={item.id} item={item} />) : <Empty icon={ShieldCheck} title="No removable-media assessments yet" detail="Assessment results will appear after eligible files are analyzed." />}</div></Panel></div>;
}

function AssessmentRow({ item }: { item: RemovableAssessment }) {
  const fileName = item.filePath?.split(/[\\/]/).pop() ?? item.detail;
  return <div className="device-event-row"><HardDrive size={17} /><div><strong>{fileName}</strong><span>{item.presentation.status.label} - {item.presentation.displayRecommendation.label}</span></div><Link className="text-link" to={`/details/${item.id}`}>View details</Link></div>;
}

function Activity({ events, devices }: { events: DeviceEvent[]; devices: Device[] }) {
  return <Panel><div className="panel-heading"><div><h3>Device activity</h3><p>Windows connection changes and local label decisions.</p></div></div><div className="device-event-list">{events.length ? events.map((event) => <EventRow key={event.id} event={event} device={devices.find((device) => device.id === event.deviceId)} />) : <Empty icon={Usb} title="No device activity" detail="Observed connection changes will be retained here." />}</div></Panel>;
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Usb; label: string; value: number; detail: string; tone: string }) { return <div className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></div>; }
function DeviceIcon({ type }: { type: string }) { const Icon = type.includes("storage") || type.includes("ssd") || type.includes("hdd") || type.includes("sd") ? HardDrive : type === "keyboard" ? Keyboard : type === "mouse" ? Mouse : type === "webcam" ? Video : type === "printer" ? Printer : type === "bluetooth-adapter" ? Bluetooth : type === "network-adapter" ? Network : type === "audio-device" ? Headphones : type === "game-controller" ? Gamepad2 : type === "smartphone" ? Smartphone : type === "usb-hub" ? Cpu : type === "unknown-usb" ? Usb : Laptop; return <Icon size={20} />; }
function Status({ status }: { status: DeviceStatus }) { return <span className={`device-status ${status}`}>{status}</span>; }
function Trust() { return <span className="device-trust trusted">local label</span>; }
function EventRow({ event, device }: { event: DeviceEvent; device?: Device }) { return <div className="device-event-row"><Usb size={17} /><div><strong>{event.detail}</strong><span>{device?.friendlyName ?? "Device activity"}</span></div><time>{formatTime(event.occurredAt)}</time></div>; }
function Empty({ icon: Icon, title, detail }: { icon: typeof Usb; title: string; detail: string }) { return <div className="device-empty"><Icon size={25} /><div><strong>{title}</strong><p>{detail}</p></div></div>; }
function notify(event: DeviceEvent) { const message = event.type === "device-connected" ? "Device connected" : event.type === "device-removed" ? "Device removed" : undefined; if (message) toast(message); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatBytes(value: number) { return `${(value / 1024 ** 3).toFixed(value >= 1024 ** 3 ? 1 : 0)} GB`; }