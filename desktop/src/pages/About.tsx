import { BookOpen, Download, FileCode2, HeartHandshake, RefreshCw, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Panel } from "../components/ui";
import { pageMotion } from "../animations/motion";

type UpdateStatus = "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
interface UpdateSnapshot { status: UpdateStatus; currentVersion: string; version?: string; percent?: number; message: string; }
const initialUpdate: UpdateSnapshot = { status: "unsupported", currentVersion: "", message: "Updates are available in installed releases." };

export default function About() {
	const [desktopVersion, setDesktopVersion] = useState("Unavailable");
	const [engineVersion, setEngineVersion] = useState("Unavailable");
	const [update, setUpdate] = useState<UpdateSnapshot>(initialUpdate);
	useEffect(() => {
		void window.viai?.application.version().then(setDesktopVersion);
		void window.viai?.application.engineVersion().then(setEngineVersion);
		void window.viai?.updates.snapshot().then((value) => { if (value) setUpdate(value as UpdateSnapshot); });
		return window.viai?.updates.onChanged((value) => setUpdate(value as UpdateSnapshot));
	}, []);
	const updateApp = async () => {
		if (!window.viai) return;
		if (update.status === "downloaded") return window.viai.updates.install();
		const next = update.status === "available" ? await window.viai.updates.download() : await window.viai.updates.check();
		if (next) setUpdate(next as UpdateSnapshot);
	};
	const busy = update.status === "checking" || update.status === "downloading";
	const label = update.status === "available" ? "Download update" : update.status === "downloaded" ? "Install and restart" : update.status === "checking" ? "Checking" : update.status === "downloading" ? `Downloading${update.percent === undefined ? "" : ` ${update.percent}%`}` : "Check for updates";
	return <motion.div {...pageMotion} className="page-stack narrow-page"><div className="about-mark"><ShieldCheck size={34} /></div><div className="page-title"><p className="eyebrow">ABOUT VIAI SECURITY</p><h2>Local intelligence. Clear decisions.</h2><p>viAI Security is the private visual control plane for the local viAI analysis engine.</p></div><div className="about-grid"><Panel><FileCode2 size={20} /><span>Desktop version</span><strong>{desktopVersion}</strong></Panel><Panel><ShieldCheck size={20} /><span>Engine version</span><strong>{engineVersion}</strong></Panel><Panel><BookOpen size={20} /><span>Legal documents</span><strong className="about-links"><Link to="/legal/terms">Terms of Service</Link><Link to="/legal/privacy">Privacy Policy</Link></strong></Panel><Panel><HeartHandshake size={20} /><span>License</span><strong>viAI ©</strong></Panel></div><Panel className="update-panel"><div><div className="setting-heading"><RefreshCw size={18} /><h3>Application updates</h3></div><p>{update.message}</p></div><Button className="primary" disabled={busy || update.status === "unsupported"} onClick={() => void updateApp()}>{update.status === "downloaded" || update.status === "available" ? <Download size={16} /> : <RefreshCw size={16} />}{label}</Button></Panel></motion.div>;
}