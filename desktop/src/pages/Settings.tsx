import { Bot, Cloud, Cpu, Languages, Moon, Network, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Panel, Toggle } from "../components/ui";
import { pageMotion } from "../animations/motion";

type SettingsSnapshot = { settings: Record<string, unknown> };

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  useEffect(() => {
    let active = true;
    const sync = (value: unknown) => { const snapshot = value as SettingsSnapshot; if (active && snapshot?.settings) setSettings(snapshot.settings); };
    void window.viai?.background.snapshot().then(sync);
    return window.viai?.background.onChanged(sync);
  }, []);
  const update = async (changes: Record<string, unknown>) => {
    const snapshot = await window.viai?.background.update(changes) as SettingsSnapshot | undefined;
    if (snapshot?.settings) setSettings(snapshot.settings);
  };
  const concurrency = typeof settings.maximumParallelScans === "number" && settings.maximumParallelScans > 0 ? settings.maximumParallelScans : 4;
  return <motion.div {...pageMotion} className="page-stack"><div className="page-title"><p className="eyebrow">APPLICATION PREFERENCES</p><h2>Settings</h2><p>Control how the desktop app presents and schedules local analysis.</p></div><section className="settings-grid"><Panel><div className="setting-heading"><Moon size={18} /><h3>Appearance</h3></div><div className="setting-row"><div><strong>Dark mode</strong><p>Use the reduced-glare desktop theme.</p></div><Toggle checked={settings.desktopDarkMode === true} label="Toggle dark mode" onChange={() => void update({ desktopDarkMode: settings.desktopDarkMode !== true })} /></div><div className="setting-row"><div><strong>Language</strong><p>English (United States)</p></div><Languages size={18} /></div></Panel><Panel><div className="setting-heading"><Cpu size={18} /><h3>Performance</h3></div><label className="select-setting"><span>Scan mode</span><select value={String(settings.performanceMode ?? "balanced")} onChange={(event) => void update({ performanceMode: event.target.value })}><option value="low">Quiet</option><option value="balanced">Balanced</option><option value="high">Performance</option></select></label><label className="range-setting"><span>Analysis concurrency <strong>{concurrency}</strong></span><input type="range" min="1" max="8" step="1" value={concurrency} onChange={(event) => { const value = Number(event.target.value); void update({ maximumParallelScans: value <= 1 ? 1 : value <= 2 ? 2 : value <= 4 ? 4 : 8 }); }} /></label></Panel><Panel className="coming-soon"><div className="setting-heading"><SlidersHorizontal size={18} /><h3>Future modules</h3></div><div className="future-grid"><Future icon={Bot} name="AI Investigation" /><Future icon={Cloud} name="Cloud Reputation" /><Future icon={ShieldAlert} name="Zero-Day Detection" /><Future icon={Network} name="Network Monitor" /></div></Panel></section></motion.div>;
}

function Future({ icon: Icon, name }: { icon: typeof Bot; name: string }) { return <div><Icon size={17} /><span>{name}</span><small>Coming soon</small></div>; }