import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, GitCompareArrows, Minus, Sparkles, Undo2 } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { formatMs, formatPct, formatSigned } from "../../../shared/format";
import { compareRuns, type TestDiff } from "../../../shared/metrics";
import { defaultComparison, latestFullRun } from "../../../shared/selectors";
import { CATEGORY_LABELS, CATEGORY_SHORT, SEVERITIES, type TestCategory } from "../../../shared/types";
import { GroupedBars, Legend, SERIES } from "../components/charts";
import { NeedsExperiment } from "../components/Layout";
import { FailureCard } from "../components/results";
import { Banner, Button, Card, CopyButton, EmptyState, ModeBadge, OutputBlock, PageHead, Stat, VerdictBadge } from "../components/ui";
import { DemoNotice, RunProgress } from "../components/workflow";
import { useApp } from "../lib/state";

export default function Compare() {
  return (
    <NeedsExperiment>
      <CompareInner />
    </NeedsExperiment>
  );
}

const CHANGE_META: Record<TestDiff["change"], { label: string; cls: string; icon: ReactNode }> = {
  fixed: { label: "Fixed", cls: "badge-pass", icon: <ArrowUpRight size={12} /> },
  regressed: { label: "Regressed", cls: "badge-fail", icon: <ArrowDownRight size={12} /> },
  "still-failing": { label: "Still failing", cls: "badge-error", icon: <Minus size={12} /> },
  "still-passing": { label: "Still passing", cls: "badge-neutral", icon: <CheckCircle2 size={12} /> },
  "not-compared": { label: "Not compared", cls: "badge-neutral", icon: <Minus size={12} /> },
};

function CompareInner() {
  const { active } = useApp();
  const exp = active!;
  const navigate = useNavigate();
  const defaults = defaultComparison(exp);
  const withRuns = exp.versions.filter((v) => latestFullRun(exp, v.id));
  const [aId, setAId] = useState(defaults.baselineVersion?.id ?? withRuns[0]?.id ?? "");
  const [bId, setBId] = useState(defaults.candidateVersion?.id ?? withRuns.at(-1)?.id ?? "");
  const [filter, setFilter] = useState<TestDiff["change"] | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const runA = latestFullRun(exp, aId);
  const runB = latestFullRun(exp, bId);
  const vA = exp.versions.find((v) => v.id === aId);
  const vB = exp.versions.find((v) => v.id === bId);
  const cmp = useMemo(() => (runA && runB && runA.id !== runB.id ? compareRuns(runA, runB) : null), [runA, runB]);
  const tests = new Map(exp.testCases.map((t) => [t.id, t]));

  const versionSelect = (value: string, set: (v: string) => void, label: string) => (
    <select className="select" style={{ width: 220, height: 36, padding: "0 32px 0 12px" }} value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      {withRuns.map((v) => (
        <option key={v.id} value={v.id}>
          {label}: {v.label}
        </option>
      ))}
    </select>
  );

  if (withRuns.length < 2 || !cmp || !runA || !runB) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <PageHead eyebrow={<><GitCompareArrows size={13} /> Step 05 · Before &amp; after</>} title="Comparison Studio" desc="Original and optimised prompts evaluated on identical tests with identical criteria." />
        <RunProgress exp={exp} />
        {withRuns.length >= 2 && (
          <div className="row">
            {versionSelect(aId, setAId, "Baseline")}
            <ArrowRight size={16} className="muted" />
            {versionSelect(bId, setBId, "Candidate")}
          </div>
        )}
        <Card>
          <EmptyState
            icon={<GitCompareArrows size={26} />}
            title={withRuns.length >= 2 ? "Pick two different versions" : "Need two tested versions"}
            action={<Button variant="primary" icon={<Sparkles size={15} />} onClick={() => navigate("/optimizer")}>Go to Prompt Optimizer</Button>}
          >
            {withRuns.length >= 2
              ? "Select a different baseline and candidate version to compare."
              : `A comparison needs full runs of at least two prompt versions. ${withRuns.length === 1 ? "You have one; generate an improved prompt and retest it." : "Run the test suite first."}`}
          </EmptyState>
        </Card>
      </div>
    );
  }

  const catNames = Array.from(new Set([...Object.keys(cmp.baseline.byCategory), ...Object.keys(cmp.candidate.byCategory)]));
  const catData = catNames.map((c) => {
    const a = cmp.baseline.byCategory[c];
    const b = cmp.candidate.byCategory[c];
    return { name: CATEGORY_SHORT[c as TestCategory] ?? c, original: a ? Math.round((a.passed / a.total) * 1000) / 10 : null, improved: b ? Math.round((b.passed / b.total) * 1000) / 10 : null };
  });
  const sevData = SEVERITIES.map((s) => ({ name: s[0].toUpperCase() + s.slice(1), original: cmp.baseline.bySeverity[s], improved: cmp.candidate.bySeverity[s] }));
  const failA = runA.results.reduce((n, r) => n + r.failures.length, 0);
  const failB = runB.results.reduce((n, r) => n + r.failures.length, 0);
  const diffs = cmp.diffs.filter((d) => filter === "all" || d.change === filter);
  const anyDemo = runA.mode === "demo" || runB.mode === "demo";

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <GitCompareArrows size={13} /> Step 05 · Before &amp; after
          </>
        }
        title="Comparison Studio"
        desc="Original and optimised prompts evaluated on identical tests with identical criteria."
        actions={
          <>
            {versionSelect(aId, setAId, "Baseline")}
            <ArrowRight size={16} className="muted" />
            {versionSelect(bId, setBId, "Candidate")}
          </>
        }
      />
      <RunProgress exp={exp} />
      <DemoNotice show={anyDemo} what="One or both of these runs" />
      {!cmp.comparable && (
        <Banner kind="error">
          <b>Not a like-for-like comparison.</b> The two runs differ in {runA.mode !== runB.mode ? "execution mode (live vs demo)" : runA.criteriaHash !== runB.criteriaHash ? "test cases or evaluation criteria (they were edited between runs)" : "the set of tests executed"}. Retest both versions on the current suite for a fair comparison.
        </Banner>
      )}

      <div className="card card-pad hero-card">
        <div className="grid g-3" style={{ alignItems: "center" }}>
          <div>
            <div className="row small text-2">
              <i className="dot" style={{ background: SERIES.original }} /> {vA?.label} <ModeBadge mode={runA.mode} />
            </div>
            <div className="big-delta mt-8">{formatPct(cmp.baseline.passRate)}</div>
            <div className="small muted mt-8">
              {cmp.baseline.passed}/{cmp.baseline.passed + cmp.baseline.failed} passed
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className={`big-delta ${cmp.passRateDelta > 0 ? "delta-up" : cmp.passRateDelta < 0 ? "delta-down" : ""}`}>{formatSigned(cmp.passRateDelta)}</div>
            <div className="small muted mt-8">
              percentage points{cmp.relativeImprovement !== null ? ` · ${formatSigned(cmp.relativeImprovement, "%")} relative` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="row small text-2" style={{ justifyContent: "flex-end" }}>
              <i className="dot" style={{ background: SERIES.improved }} /> {vB?.label} <ModeBadge mode={runB.mode} />
            </div>
            <div className="big-delta mt-8 grad-text">{formatPct(cmp.candidate.passRate)}</div>
            <div className="small muted mt-8">
              {cmp.candidate.passed}/{cmp.candidate.passed + cmp.candidate.failed} passed
            </div>
          </div>
        </div>
      </div>

      <div className="grid g-5">
        <Stat label="Tests fixed" value={<span className="delta-up">{cmp.fixed}</span>} foot="failed before, pass now" />
        <Stat label="Regressions" value={<span className={cmp.regressed ? "delta-down" : ""}>{cmp.regressed}</span>} foot="passed before, fail now" />
        <Stat label="Failure count" value={`${failA} → ${failB}`} foot={`${cmp.failureReduction >= 0 ? cmp.failureReduction : -cmp.failureReduction} ${cmp.failureReduction >= 0 ? "fewer" : "more"} individual failures`} />
        <Stat label="Output consistency" value={cmp.baseline.avgConsistency === null ? "—" : `${formatPct(cmp.baseline.avgConsistency, 0)} → ${formatPct(cmp.candidate.avgConsistency, 0)}`} foot={cmp.baseline.avgConsistency === null ? "Enable consistency runs (2–3×)" : "mean similarity of repeated runs"} />
        <Stat label="Avg latency" value={<span style={{ fontSize: 20 }}>{formatMs(cmp.baseline.avgLatencyMs)} → {formatMs(cmp.candidate.avgLatencyMs)}</span>} foot="per execution" />
      </div>

      <div className="grid g-2">
        <Card title="Pass rate by category" sub="Same tests, same criteria" actions={<Legend items={[{ label: vA?.label ?? "Original", color: SERIES.original }, { label: vB?.label ?? "Improved", color: SERIES.improved }]} />}>
          <GroupedBars data={catData} />
        </Card>
        <Card title="Failures by severity" sub="Count of individual failures" actions={<Legend items={[{ label: "Original", color: SERIES.original }, { label: "Improved", color: SERIES.improved }]} />}>
          <GroupedBars data={sevData} percent={false} />
        </Card>
      </div>

      <div className="vs">
        <Card title={`Baseline · ${vA?.label}`} actions={<CopyButton text={vA?.prompt ?? ""} />}>
          <pre className="pre">{vA?.prompt}</pre>
        </Card>
        <Card title={`Candidate · ${vB?.label}`} actions={<CopyButton text={vB?.prompt ?? ""} />}>
          <pre className="pre">{vB?.prompt}</pre>
        </Card>
      </div>

      <Card
        title="Test-by-test comparison"
        sub={`${cmp.sharedTestCount} tests compared`}
        bodyClass=""
        actions={
          <div className="chips">
            {(["all", "fixed", "regressed", "still-failing", "still-passing"] as const).map((k) => (
              <button key={k} className={`chip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
                {k === "all" ? "All" : CHANGE_META[k].label}
                <span className="count">{k === "all" ? cmp.diffs.length : cmp.diffs.filter((d) => d.change === k).length}</span>
              </button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Category</th>
                <th>Input</th>
                <th>{vA?.label}</th>
                <th>{vB?.label}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d) => {
                const t = tests.get(d.testId);
                const meta = CHANGE_META[d.change];
                const isOpen = open === d.testId;
                return (
                  <Fragment key={d.testId}>
                    <tr className={`clickable ${isOpen ? "selected" : ""}`} onClick={() => setOpen(isOpen ? null : d.testId)}>
                      <td className="mono small">{d.testId}</td>
                      <td className="small nowrap">{t ? CATEGORY_LABELS[t.category] : "—"}</td>
                      <td className="small" style={{ maxWidth: 340 }}>
                        <div className="truncate">{t?.input || <span className="muted">(empty)</span>}</div>
                      </td>
                      <td>{d.before ? <VerdictBadge verdict={d.before.verdict} /> : "—"}</td>
                      <td>{d.after ? <VerdictBadge verdict={d.after.verdict} /> : "—"}</td>
                      <td>
                        <span className={`badge ${meta.cls}`}>
                          {meta.icon}
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--panel-2)", padding: 18 }}>
                          <div className="vs">
                            {[d.before, d.after].map((r, i) => (
                              <div key={i} className="stack" style={{ gap: 10 }}>
                                <div className="row">
                                  <i className="dot" style={{ background: i === 0 ? SERIES.original : SERIES.improved }} />
                                  <b className="small">{i === 0 ? vA?.label : vB?.label}</b>
                                  {r && <VerdictBadge verdict={r.verdict} />}
                                </div>
                                <OutputBlock text={r?.output || r?.error} />
                                {r?.failures.slice(0, 2).map((f, j) => <FailureCard key={j} f={f} />)}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {cmp.fixed > 0 && (
        <Card title="Detected improvements" sub="Failures from the baseline that no longer occur">
          <ul className="checklist">
            {cmp.diffs
              .filter((d) => d.change === "fixed")
              .slice(0, 12)
              .map((d) => (
                <li key={d.testId}>
                  <CheckCircle2 size={15} className="ok" />
                  <span>
                    <b className="mono small">{d.testId}</b> <span className="muted">({tests.get(d.testId) ? CATEGORY_LABELS[tests.get(d.testId)!.category] : ""})</span>: {d.before?.failures[0]?.what ?? "previously failing"}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}
      {cmp.regressed > 0 && (
        <Banner kind="error" icon={<Undo2 size={16} />}>
          {cmp.regressed} test{cmp.regressed > 1 ? "s" : ""} regressed. Review them above before adopting the candidate prompt.
        </Banner>
      )}
    </div>
  );
}
