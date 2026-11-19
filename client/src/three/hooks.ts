/**
 * Lightweight helpers for the 3D layer. Nothing here imports three.js, so the
 * main bundle stays small; the scenes themselves are lazy-loaded.
 */
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

let glCache: boolean | null = null;

/** True when the browser can create a WebGL context (cached; the probe context is released). */
export function hasWebGL(): boolean {
  if (glCache !== null) return glCache;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    glCache = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    glCache = false;
  }
  return glCache;
}

/* ---------- User preference: 3D effects on/off (per browser) ---------- */

const FX_KEY = "pcl-fx";
const fxListeners = new Set<() => void>();
let fxEnabled = readFx();

function readFx(): boolean {
  try {
    return localStorage.getItem(FX_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setEffects3D(on: boolean) {
  fxEnabled = on;
  try {
    localStorage.setItem(FX_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  fxListeners.forEach((l) => l());
}

export function useEffects3D(): boolean {
  return useSyncExternalStore(
    (cb) => {
      fxListeners.add(cb);
      return () => fxListeners.delete(cb);
    },
    () => fxEnabled,
  );
}

/* ---------- Environment ---------- */

export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export type ThemeName = "dark" | "light";

/** Follows the `data-theme` attribute on <html>. */
export function useThemeName(): ThemeName {
  const read = (): ThemeName => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  const [theme, setTheme] = useState<ThemeName>(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** True while the element is on screen; used to pause rendering off-screen. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return inView;
}

/** True while the tab is visible. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
