import { motion } from "framer-motion";
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Info } from "lucide-react";
import type { RiskLevel } from "../types";
import { LoadingScreen } from "./LoadingScreen";

export function Panel({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <motion.section className={`panel ${className}`}>{children}</motion.section>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function Button({ children, className = "", ...props }, ref) {
  return <button ref={ref} className={`button ${className}`} {...props}>{children}</button>;
});

export function DropdownMenu<T extends string>({ label, value, options, onChange, icon: Icon, ariaLabel }: { label: string; value?: T; options: readonly { value: T; label: string }[]; onChange(value: T): void; icon?: LucideIcon; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0 });
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => { if (event.target instanceof Node && !container.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const horizontalPadding = 12;
      const menuWidth = Math.max(menu.current?.offsetWidth ?? 156, bounds.width);
      const left = Math.max(horizontalPadding, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - horizontalPadding));
      setPosition({ left, top: bounds.bottom + 6, maxHeight: Math.max(120, window.innerHeight - bounds.bottom - 18) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    event.preventDefault();
  };
  const list = open ? createPortal(<div id={menuId} ref={menu} className="dropdown-menu-list" role="menu" style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }} onKeyDown={onMenuKeyDown}>{options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}><span>{option.label}</span>{value === option.value && <Check size={15} aria-hidden="true" />}</button>)}</div>, document.body) : null;
  return <div className="dropdown-menu" ref={container}><Button ref={trigger} type="button" aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((current) => !current)}>{Icon && <Icon size={16} />}{label}<ChevronDown size={15} aria-hidden="true" /></Button>{list}</div>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const Icon = risk === "high" ? AlertTriangle : risk === "medium" ? Info : CheckCircle2;
  return <span className={`risk-badge ${risk}`}><Icon size={14} />{risk} risk</span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange}><span /></button>;
}

export function Skeleton({ className = "" }: { className?: string }) { return <div className={`skeleton ${className}`} aria-hidden="true" />; }

export function LoadingState({ title = "Loading local data", detail = "Retrieving records stored on this device." }: { title?: string; detail?: string }) {
  return <LoadingScreen title={title} detail={detail} />;
}

export function ConfirmDialog({ open, title, detail, confirmLabel, onCancel, onConfirm, children }: { open: boolean; title: string; detail: string; confirmLabel: string; onCancel(): void; onConfirm(): void; children?: ReactNode }) {
  useEffect(() => { if (!open) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [open, onCancel]);
  if (!open) return null;
  return createPortal(<div className="confirm-backdrop" role="presentation" onMouseDown={onCancel}><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="confirm-dialog-title">{title}</h2><p>{detail}</p>{children}<div className="confirm-actions"><Button type="button" onClick={onCancel}>Cancel</Button><Button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</Button></div></section></div>, document.body);
}

export type IconType = LucideIcon;