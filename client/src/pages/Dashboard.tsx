import { Activity, ArrowRight, Beaker, Bug, CheckCircle2, FlaskConical, Gauge, Layers, Play, Sparkles, TestTubes, XCircle } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTime, formatPct } from "../../../shared/format";
import type { DashboardStats } from "../../../shared/types";
import { ImprovementChart, Legend, SERIES, SeverityChart, TrendChart } from "../components/charts";
import { BrandMark } from "../components/Layout";
import { Banner, Button, Card, EmptyState, Loading, ModeBadge, Stat, tiltHandlers } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/state";
import { hasWebGL, useEffects3D, useReducedMotion, useThemeName } from "../three/hooks";

const CrashCore = lazy(() => import("../three/CrashCore"));

export default function Dashboard() {
  const { experiments, setActiveId, providers, isRunning } = useApp();
  const fx = useEffects3D();
  const reduced = useReducedMotion();
  const theme = useThemeName();
  const webgl = hasWebGL();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats, (e: Error) => setError(e.message));
  }, [experiments, isRunning]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!stats) return <Loading />;

  const trend = [...stats.recent]
    .reverse()
    .slice(-10)
    .map((r, i) => ({ name: `#${i + 1}`, passRate: r.passRate, detail: `${r.experimentName} · ${r.versionLabel}` }));
  const totalFailures = Object.values(stats.severityTotals).reduce((a, b) => a + b, 0);
  const onlyDemo = stats.liveRuns === 0 && stats.demoRuns > 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card hero-card hero3d">
        <div className="hero-copy">
          <span className="sticker" style={{ marginBottom: 18 }}>
            <BrandMark size={14} /> prompt testing lab
          </span>
          <h1 className="hero-title">
            Don't trust your prompt.
            <br />
            <span className="serif scribble">
              Crash it.
              <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
                <path d="M3 13 C 40 4, 80 18, 120 9 S 180 6, 197 11" />
              </svg>
            </span>
          </h1>
          <p className="text-2 hero-lead">
            Generate adversarial tests, execute them, find exactly which instruction failed and why, then optimise and prove the improvement on the identical suite.
          </p>
          <div className="row mt-16">
            <Button variant="primary" size="lg" icon={<Beaker size={16} />} onClick={() => { setActiveId(null); navigate("/studio?new=1"); }}>
              Start a crash test
            </Button>
            <Button size="lg" icon={<Layers size={16} />} onClick={() => navigate("/history")}>
              Prompt history
            </Button>
          </div>
          <div className="pipeline mt-24" aria-label="Workflow">
            {["Submit", "Generate", "Execute", "Detect", "Analyse", "Optimise", "Retest", "Compare"].map((s, i, arr) => (
              <span key={s} className="pipeline-step" style={{ animationDelay: `${i * 0.35}s` }}>
                <i>{String(i + 1).padStart(2, "0")}</i>
                {s}
                {i < arr.length - 1 && <ArrowRight size={11} className="muted" />}
              </span>
            ))}
          </div>
        </div>
        <div className="hero-visual">
          {fx && webgl ? (
            <Suspense fallback={<div className="hero-orb-fallback" />}>
              <CrashCore theme={theme} animate={!reduced} />
            </Suspense>
          ) : (
            <div className="hero-orb-fallback" />
          )}
          {fx && webgl && <span className="hero-hint">Click the core to crash it</span>}
        </div>
      </div>

      {providers?.mode === "demo" && (
        <Banner kind="demo">
          <b>Demo mode.</b> No AI provider is connected for execution, so new runs use the offline simulator and are labelled as demonstration data. <a className="link" onClick={() => navigate("/settings")}>Connect a provider →</a>
        </Banner>
      )}

      <div className="grid g-5">
        <Stat label="Prompts tested" icon={<FlaskConical size={14} />} value={stats.totalExperiments} foot={`${experiments?.reduce((n, e) => n + e.versionCount, 0) ?? 0} prompt versions`} />
        <Stat label="Test cases" icon={<TestTubes size={14} />} value={stats.totalTestCases} foot={`${stats.totalExecutions} executions`} />
        <Stat label="Successful tests" icon={<CheckCircle2 size={14} />} value={stats.passedExecutions} foot="passed across all runs" />
        <Stat label="Failed tests" icon={<XCircle size={14} />} value={stats.failedExecutions} foot={`${totalFailures} individual failures`} />
        <Stat label="Average pass rate" icon={<Gauge size={14} />} value={formatPct(stats.averagePassRate)} accent foot={<span className="row" style={{ gap: 6 }}>full runs · {stats.liveRuns} live / {stats.demoRuns} demo</span>} />
      </div>
      {onlyDemo && <p className="tiny muted" style={{ margin: "-8px 0 0" }}>All runs so far are demo runs. The figures above describe simulated behaviour, not a real model.</p>}

      {stats.totalExperiments === 0 ? (
        <Card>
          <EmptyState icon={<Beaker size={26} />} title="No experiments yet" action={<Button variant="primary" icon={<Play size={15} />} onClick={() => navigate("/studio?new=1")}>Create your first experiment</Button>}>
            Paste a prompt in the Testing Studio. Load one of the examples to see the full workflow in under a minute.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid g-main-side">
            <Card title="Pass-rate trend" sub="Last 10 completed runs, oldest to newest">
              {trend.length ? <TrendChart data={trend} /> : <p className="muted">No completed runs yet.</p>}
            </Card>
            <Card title="Failure severity" sub="All failures across all runs">
              {totalFailures ? <SeverityChart data={stats.severityTotals} height={240} /> : <p className="muted">No failures recorded.</p>}
            </Card>
          </div>

          <div className="grid g-main-side">
            <Card title="Prompt improvement" sub="Original vs latest retested version, per experiment" actions={<Legend items={[{ label: "Original", color: SERIES.original }, { label: "Improved", color: SERIES.improved }]} />}>
              {stats.improvements.length ? (
                <ImprovementChart data={stats.improvements.map((i) => ({ name: i.experimentName, original: i.original, improved: i.improved }))} />
              ) : (
                <EmptyState icon={<Sparkles size={22} />} title="No before/after data yet">
                  Optimise a prompt and retest it to see improvement here.
                </EmptyState>
              )}
            </Card>
            <Card title="Category robustness" sub="Pass rate by test category, all runs">
              <div className="stack" style={{ gap: 12 }}>
                {Object.entries(stats.categoryTotals)
                  .sort((a, b) => a[1].passed / a[1].total - b[1].passed / b[1].total)
                  .map(([name, v]) => {
                    const pct = (v.passed / v.total) * 100;
                    return (
                      <div key={name}>
                        <div className="row-between small">
                          <span>{name}</span>
                          <span className="muted">
                            {v.passed}/{v.total} · <b className="text-2">{pct.toFixed(0)}%</b>
                          </span>
                        </div>
                        <div className="progress mt-8" style={{ height: 6 }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                {!Object.keys(stats.categoryTotals).length && <p className="muted">No data yet.</p>}
              </div>
            </Card>
          </div>

          <Card title={<span className="row"><Activity size={16} /> Recent testing activity</span>} bodyClass="">
            {stats.recent.length === 0 ? (
              <div className="card-body muted">No runs yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Experiment</th>
                      <th>Version</th>
                      <th>Tests</th>
                      <th>Pass rate</th>
                      <th>Mode</th>
                      <th>Finished</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent.map((r) => (
                      <tr key={r.runId} className="clickable" onClick={() => { setActiveId(r.experimentId); navigate("/failures"); }}>
                        <td>
                          <b>{r.experimentName}</b>
                        </td>
                        <td className="small text-2">{r.versionLabel}</td>
                        <td className="small">{r.total}</td>
                        <td>
                          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                            <div className="progress" style={{ width: 70, height: 6 }}>
                              <span style={{ width: `${r.passRate}%` }} />
                            </div>
                            <b className="small">{r.passRate}%</b>
                          </div>
                        </td>
                        <td>
                          <ModeBadge mode={r.mode} />
                        </td>
                        <td className="small muted nowrap">{formatDateTime(r.finishedAt)}</td>
                        <td>
                          <span className="row small link" style={{ flexWrap: "nowrap" }}>
                            <Bug size={13} /> Analyse
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid g-3">
            {[
              { icon: <TestTubes size={18} />, title: "Test Case Lab", text: "Inspect, edit and run individual tests.", to: "/tests" },
              { icon: <Layers size={18} />, title: "Prompt History", text: "Reopen and compare past experiments.", to: "/history" },
              { icon: <Sparkles size={18} />, title: "Prompt Optimizer", text: "Turn failures into a better prompt.", to: "/optimizer" },
            ].map((c) => (
              <button key={c.to} className="card card-pad tilt" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => navigate(c.to)} {...tiltHandlers}>
                <div className="row">
                  <span className="empty-icon" style={{ width: 36, height: 36, margin: 0, borderRadius: 10 }}>{c.icon}</span>
                  <div>
                    <b>{c.title}</b>
                    <div className="small muted">{c.text}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
