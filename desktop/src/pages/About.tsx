import { BookOpen, FileCode2, HeartHandshake, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Panel } from "../components/ui";
import { pageMotion } from "../animations/motion";

export default function About() {
	const [desktopVersion, setDesktopVersion] = useState("Unavailable");
	useEffect(() => { void window.viai?.application.version().then(setDesktopVersion); }, []);
	return <motion.div {...pageMotion} className="page-stack narrow-page"><div className="about-mark"><ShieldCheck size={34} /></div><div className="page-title"><p className="eyebrow">ABOUT VIAI</p><h2>Local intelligence. Clear decisions.</h2><p>viAI security is the private visual control plane for the viAI Local Security Engine.</p></div><div className="about-grid"><Panel><FileCode2 size={20} /><span>Desktop version</span><strong>{desktopVersion}</strong></Panel><Panel><ShieldCheck size={20} /><span>Engine version</span><strong>0.1.1</strong></Panel><Panel><BookOpen size={20} /><span>Documentation</span><strong>Local repository docs</strong></Panel><Panel><HeartHandshake size={20} /><span>License</span><strong>viAI ©</strong></Panel></div></motion.div>;
}