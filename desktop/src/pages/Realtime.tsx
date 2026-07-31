import { Activity, Download, FolderCog, HardDrive } from "lucide-react";
import { motion } from "framer-motion";
import { Panel, Toggle } from "../components/ui";
import { useSecurityStore } from "../store/securityStore";
import { pageMotion } from "../animations/motion";

export default function Realtime() {
  const state = useSecurityStore();
  const monitors = [{ key: "downloadMonitoring" as const, icon: Download, name: "Download monitoring", detail: "New executable candidates in your download locations" }, { key: "executableMonitoring" as const, icon: Activity, name: "Executable monitoring", detail: "Executable file creation and modifications" }, { key: "usbMonitoring" as const, icon: HardDrive, name: "Removable media", detail: "Executable candidates discovered on connected USB storage" }];
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title"><p className="eyebrow">LOCAL SENSORS</p><h2>Realtime protection</h2><p>Manage the activity sources the existing engine watches on this device.</p></div><div className="monitor-list">{monitors.map(({ key, icon: Icon, name, detail }) => <Panel className="monitor-row" key={key}><span className="monitor-icon"><Icon size={21} /></span><div><h3>{name}</h3><p>{detail}</p></div><Toggle checked={state[key]} label={`Toggle ${name}`} onChange={() => state.toggleMonitoring(key)} /></Panel>)}</div><Panel className="locations-panel"><FolderCog size={20} /><div><h3>Monitored locations</h3><p>Downloads, configured executable folders, and removable storage are covered by the local engine.</p></div><span className="soft-tag">Private device-only monitoring</span></Panel></motion.div>;
}