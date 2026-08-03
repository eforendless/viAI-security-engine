import { lazy, Suspense } from "react";
import { motion } from "framer-motion";

const Logo3D = lazy(() => import("./Logo3D").then((module) => ({ default: module.Logo3D })));
const logoPath = `${import.meta.env.BASE_URL}viai-logodone.png`;

export function LoadingScreen({ title = "Loading local data", detail = "Retrieving records stored on this device.", completing = false }: { title?: string; detail?: string; completing?: boolean }) {
  return <motion.div className="loading-screen" role="status" aria-live="polite" initial={{ opacity: 0, scale: 0.94 }} animate={completing ? { opacity: 0, scale: 0.76, y: -18 } : { opacity: 1, scale: 1, y: 0 }} transition={{ duration: completing ? 0.34 : 0.42, ease: "easeOut" }}><Suspense fallback={<div className="logo-3d" aria-hidden="true"><img className="logo-3d-fallback" src={logoPath} alt="" /></div>}><Logo3D /></Suspense><div><strong>{title}</strong><p>{detail}</p><span className="loading-screen-progress" aria-hidden="true">Loading...</span></div></motion.div>;
}