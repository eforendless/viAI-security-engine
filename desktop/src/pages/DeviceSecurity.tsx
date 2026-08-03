import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Bluetooth, CircleHelp, Cpu, Gamepad2, HardDrive, Headphones, Keyboard, Laptop, Mouse, Network, Printer, ShieldCheck, Smartphone, Usb, Video } from "lucide-react";
import { Button, Panel } from "../components/ui";
import { pageMotion } from "../animations/motion";

type DeviceStatus = "connected" | "disconnected" | "blocked" | "needs-scan" | "scanning" | "trusted" | "unknown";
type Tab = "overview" | "connected" | "activity" | "trusted" | "history" | "policies";

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
interface AssessmentSummary { schemaVersion: "0.3"; verdict: string; suspicion: { score: number; level: string }; trust: { score: number; level: string }; confidence: { score: number; level: string }; investigationPriority: string; recommendation: string; }
interface DeviceScan { id: string; deviceId: string; startedAt: string; finishedAt?: string; filesScanned: number; threatsFound: number; status: string; findings: Array<{ filePath: string; riskScore: number; recommendation: string; evidence: string[]; assessment?: AssessmentSummary }>; }
interface Snapshot { devices: Device[]; history: DeviceEvent[]; scans: DeviceScan[]; policies: Record<string, boolean>; }

const emptySnapshot: Snapshot = { devices: [], history: [], scans: [], policies: {} };
const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["connected", "Connected Devices"], ["activity", "USB Activity"], ["trusted", "Trusted Devices"], ["history", "Device History"], ["policies", "Policies"]];

export default function DeviceSecurity() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string>();
  const selected = snapshot.devices.find((device) => device.id === selectedId) ?? snapshot.devices.find((device) => device.status !== "disconnected");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const next = await window.viai?.deviceSecurity.snapshot();
      if (active && next) setSnapshot(next as Snapshot);
    };
    void load();
    return window.viai?.deviceSecurity.onChanged((update) => {
      if (!active) return;
      const { snapshot: next, events } = update as { snapshot: Snapshot; events: DeviceEvent[] };
      setSnapshot(next);
      events.forEach((event) => notify(event));
    });
  }, []);

  const updateTrust = async (device: Device, trusted: boolean) => {
    try {
      await window.viai?.deviceSecurity.setTrust(device.id, trusted);
      toast.success(trusted ? `${device.friendlyName} is trusted locally.` : `${device.friendlyName} is blocked locally.`);
    } catch {
      toast.error("Could not update the device trust setting.");
    }
  };
  const blockDevice = async (device: Device) => {
    try {
      await window.viai?.deviceSecurity.block(device.id);
      toast.success(`${device.friendlyName} is blocked locally.`);
    } catch {
      toast.error("Could not block the device.");
    }
  };
  const scanDevice = async (device: Device) => {
    try {
      await window.viai?.deviceSecurity.scan(device.id);
      toast("Device scan started");
    } catch {
      toast.error("Could not start the device scan.");
    }
  };

  const connected = snapshot.devices.filter((device) => device.status !== "disconnected");
  const storage = connected.filter((device) => device.isStorageDevice);
  const trusted = snapshot.devices.filter((device) => device.isTrusted);

  return <motion.div {...pageMotion} className="page-stack device-security-page">
    <div className="page-title"><p className="eyebrow">ENDPOINT DEVICE CONTROL</p><h2>Device Security</h2><p>Live inventory, local trust evidence, and removable-media analysis.</p></div>
    <div className="device-tabs" role="tablist" aria-label="Device Security views">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <Overview connected={connected} storage={storage} trusted={trusted} history={snapshot.history} onSelect={(id) => { setSelectedId(id); setTab("connected"); }} />}
    {tab === "connected" && <Connected devices={connected} selected={selected} onSelect={setSelectedId} onTrust={updateTrust} onBlock={blockDevice} onScan={scanDevice} />}
    {tab === "activity" && <UsbActivity devices={storage} scans={snapshot.scans} />}
    {tab === "trusted" && <TrustedDevices devices={trusted} onSelect={(id) => { setSelectedId(id); setTab("connected"); }} />}
    {tab === "history" && <History events={snapshot.history} devices={snapshot.devices} />}
    {tab === "policies" && <Policies policies={snapshot.policies} />}
  </motion.div>;
}

function Overview({ connected, storage, trusted, history, onSelect }: { connected: Device[]; storage: Device[]; trusted: Device[]; history: DeviceEvent[]; onSelect: (id: string) => void }) {
  return <><section className="metrics-grid"><Metric icon={Usb} label="Connected devices" value={connected.length} detail="Live Windows PnP inventory" tone="blue" /><Metric icon={HardDrive} label="Removable storage" value={storage.length} detail="Storage requiring local analysis" tone={storage.length ? "warning" : "success"} /><Metric icon={ShieldCheck} label="Trusted devices" value={trusted.length} detail="Explicitly trusted on this computer" tone="success" /><Metric icon={CircleHelp} label="Recent events" value={history.length} detail="Persisted local device activity" tone="indigo" /></section><div className="dashboard-grid"><Panel><div className="panel-heading"><div><h3>Connected now</h3><p>Windows Plug and Play updates this list automatically.</p></div></div><div className="device-compact-list">{connected.length ? connected.slice(0, 5).map((device) => <button type="button" key={device.id} className="device-compact-row" onClick={() => onSelect(device.id)}><DeviceIcon type={device.deviceType} /><span><strong>{device.friendlyName}</strong><small>{device.connectionType} {device.manufacturer ? `- ${device.manufacturer}` : ""}</small></span><Status status={device.status} /></button>) : <Empty icon={Usb} title="No devices detected" detail="Connected devices will appear here automatically." />}</div></Panel><Panel><div className="panel-heading"><div><h3>Latest activity</h3><p>Connection and trust events are retained locally.</p></div></div><div className="device-event-list">{history.length ? history.slice(0, 5).map((event) => <EventRow event={event} key={event.id} />) : <Empty icon={ShieldCheck} title="No device activity yet" detail="Plug and Play events will be recorded here." />}</div></Panel></div></>;
}

function Connected({ devices, selected, onSelect, onTrust, onBlock, onScan }: { devices: Device[]; selected?: Device; onSelect: (id: string) => void; onTrust: (device: Device, trusted: boolean) => Promise<void>; onBlock: (device: Device) => Promise<void>; onScan: (device: Device) => Promise<void> }) {
  return <div className="device-content-grid"><div className="device-card-grid">{devices.length ? devices.map((device) => <Panel key={device.id} className={`device-card ${selected?.id === device.id ? "selected" : ""}`}><button type="button" className="device-card-main" onClick={() => onSelect(device.id)}><span className="device-icon"><DeviceIcon type={device.deviceType} /></span><span className="device-card-copy"><strong>{device.friendlyName}</strong><small>{device.manufacturer ?? "Windows reported device"}</small><small>{device.connectionType} - connected {formatTime(device.lastSeen)}</small></span><span className="device-card-badges"><Status status={device.status} /><Trust trusted={device.isTrusted} /></span></button><div className="device-card-actions">{device.isStorageDevice && <Button onClick={() => void onScan(device)} disabled={device.status === "scanning" || device.status === "blocked"}>{device.status === "scanning" ? "Scanning" : "Scan"}</Button>}<Button onClick={() => void onTrust(device, !device.isTrusted)}>{device.isTrusted ? "Remove trust" : "Trust device"}</Button><Button className="danger" onClick={() => void onBlock(device)}>Block</Button></div></Panel>) : <Panel><Empty icon={Usb} title="No connected devices" detail="Connect a physical device and Windows will publish it here." /></Panel>}</div>{selected && <DeviceDetails device={selected} />}</div>;
}

function DeviceDetails({ device }: { device: Device }) {
  const rows: Array<[string, string | undefined]> = [["Manufacturer", device.manufacturer], ["Driver", device.driver], ["Driver version", device.driverVersion], ["VID", device.vendorId], ["PID", device.productId], ["Serial number", device.serialNumber], ["Mount path", device.mountPoint], ["Storage capacity", device.capacity ? formatBytes(device.capacity) : undefined], ["Filesystem", device.fileSystem], ["AutoRun", device.autoRunEnabled === undefined ? undefined : device.autoRunEnabled ? "Enabled" : "Disabled"]];
  return <Panel className="device-details"><div className="panel-heading"><div><h3>{device.friendlyName}</h3><p>Device details and local trust evidence</p></div><DeviceIcon type={device.deviceType} /></div><div className="device-details-list">{rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="trust-evidence"><h4>Trust indicators</h4>{device.trustIndicators.map((indicator) => <p key={indicator.id}><ShieldCheck size={14} />{indicator.evidence}</p>)}</div><p className="device-connection-note">First seen {formatDate(device.firstSeen)}. Last activity {formatDate(device.lastSeen)}.</p></Panel>;
}

function UsbActivity({ devices, scans }: { devices: Device[]; scans: DeviceScan[] }) {
  return <div className="page-stack"><Panel><div className="panel-heading"><div><h3>Removable storage activity</h3><p>Drive details and scan lifecycle records for connected removable media.</p></div></div><div className="storage-table">{devices.length ? devices.map((device) => <div className="storage-row" key={device.id}><HardDrive size={20} /><div><strong>{device.friendlyName}</strong><span>{device.mountPoint ?? "Mount path unavailable"} {device.fileSystem ? `- ${device.fileSystem}` : ""}</span></div><span>{device.capacity ? formatBytes(device.capacity) : "Capacity unavailable"}</span><Status status={device.status} /></div>) : <Empty icon={HardDrive} title="No removable storage connected" detail="USB drives, SD cards, and external storage will be monitored here." />}</div></Panel><Panel><div className="panel-heading"><div><h3>Scan activity</h3><p>Static assessment results are attached to completed device scans.</p></div></div><div className="device-event-list">{scans.length ? scans.map((scan) => <div key={scan.id} className="device-scan-result"><div className="scan-row"><Usb size={18} /><div><strong>{scan.status === "running" ? "Removable media scan in progress" : scan.status === "failed" ? "Removable media scan unavailable" : "Removable media scan complete"}</strong><span>{scan.filesScanned} eligible files scanned - {scan.threatsFound} requiring investigation</span></div><span>{formatTime(scan.finishedAt ?? scan.startedAt)}</span></div>{scan.findings.slice(0, 5).map((finding) => <div className="device-scan-finding" key={finding.filePath}><strong>{finding.filePath.split(/[\\/]/).pop()}</strong><span>{finding.assessment ? `${finding.assessment.verdict} - ${finding.assessment.investigationPriority} - ${finding.assessment.recommendation}` : `LEGACY SCORE MODEL - Risk ${finding.riskScore} - ${finding.recommendation}`}</span><small>{finding.evidence[0] ?? "No additional evidence"}</small></div>)}</div>) : <Empty icon={ShieldCheck} title="No device scans yet" detail="Removable storage scans begin automatically after connection." />}</div></Panel></div>;
}

function TrustedDevices({ devices, onSelect }: { devices: Device[]; onSelect: (id: string) => void }) {
  return <Panel><div className="panel-heading"><div><h3>Trusted devices</h3><p>Trust is always an explicit local decision; it never suppresses security evidence.</p></div></div><div className="device-compact-list">{devices.length ? devices.map((device) => <button type="button" key={device.id} className="device-compact-row" onClick={() => onSelect(device.id)}><DeviceIcon type={device.deviceType} /><span><strong>{device.friendlyName}</strong><small>{device.manufacturer ?? "Locally trusted device"}</small></span><Trust trusted /></button>) : <Empty icon={ShieldCheck} title="No trusted devices" detail="Trust a device from Connected Devices after reviewing its details." />}</div></Panel>;
}

function History({ events, devices }: { events: DeviceEvent[]; devices: Device[] }) {
  return <Panel><div className="panel-heading"><div><h3>Device history</h3><p>Connection, scan, and user-decision history remains on this computer.</p></div></div><div className="device-event-list">{events.length ? events.map((event) => <EventRow key={event.id} event={event} device={devices.find((entry) => entry.id === event.deviceId)} />) : <Empty icon={Usb} title="No device history" detail="The first Plug and Play event will create a local record." />}</div></Panel>;
}

function Policies({ policies }: { policies: Record<string, boolean> }) {
  const labels: Array<[string, string]> = [["automaticallyScanUsb", "Automatically scan USB storage"], ["blockUnknownStorage", "Block unknown storage"], ["allowHumanInterfaceDevices", "Allow HID devices"], ["allowCompanyDevices", "Allow company devices"], ["requireTrust", "Require trust before use"], ["readOnlyMode", "Read-only mode"]];
  return <Panel className="policies-panel"><div className="panel-heading"><div><h3>Device policies</h3><p>Policy enforcement is reserved for the enterprise policy provider.</p></div></div>{labels.map(([key, label]) => <div className="policy-placeholder" key={key}><span><strong>{label}</strong><small>Policy placeholder</small></span><span className={policies[key] ? "policy-value enabled" : "policy-value"}>{policies[key] ? "Configured" : "Not configured"}</span></div>)}</Panel>;
}

function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Usb; label: string; value: number; detail: string; tone: string }) { return <div className="metric-card"><span className={`metric-icon ${tone}`}><Icon size={20} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></div>; }
function DeviceIcon({ type }: { type: string }) { const Icon = type.includes("storage") || type.includes("ssd") || type.includes("hdd") || type.includes("sd") ? HardDrive : type === "keyboard" ? Keyboard : type === "mouse" ? Mouse : type === "webcam" ? Video : type === "printer" ? Printer : type === "bluetooth-adapter" ? Bluetooth : type === "network-adapter" ? Network : type === "audio-device" ? Headphones : type === "game-controller" ? Gamepad2 : type === "smartphone" ? Smartphone : type === "usb-hub" ? Cpu : type === "unknown-usb" ? Usb : Laptop; return <Icon size={20} />; }
function Status({ status }: { status: DeviceStatus }) { return <span className={`device-status ${status}`}>{status.replaceAll("-", " ")}</span>; }
function Trust({ trusted }: { trusted: boolean }) { return <span className={`device-trust ${trusted ? "trusted" : "untrusted"}`}>{trusted ? "trusted" : "untrusted"}</span>; }
function EventRow({ event, device }: { event: DeviceEvent; device?: Device }) { return <div className="device-event-row"><Usb size={17} /><div><strong>{event.detail}</strong><span>{device?.friendlyName ?? "Device activity"}</span></div><time>{formatTime(event.occurredAt)}</time></div>; }
function Empty({ icon: Icon, title, detail }: { icon: typeof Usb; title: string; detail: string }) { return <div className="device-empty"><Icon size={25} /><div><strong>{title}</strong><p>{detail}</p></div></div>; }
function notify(event: DeviceEvent) { const message = event.type === "device-connected" ? "USB connected" : event.type === "device-removed" ? "USB removed" : event.type === "scan-started" ? "Device scan started" : event.type === "scan-finished" ? "Device scan finished" : event.type === "threat-detected" ? "Threat found" : undefined; if (message) toast(message); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function formatBytes(value: number) { return `${(value / 1024 ** 3).toFixed(value >= 1024 ** 3 ? 1 : 0)} GB`; }