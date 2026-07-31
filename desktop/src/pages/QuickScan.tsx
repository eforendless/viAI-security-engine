import { useState } from "react";
import { FileSearch, FolderOpen, Play, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Button, Panel } from "../components/ui";
import { useScan } from "../hooks/useScan";
import { pageMotion } from "../animations/motion";
import { useSecurityStore } from "../store/securityStore";

export default function QuickScan() {
  const [mode, setMode] = useState<"file" | "folder">("file");
  const [path, setPath] = useState("");
  const { quickScan, folderScan } = useScan();
  const scanning = useSecurityStore((state) => state.scan.active);
  const choose = async () => { const selected = mode === "file" ? await window.viai?.chooseFile() : await window.viai?.chooseFolder(); if (selected) setPath(selected); };
  const run = async () => { if (!path) { toast.error(`Choose a ${mode} first.`); return; } if (mode === "file") await quickScan(path); else await folderScan(path); };
  return <motion.div {...pageMotion} className="page-stack narrow-page"><div className="page-title"><p className="eyebrow">ON-DEMAND ANALYSIS</p><h2>Quick scan</h2><p>Send a file or folder to the existing local engine. Nothing leaves this device.</p></div><Panel className="scan-chooser"><div className="mode-switch" role="tablist"><button className={mode === "file" ? "selected" : ""} onClick={() => setMode("file")} role="tab" aria-selected={mode === "file"}><FileSearch size={18} />Single file</button><button className={mode === "folder" ? "selected" : ""} onClick={() => setMode("folder")} role="tab" aria-selected={mode === "folder"}><FolderOpen size={18} />Folder</button></div><div className="selection-card"><span className="selection-icon"><ShieldCheck size={28} /></span><div><h3>{mode === "file" ? "Choose a file to inspect" : "Choose a folder to inspect"}</h3><p>The engine performs static, local-only evidence collection.</p></div></div><label className="path-input"><span className="sr-only">Selected path</span><input value={path} onChange={(event) => setPath(event.target.value)} placeholder={mode === "file" ? "C:\\Users\\...\\setup.exe" : "C:\\Users\\...\\Downloads"} /><Button type="button" onClick={choose}>Browse</Button></label><Button className="primary large-button" type="button" disabled={scanning} onClick={() => void run()}><Play size={17} />{scanning ? "Analysis in progress" : "Start local analysis"}</Button></Panel></motion.div>;
}