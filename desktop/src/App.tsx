import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

export function LegacyApp() {
  const [count, setCount] = useState(0)

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div>
          <h1>Get started</h1>
          <p>
            Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
          </p>
        </div>
        <button
          type="button"
          className="counter"
          onClick={() => setCount((count) => count + 1)}
        >
          Count is {count}
        </button>
      </section>

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Documentation</h2>
          <p>Your questions, answered</p>
          <ul>
            <li>
              <a href="https://vite.dev/" target="_blank">
                <img className="logo" src={viteLogo} alt="" />
                Explore Vite
              </a>
            </li>
            <li>
              <a href="https://react.dev/" target="_blank">
                <img className="button-icon" src={reactLogo} alt="" />
                Learn more
              </a>
            </li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Connect with us</h2>
          <p>Join the Vite community</p>
          <ul>
            <li>
              <a href="https://github.com/vitejs/vite" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#github-icon"></use>
                </svg>
                GitHub
              </a>
            </li>
            <li>
              <a href="https://chat.vite.dev/" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#discord-icon"></use>
                </svg>
                Discord
              </a>
            </li>
            <li>
              <a href="https://x.com/vite_js" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#x-icon"></use>
                </svg>
                X.com
              </a>
            </li>
            <li>
              <a href="https://bsky.app/profile/vite.dev" target="_blank">
                <svg
                  className="button-icon"
                  role="presentation"
                  aria-hidden="true"
                >
                  <use href="/icons.svg#bluesky-icon"></use>
                </svg>
                Bluesky
              </a>
            </li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

import { lazy, useEffect } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import "./experience.css";
import { getMonitoringStatus, probeEngine } from "./api/engineClient";
import { AppShell } from "./layout/AppShell";
import { useSecurityStore } from "./store/securityStore";

const loadDashboard = () => import("./pages/DashboardLive");
const loadQuickScan = () => import("./pages/QuickScan");
const loadFullScan = () => import("./pages/FullScan");
const loadRealtime = () => import("./pages/Realtime");
const loadHistory = () => import("./pages/History");
const loadFileDetails = () => import("./pages/FileDetails");
const loadSettings = () => import("./pages/Settings");
const loadAbout = () => import("./pages/About");
const loadDeviceSecurity = () => import("./pages/DeviceSecurity");
const loadLegal = () => import("./pages/Legal");
const loadLoadingPreview = () => import("./pages/LoadingPreview");

const Dashboard = lazy(loadDashboard);
const QuickScan = lazy(loadQuickScan);
const FullScan = lazy(loadFullScan);
const Realtime = lazy(loadRealtime);
const History = lazy(loadHistory);
const FileDetails = lazy(loadFileDetails);
const Settings = lazy(loadSettings);
const About = lazy(loadAbout);
const DeviceSecurity = lazy(loadDeviceSecurity);
const Legal = lazy(loadLegal);
const LoadingPreview = lazy(loadLoadingPreview);

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const darkMode = useSecurityStore((state) => state.darkMode);
  useEffect(() => { document.documentElement.dataset.theme = darkMode ? "dark" : "light"; }, [darkMode]);
  useEffect(() => {
    let active = true;
    const syncBackground = (value: unknown) => {
      if (!active || !value || typeof value !== "object") return;
      const snapshot = value as { settings?: Record<string, unknown>; activeScan?: Record<string, unknown>; lastCompletedScan?: Record<string, unknown>; history?: unknown[]; activeMonitors?: unknown[]; scanCacheEntries?: unknown };
      useSecurityStore.getState().hydrateBackground(snapshot.settings ?? {}, snapshot.activeScan, snapshot.history, snapshot.activeMonitors, snapshot.scanCacheEntries, snapshot.lastCompletedScan);
    };
    void window.viai?.background.snapshot().then(syncBackground);
    return window.viai?.background.onChanged(syncBackground);
  }, []);
  useEffect(() => window.viai?.scans.onEvent((value) => {
    const update = value as { scan?: Record<string, unknown> };
    if (update.scan) useSecurityStore.getState().hydrateBackground({}, update.scan);
  }), []);
  useEffect(() => {
    let cancelled = false;
    const syncEngine = async () => {
      const online = await probeEngine();
      if (cancelled) return;
      const store = useSecurityStore.getState();
      store.setEngineOnline(online);
      if (!online || window.viai) return;
      try {
        const monitoring = await getMonitoringStatus();
        if (cancelled) return;
        store.setMonitoringStatus(monitoring);
      } catch {
        store.setEngineOnline(false);
      }
    };
    void syncEngine();
    const timer = window.setInterval(() => void syncEngine(), 3_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => window.viai?.background.onCommand((command) => {
    navigate(command === "quick-scan" ? "/quick-scan" : command === "realtime" ? "/realtime" : command === "history" ? "/history" : "/settings");
  }), [navigate]);
  useEffect(() => {
    const preload = () => { void loadQuickScan(); void loadFullScan(); void loadRealtime(); void loadHistory(); void loadDeviceSecurity(); };
    const timer = window.setTimeout(preload, 700);
    return () => window.clearTimeout(timer);
  }, []);
  return <Routes location={location}><Route path="/loading-preview" element={<LoadingPreview />} /><Route element={<AppShell />}><Route path="/" element={<Dashboard />} /><Route path="/quick-scan" element={<QuickScan />} /><Route path="/full-scan" element={<FullScan />} /><Route path="/realtime" element={<Realtime />} /><Route path="/device-security" element={<DeviceSecurity />} /><Route path="/history" element={<History />} /><Route path="/details/:id" element={<FileDetails />} /><Route path="/settings" element={<Settings />} /><Route path="/about" element={<About />} /><Route path="/legal/terms" element={<Legal document="terms" />} /><Route path="/legal/privacy" element={<Legal document="privacy" />} /></Route></Routes>;
}

function DesktopApp() { return <HashRouter><AppRoutes /><Toaster position="bottom-right" toastOptions={{ style: { borderRadius: 8, fontFamily: "Segoe UI Variable, sans-serif" } }} /></HashRouter>; }

export default DesktopApp
