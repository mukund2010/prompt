import { CheckCircle2, ChevronDown, ChevronRight, Lightbulb, Quote, XCircle } from "lucide-react";
import { Fragment, useState } from "react";
import { formatMs } from "../../../shared/format";
import { topSeverity } from "../../../shared/metrics";
import { CATEGORY_LABELS, FAILURE_TYPE_LABELS, type Failure, type TestCase, type TestResult } from "../../../shared/types";
import { OutputBlock, SeverityBadge, VerdictBadge } from "./ui";

export function FailureCard({ f }: { f: Failure }) {
  return (
    <div className={`fail-card ${f.severity}`}>
      <div className="row">
        <SeverityBadge severity={f.severity} />
        <b>{FAILURE_TYPE_LABELS[f.type]}</b>
        <span className="spacer" />
        <span className="badge badge-neutral" title={f.source === "rule" ? "Detected by a deterministic check" : "Detected by the judge"}>
          {f.source === "rule" ? "automatic check" : "judge"}
        </span>
      </div>
      <dl className="qa">
        <dt>What went wrong</dt>
        <dd>{f.what}</dd>
        <dt>Why it happened</dt>
        <dd>{f.why}</dd>
        <dt>
          <Quote size={13} /> Responsible instruction
        </dt>
        <dd>{f.instruction === "missing" ? <span className="muted">No instruction covers this case (missing)</span> : <code className="small">{f.instruction}</code>}</dd>
        <dt>
          <Lightbulb size={13} /> How to fix it
        </dt>
        <dd>{f.fix}</dd>
      </dl>
    </div>
  );
}

export function ResultDetail({ test, result }: { test?: TestCase; result: TestResult }) {
  return (
    <div className="stack fade-in" style={{ gap: 14 }}>
      {test && (
        <div className="grid g-2">
          <div>
            <div className="label">Input</div>
            <div className="mt-8">
              <OutputBlock text={test.input} />
            </div>
          </div>
          <div>
            <div className="label">Expected behaviour</div>
            <p className="text-2" style={{ margin: "8px 0 0" }}>
              {test.expectedBehavior}
            </p>
            {test.rationale && <p className="small muted mt-8">Why this test: {test.rationale}</p>}
          </div>
        </div>
      )}
      <div>
        <div className="row-between">
          <div className="label">Actual output{result.outputs.length > 1 ? ` (run 1 of ${result.outputs.length})` : ""}</div>
          <div className="row small muted">
            {formatMs(result.latencyMs)}
            {result.consistency !== null && <span>· consistency {(result.consistency * 100).toFixed(0)}%</span>}
          </div>
        </div>
        <div className="mt-8">{result.error ? <div className="banner banner-error">{result.error}</div> : <OutputBlock text={result.output} />}</div>
        {result.outputs.length > 1 && (
          <details className="mt-8">
            <summary className="small link">Show all {result.outputs.length} outputs</summary>
            <div className="stack mt-8" style={{ gap: 8 }}>
              {result.outputs.slice(1).map((o, i) => (
                <div key={i}>
                  <div className="tiny muted">Run {i + 2}</div>
                  <OutputBlock text={o} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
      {result.checks.length > 0 && (
        <div>
          <div className="label">Automatic checks</div>
          <ul className="checklist mt-8">
            {result.checks.map((c) => (
              <li key={c.id}>
                {c.passed ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="no" />}
                <span>
                  <b>{c.label}</b> <span className="muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.judge && (
        <div>
          <div className="label">
            Judge verdict <span className="badge badge-neutral">{result.judge.method === "analyst" ? "LLM judge" : "heuristic rules"}</span>
            <span className="badge badge-neutral">score {result.judge.score}</span>
          </div>
          <p className="text-2" style={{ margin: "8px 0 0" }}>
            {result.judge.reasoning}
          </p>
        </div>
      )}
      {result.failures.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="label">Detected failures ({result.failures.length})</div>
          {result.failures.map((f, i) => (
            <FailureCard key={i} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ResultsTable({ tests, results, runningIds }: { tests: TestCase[]; results: TestResult[]; runningIds?: Set<string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(results.map((r) => [r.testId, r]));
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th>ID</th>
            <th>Category</th>
            <th>Input</th>
            <th>Verdict</th>
            <th className="hide-mobile">Top severity</th>
            <th className="hide-mobile">Latency</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((t) => {
            const r = byId.get(t.id);
            const sev = r ? topSeverity(r) : null;
            const isOpen = open === t.id;
            return (
              <Fragment key={t.id}>
                <tr className={`clickable ${isOpen ? "selected" : ""}`} onClick={() => r && setOpen(isOpen ? null : t.id)}>
                  <td className="muted">{r ? isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null}</td>
                  <td className="mono small nowrap">{t.id}</td>
                  <td className="small nowrap">{CATEGORY_LABELS[t.category]}</td>
                  <td className="small" style={{ maxWidth: 420 }}>
                    <div className="truncate">{t.input || <span className="muted">(empty input)</span>}</div>
                  </td>
                  <td>{r ? <VerdictBadge verdict={r.verdict} /> : <VerdictBadge verdict={runningIds?.has(t.id) ? "running" : "pending"} />}</td>
                  <td className="hide-mobile">{sev ? <SeverityBadge severity={sev} /> : <span className="muted">—</span>}</td>
                  <td className="small muted hide-mobile nowrap">{r ? formatMs(r.latencyMs) : "—"}</td>
                </tr>
                {isOpen && r && (
                  <tr>
                    <td colSpan={7} style={{ background: "var(--panel-2)", padding: 18 }}>
                      <ResultDetail test={t} result={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
