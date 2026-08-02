import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type PropsWithChildren } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Info } from "lucide-react";
import type { RiskLevel } from "../types";

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.01 }} transition={{ duration: 0.2 }} className={`panel ${className}`}>{children}</motion.section>;
}

export function Button({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props}>{children}</button>;
}

export function DropdownMenu<T extends string>({ label, value, options, onChange, icon: Icon, ariaLabel }: { label: string; value?: T; options: readonly { value: T; label: string }[]; onChange(value: T): void; icon?: LucideIcon; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);
  return <div className="dropdown-menu" ref={container}><Button type="button" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}>{Icon && <Icon size={16} />}{label}<ChevronDown size={15} aria-hidden="true" /></Button>{open && <div id={menuId} className="dropdown-menu-list" role="menu">{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{value === option.value && <Check size={15} aria-hidden="true" />}</button>)}</div>}</div>;
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