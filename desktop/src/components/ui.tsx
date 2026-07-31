import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { RiskLevel } from "../types";

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.01 }} transition={{ duration: 0.2 }} className={`panel ${className}`}>{children}</motion.section>;
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const Icon = risk === "high" ? AlertTriangle : risk === "medium" ? Info : CheckCircle2;
  return <span className={`risk-badge ${risk}`}><Icon size={14} />{risk} risk</span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>;
}

export function Skeleton({ className = "" }: { className?: string }) { return <div className={`skeleton ${className}`} aria-hidden="true" />; }

export type IconType = LucideIcon;