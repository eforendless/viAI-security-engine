import { motion } from "framer-motion";

export function Radar({ progress, active }: { progress: number; active: boolean }) {
  return <div className={`radar ${active ? "active" : ""}`} role="img" aria-label={`Scan progress ${Math.round(progress)} percent`}>
    <div className="radar-grid" />
    <motion.div className="radar-sweep" animate={active ? { rotate: 360 } : { rotate: 0 }} transition={{ duration: 2.4, ease: "linear", repeat: active ? Infinity : 0 }} />
    <div className="radar-core"><strong>{Math.round(progress)}%</strong><span>scanned</span></div>
  </div>;
}