import { AlertOctagon, Bug, CheckCircle2, Layers, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTime } from "../../../shared/format";
import { topSeverity } from "../../../shared/metrics";
import { versionLabel } from "../../../shared/selectors";
import { CATEGORY_LABELS, FAILURE_TYPE_LABELS, SEVERITIES, type Failure, type Severity } from "../../../shared/types";
import { SeverityChart } from "../components/charts";
import { NeedsExperiment } from "../components/Layout";
import { FailureCard, ResultDetail } from "../components/results";
import { Button, Card, EmptyState, PageHead, SeverityBadge, Stat, Tabs } from "../components/ui";
import { DemoNotice, RunMeta, RunProgress } from "../components/workflow";
import { useApp } from "../lib/state";

export default function Failures() {
  return (
    <NeedsExperiment>
      <FailuresInner />
    </NeedsExperiment>
  );
}

const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function FailuresInner() {
  const { active } = useApp();
  const exp = active!;
  const navigate = useNavigate();
  const runs = exp.runs.filter((r) => r.status === "completed" || r.status === "cancelled" || (r.status === "failed" && r.results.length));
  const [runId, setRunId] = useState<string | undefined>(runs.at(-1)?.id);
  useEffect(() => {
    if (!runs.some((r) => r.id === runId)) setRunId(runs.at(-1)?.id);
  }, [runs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = runs.find((r) => r.id === runId);
  const [tab, setTab] = useState<"tests" | "causes">("tests");
  const [sevFilter, setSevFilter] = useState<Severity | "all">("all");
  const tests = useMemo(() => new Map(exp.testCases.map((t) => [t.id, t])), [exp.testCases]);

  const failed = useMemo(
    () =>
      (run?.results ?? [])
        .filter((r) => r.verdict !== "pass")
        .sort((a, b) => sevRank[topSeverity(a) ?? "low"] - sevRank[topSeverity(b) ?? "low"]),
    [run],
  );
  const shown = failed.filter((r) => sevFilter === "all" || topSeverity(r) === sevFilter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shown.find((r) => r.testId === selectedId) ?? shown[0];

  const allFailures = failed.flatMap((r) => r.failures.map((f) => ({ f, testId: r.testId })));
  const byType = Object.entries(
    allFailures.reduce<Record<string, number>>((m, { f }) => {
      m[f.type] = (m[f.type] ?? 0) + 1;
      return m;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  // Root-cause view: group failures by the responsible instruction.
  const causes = useMemo(() => {
    const g = new Map<string, { instruction: string; failures: Failure[]; tests: Set<string>; severity: Severity }>();
    for (const { f, testId } of allFailures) {
      const key = f.instruction.trim().toLowerCase().slice(0, 120) || "missing";
      const e = g.get(key) ?? { instruction: f.instruction, failures: [], tests: new Set<string>(), severity: f.severity };
      e.failures.push(f);
      e.tests.add(testId);
      if (sevRank[f.severity] < sevRank[e.severity]) e.severity = f.severity;
      g.set(key, e);
    }
    return [...g.values()].sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.tests.size - a.tests.size);
  }, [allFailures]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <Bug size={13} /> Step 03 · Failure detection
          </>
        }
        title="Failure Analysis"
        desc="Every failed test, why it failed, which instruction is responsible and how to fix it."
        actions={
          <>
            {runs.length > 0 && (
              <select className="select" style={{ width: 330, height: 36, padding: "0 32px 0 12px" }} value={run?.id ?? ""} onChange={(e) => setRunId(e.target.value)} aria-label="Run">
                {[...runs].reverse().map((r) => (
                  <option key={r.id} value={r.id}>
                    {versionLabel(exp, r.versionId)} · {formatDateTime(r.startedAt)} · {r.summary.passRate}% {r.scope === "partial" ? "(partial)" : ""}
                  </option>
                ))}
              </select>
            )}
            <Button variant="primary" icon={<Sparkles size={15} />} disabled={!run} onClick={() => navigate("/optimizer")}>
              Optimise prompt
            </Button>
          </>
        }
      />
      <RunProgress exp={exp} />

      {!run ? (
        <Card>
          <EmptyState icon={<Bug size={26} />} title="Nothing to analyse yet" action={<Button variant="primary" onClick={() => navigate("/studio")}>Go to Testing Studio</Button>}>
            Execute the test suite first. Failures appear here with explanations and suggested fixes.
          </EmptyState>
        </Card>
      ) : (
        <>
          <RunMeta run={run} exp={exp} />
          <DemoNotice show={run.mode === "demo"} what="These failures" />
          <div className="grid g-4">
            <Stat label="Failed tests" icon={<AlertOctagon size={14} />} value={`${run.summary.failed}`} foot={`of ${run.summary.completed} executed · ${run.summary.errored} errors`} />
            <Stat label="Pass rate" icon={<Target size={14} />} value={`${run.summary.passRate}%`} accent foot={versionLabel(exp, run.versionId)} />
            <Stat label="Critical + high" icon={<Layers size={14} />} value={run.summary.bySeverity.critical + run.summary.bySeverity.high} foot={`${allFailures.length} individual failures`} />
            <Stat label="Most common" icon={<Bug size={14} />} value={<span style={{ fontSize: 17 }}>{byType[0] ? FAILURE_TYPE_LABELS[byType[0][0] as keyof typeof FAILURE_TYPE_LABELS] : "None"}</span>} foot={byType[0] ? `${byType[0][1]} occurrences` : "No failures"} />
          </div>

          {failed.length === 0 ? (
            <Card>
              <EmptyState icon={<CheckCircle2 size={26} />} title="No failures in this run">
                Every executed test passed. Try adding harder test cases in the Test Lab, or enable consistency runs to check stability.
              </EmptyState>
            </Card>
          ) : (
            <>
              <div className="grid g-2">
                <Card title="Severity distribution" sub="Count of individual failures by severity">
                  <SeverityChart data={run.summary.bySeverity} />
                </Card>
                <Card title="Failure types" sub="What kind of problems were detected">
                  <div className="stack" style={{ gap: 12 }}>
                    {byType.map(([type, n]) => (
                      <div key={type}>
                        <div className="row-between small">
                          <span>{FAILURE_TYPE_LABELS[type as keyof typeof FAILURE_TYPE_LABELS]}</span>
                          <b>{n}</b>
                        </div>
                        <div className="progress mt-8" style={{ height: 6 }}>
                          <span style={{ width: `${(n / allFailures.length) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: "tests", label: "Failed tests", count: failed.length },
                  { id: "causes", label: "Root causes", count: causes.length },
                ]}
              />

              {tab === "tests" ? (
                <div className="grid g-list">
                  <Card bodyClass="">
                    <div className="card-body" style={{ borderBottom: "1px solid var(--border)", padding: "12px 16px" }}>
                      <div className="chips">
                        {(["all", ...SEVERITIES] as const).map((s) => (
                          <button key={s} className={`chip ${sevFilter === s ? "on" : ""}`} onClick={() => setSevFilter(s)}>
                            {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ maxHeight: 720, overflow: "auto" }}>
                      {shown.map((r) => {
                        const t = tests.get(r.testId);
                        const sev = topSeverity(r);
                        return (
                          <div key={r.testId} className={`list-item ${selected?.testId === r.testId ? "selected" : ""}`} onClick={() => setSelectedId(r.testId)}>
                            <div className="row-between">
                              <span className="mono small">{r.testId}</span>
                              {sev ? <SeverityBadge severity={sev} /> : <span className="badge badge-error">error</span>}
                            </div>
                            <div className="small text-2 mt-8">{t ? CATEGORY_LABELS[t.category] : ""}</div>
                            <div className="small truncate muted">{r.failures[0]?.what ?? r.error}</div>
                          </div>
                        );
                      })}
                      {shown.length === 0 && <div className="muted small" style={{ padding: 16 }}>No failures at this severity.</div>}
                    </div>
                  </Card>
                  <Card title={selected ? `${selected.testId} · ${tests.get(selected.testId) ? CATEGORY_LABELS[tests.get(selected.testId)!.category] : ""}` : "Select a failure"}>
                    {selected ? <ResultDetail test={tests.get(selected.testId)} result={selected} /> : <p className="muted">Select a failed test on the left.</p>}
                  </Card>
                </div>
              ) : (
                <div className="stack">
                  {causes.map((c, i) => (
                    <Card
                      key={i}
                      title={
                        <span className="row">
                          <SeverityBadge severity={c.severity} />
                          {c.instruction === "missing" ? "Missing instruction" : <code className="small" style={{ fontWeight: 400 }}>{c.instruction.slice(0, 140)}</code>}
                        </span>
                      }
                      sub={`${c.failures.length} failure${c.failures.length > 1 ? "s" : ""} across ${c.tests.size} test${c.tests.size > 1 ? "s" : ""}: ${[...c.tests].slice(0, 8).join(", ")}`}
                    >
                      <div className="stack" style={{ gap: 10 }}>
                        {dedupe(c.failures).slice(0, 3).map((f, j) => (
                          <FailureCard key={j} f={f} />
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function dedupe(fs: Failure[]): Failure[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = `${f.type}|${f.fix}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
