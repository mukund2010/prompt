import { Check, FlaskConical, Square } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { formatMs } from "../../../shared/format";
import { latestFullRun, originalVersion, versionLabel } from "../../../shared/selectors";
import type { Experiment, Run } from "../../../shared/types";
import { api } from "../lib/api";
import { useApp } from "../lib/state";
import { Banner, Button, Gyro, ModeBadge, Progress } from "./ui";

export function workflowSteps(e: Experiment) {
  const orig = originalVersion(e);
  const baseRun = latestFullRun(e, orig?.id);
  const improved = e.versions.filter((v) => v.origin !== "original");
  const improvedRun = improved.some((v) => latestFullRun(e, v.id));
  return [
    { key: "submit", label: "Submit", done: true, to: "/studio" },
    { key: "tests", label: "Generate tests", done: e.testCases.length > 0, to: "/tests" },
    { key: "execute", label: "Execute", done: Boolean(baseRun), to: "/studio" },
    { key: "detect", label: "Detect failures", done: Boolean(baseRun), to: "/failures" },
    { key: "optimize", label: "Optimise", done: improved.length > 0, to: "/optimizer" },
    { key: "retest", label: "Retest", done: improvedRun, to: "/optimizer" },
    { key: "compare", label: "Compare", done: improvedRun && Boolean(baseRun), to: "/compare" },
  ];
}

export function WorkflowStepper({ exp }: { exp: Experiment }) {
  const navigate = useNavigate();
  const steps = workflowSteps(exp);
  const currentIdx = steps.findIndex((s) => !s.done);
  return (
    <div className="stepper" aria-label="Workflow progress">
      {steps.map((s, i) => (
        <button key={s.key} className={`step ${s.done ? "done" : i === currentIdx ? "current" : ""}`} style={{ cursor: "pointer" }} onClick={() => navigate(s.to)}>
          <i>{s.done ? <Check size={12} /> : i + 1}</i>
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** Live progress for the experiment's in-flight run (or nothing). */
export function RunProgress({ exp }: { exp: Experiment }) {
  const { toast } = useApp();
  const run = exp.runs.find((r) => r.status === "running" || r.status === "queued");
  if (!run) return null;
  const pct = (run.summary.completed / Math.max(1, run.summary.total)) * 100;
  return (
    <div className="card card-pad fade-in run-live">
      <div className="row-between">
        <div className="row">
          <Gyro />
          <b>
            Running {versionLabel(exp, run.versionId)} on {run.summary.total} test{run.summary.total === 1 ? "" : "s"}
          </b>
          <ModeBadge mode={run.mode} />
        </div>
        <Button
          size="sm"
          variant="danger"
          icon={<Square size={12} />}
          onClick={async () => {
            try {
              await api.cancelRun(exp.id, run.id);
              toast("Cancelling after in-flight tests finish…", "info");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        >
          Cancel
        </Button>
      </div>
      <div className="mt-12">
        <Progress value={pct} active />
      </div>
      <div className="row mt-8 small text-2">
        <span>
          {run.summary.completed}/{run.summary.total} complete
        </span>
        <span className="ok">{run.summary.passed} passed</span>
        <span className="no">{run.summary.failed} failed</span>
        {run.summary.errored > 0 && <span>{run.summary.errored} errors</span>}
        <span className="spacer" />
        <span className="muted">
          Executor {run.executor.provider}/{run.executor.model} · Judge {run.analyst.provider}
        </span>
      </div>
    </div>
  );
}

export function RunMeta({ run, exp }: { run: Run; exp: Experiment }) {
  return (
    <div className="row small text-2">
      <ModeBadge mode={run.mode} />
      <span>{versionLabel(exp, run.versionId)}</span>
      <span className="muted">·</span>
      <span>
        {run.executor.provider}/{run.executor.model}
      </span>
      <span className="muted">·</span>
      <span>judge: {run.analyst.provider === "demo" ? "heuristic rules" : `${run.analyst.provider}/${run.analyst.model}`}</span>
      <span className="muted">·</span>
      <span>avg {formatMs(run.summary.avgLatencyMs)}</span>
      {run.scope === "partial" && <span className="badge badge-neutral">partial run</span>}
    </div>
  );
}

/** Persistent notice whenever demo data is on screen. */
export function DemoNotice({ show, what = "These results" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <Banner kind="demo" icon={<FlaskConical size={16} />}>
      <b>Demonstration data.</b> {what} were produced in demo mode by a deterministic simulator and rule-based evaluators, not by a real language model. Connect a provider in{" "}
      <Link className="link" to="/settings">
        Settings
      </Link>{" "}
      for real execution.
    </Banner>
  );
}
