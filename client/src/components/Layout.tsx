import { BarChart3, Beaker, Box, Bug, FileText, FlaskConical, GitCompareArrows, History, LayoutDashboard, Menu, Plus, Settings, Sparkles, Square, TestTubes } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/state";
import { hasWebGL, setEffects3D, useEffects3D, useReducedMotion } from "../three/hooks";
import { Button, ConfirmHost, ModeBadge, Toasts } from "./ui";

const BackgroundField = lazy(() => import("../three/BackgroundField"));

const NAV: Array<{ section: string; items: Array<{ to: string; label: string; icon: ReactNode; step?: string }> }> = [
  { section: "Overview", items: [{ to: "/", label: "Dashboard", icon: <LayoutDashboard size={17} /> }] },
  {
    section: "Crash workflow",
    items: [
      { to: "/studio", label: "Testing Studio", icon: <Beaker size={17} />, step: "01" },
      { to: "/tests", label: "Test Case Lab", icon: <TestTubes size={17} />, step: "02" },
      { to: "/failures", label: "Failure Analysis", icon: <Bug size={17} />, step: "03" },
      { to: "/optimizer", label: "Prompt Optimizer", icon: <Sparkles size={17} />, step: "04" },
      { to: "/compare", label: "Comparison Studio", icon: <GitCompareArrows size={17} />, step: "05" },
    ],
  },
  {
    section: "Library",
    items: [
      { to: "/history", label: "Prompt History", icon: <History size={17} /> },
      { to: "/reports", label: "Reports", icon: <FileText size={17} /> },
    ],
  },
  { section: "System", items: [{ to: "/settings", label: "Settings & Providers", icon: <Settings size={17} /> }] },
];

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="#6B3E22" />
      <path d="M12 6.5h8M14 6.5v6.8l-5.6 10.3a2 2 0 0 0 1.75 2.95h11.7a2 2 0 0 0 1.75-2.95L18 13.3V6.5" fill="none" stroke="#F1E9DD" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 15.2l-2.9 4.6h3.8l-2.4 4.2" fill="none" stroke="#D8B48A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { providers, experiments, activeId, setActiveId, active, isRunning } = useApp();
  const [open, setOpen] = useState(false);
  const fx = useEffects3D();
  const reduced = useReducedMotion();
  const webgl = hasWebGL();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const current = NAV.flatMap((s) => s.items).find((i) => (i.to === "/" ? location.pathname === "/" : location.pathname.startsWith(i.to)));

  return (
    <div className={`shell ${fx && webgl ? "fx-on" : ""}`}>
      <div className="aurora" aria-hidden="true" />
      {fx && webgl && (
        <Suspense fallback={null}>
          <BackgroundField theme="light" animate={!reduced} />
        </Suspense>
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <BrandMark />
          <div className="brand-name">
            Prompt Crash Lab
            <span>break your own AI</span>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((s) => (
            <div key={s.section}>
              <div className="nav-section">{s.section}</div>
              {s.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  {i.icon}
                  {i.label}
                  {i.step && <span className="nav-step">{i.step}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="small muted" style={{ marginBottom: 8 }}>Execution</div>
          {providers ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row small">
                <ModeBadge mode={providers.mode} />
              </div>
              <div className="tiny muted">
                Executor: <b className="text-2">{providers.settings.executor}</b> · Analyst: <b className="text-2">{providers.settings.analyst}</b>
              </div>
            </div>
          ) : (
            <div className="skeleton" style={{ height: 40 }} />
          )}
        </div>
      </aside>
      {open && <div className="overlay" style={{ zIndex: 50, background: "rgba(62,36,20,.35)" }} onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <Button className="menu-btn" variant="ghost" onClick={() => setOpen(true)} icon={<Menu size={18} />} aria-label="Open navigation" />
          <div className="crumbs">
            <span className="hide-mobile">Prompt Crash Lab</span>
            <span className="hide-mobile">/</span>
            <b>{current?.label ?? "Page"}</b>
          </div>
          <div className="topbar-right">
            {isRunning && (
              <span className="badge badge-accent">
                <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Run in progress
              </span>
            )}
            <select
              className="select hide-mobile"
              style={{ width: 250, height: 36, padding: "0 32px 0 12px" }}
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value || null)}
              aria-label="Active experiment"
            >
              <option value="">{experiments?.length ? "Select an experiment…" : "No experiments yet"}</option>
              {experiments?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
              {active && !experiments?.some((e) => e.id === active.id) && <option value={active.id}>{active.name}</option>}
            </select>
            {webgl && (
              <Button
                variant="ghost"
                className={fx ? "fx-toggle on" : "fx-toggle"}
                onClick={() => setEffects3D(!fx)}
                icon={fx ? <Box size={17} /> : <Square size={17} />}
                aria-label={fx ? "Turn off 3D effects" : "Turn on 3D effects"}
                aria-pressed={fx}
                title={fx ? "3D effects on" : "3D effects off"}
              />
            )}
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                setActiveId(null);
                navigate("/studio?new=1");
              }}
            >
              <span className="hide-mobile">New experiment</span>
            </Button>
          </div>
        </header>
        <main className="content">
          <div key={location.pathname} className="page-enter">
            {children}
          </div>
        </main>
      </div>
      <Toasts />
      <ConfirmHost />
    </div>
  );
}

/** Shown on workflow pages when no experiment is selected. */
export function NeedsExperiment({ children }: { children: ReactNode }) {
  const { active, activeId, activeLoading, activeError, experiments, setActiveId } = useApp();
  const navigate = useNavigate();
  if (activeId && (activeLoading || (!active && !activeError)))
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 34, width: 280 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    );
  if (activeError) return <div className="banner banner-error">{activeError}</div>;
  if (!active)
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon">
            <FlaskConical size={26} />
          </div>
          <h3>No experiment selected</h3>
          <p>Start a new experiment in the Testing Studio, or open one of your previous experiments.</p>
          <div className="row mt-8" style={{ justifyContent: "center" }}>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/studio?new=1")}>
              New experiment
            </Button>
            {experiments && experiments.length > 0 && (
              <Button icon={<History size={16} />} onClick={() => navigate("/history")}>
                Open from history
              </Button>
            )}
          </div>
          {experiments && experiments.length > 0 && (
            <div className="chips mt-16" style={{ justifyContent: "center" }}>
              {experiments.slice(0, 4).map((e) => (
                <button key={e.id} className="chip" onClick={() => setActiveId(e.id)}>
                  <BarChart3 size={12} />
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  return <>{children}</>;
}
