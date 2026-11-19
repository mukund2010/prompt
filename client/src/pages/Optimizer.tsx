import { ArrowRight, FileDiff, GitCompareArrows, ListChecks, Play, RotateCcw, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDateTime, formatPct } from "../../../shared/format";
import { lintPrompt } from "../../../shared/lint";
import { latestFullRun } from "../../../shared/selectors";
import type { Weakness } from "../../../shared/types";
import { NeedsExperiment } from "../components/Layout";
import { Banner, Button, Card, CopyButton, EmptyState, ModeBadge, PageHead, SeverityBadge, Segmented } from "../components/ui";
import { DemoNotice, RunProgress } from "../components/workflow";
import { api } from "../lib/api";
import { diffLines } from "../lib/diff";
import { useAction, useApp } from "../lib/state";

export default function Optimizer() {
  return (
    <NeedsExperiment>
      <OptimizerInner />
    </NeedsExperiment>
  );
}

function WeaknessList({ items }: { items: Weakness[] }) {
  if (!items.length) return <p className="muted small" style={{ margin: 0 }}>No weaknesses detected.</p>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map((w) => (
        <div key={w.id} className={`fail-card ${w.severity}`} style={{ padding: "12px 14px" }}>
          <div className="row">
            <SeverityBadge severity={w.severity} />
            <b className="small">{w.title}</b>
            <span className="spacer" />
            <span className="badge badge-neutral">{w.source === "lint" ? "static analysis" : w.source === "failures" ? "from test failures" : "analyst"}</span>
          </div>
          {w.detail && <div className="small text-2 mt-8">{w.detail}</div>}
          {w.instruction && w.instruction !== "missing" && (
            <div className="small mt-8">
              <span className="muted">Instruction: </span>
              <code>{w.instruction.slice(0, 220)}</code>
            </div>
          )}
          <div className="small mt-8">
            <span className="muted">Fix: </span>
            {w.fix}
          </div>
        </div>
      ))}
    </div>
  );
}

function OptimizerInner() {
  const { active, setActive, isRunning, providers, confirm } = useApp();
  const exp = active!;
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const [sourceId, setSourceId] = useState(exp.versions.at(-1)!.id);
  const source = exp.versions.find((v) => v.id === sourceId) ?? exp.versions.at(-1)!;
  const sourceRun = exp.runs.filter((r) => r.versionId === source.id && r.status === "completed").at(-1);
  const draft = exp.draft;
  const [edited, setEdited] = useState(draft?.improvedPrompt ?? "");
  const [view, setView] = useState<"edit" | "diff">("edit");
  useEffect(() => setEdited(draft?.improvedPrompt ?? ""), [draft?.createdAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const lint = useMemo(() => lintPrompt({ ...exp.config, prompt: source.prompt }), [exp.config, source.prompt]);
  const draftSource = draft ? exp.versions.find((v) => v.id === draft.sourceVersionId) : undefined;
  const diff = useMemo(() => (draft ? diffLines(draftSource?.prompt ?? "", edited) : []), [draft, draftSource, edited]);
  const lastVersion = exp.versions.at(-1)!;
  const lastVersionRun = latestFullRun(exp, lastVersion.id);

  const optimize = async () => {
    if (draft && edited !== draft.improvedPrompt && !(await confirm({ title: "Discard edits?", message: "Generating a new draft replaces your unsaved edits.", confirmLabel: "Generate new draft" }))) return;
    const res = await run("opt", () => api.optimize(exp.id, source.id, sourceRun?.id), "Improved prompt generated. Review it, then save or retest.");
    if (res) setActive(res);
  };

  const save = async (andRun: boolean) => {
    if (edited.trim().length < 10) return;
    const res = await run("save", () => api.saveVersion(exp.id, { prompt: edited, fromDraft: true }), andRun ? undefined : (r) => `Saved as ${r.version.label}.`);
    if (!res) return;
    setActive(res.experiment);
    setSourceId(res.version.id);
    if (andRun) {
      const started = await run("retest", () => api.startRun(exp.id, res.version.id), `Retesting ${res.version.label} on the same ${exp.testCases.length} tests…`);
      if (started) setActive(await api.get(exp.id));
    }
  };

  const retestVersion = async (versionId: string) => {
    const started = await run("retest", () => api.startRun(exp.id, versionId), "Retest started on the identical test suite.");
    if (started) setActive(await api.get(exp.id));
  };

  const removeVersion = async (versionId: string, label: string) => {
    if (!(await confirm({ title: `Delete ${label}?`, message: "This deletes the version and all of its runs. This cannot be undone.", confirmLabel: "Delete version", danger: true }))) return;
    const res = await run("delv", () => api.deleteVersion(exp.id, versionId), `${label} deleted.`);
    if (res) {
      setActive(res);
      setSourceId(res.versions.at(-1)!.id);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <Sparkles size={13} /> Step 04 · Prompt optimisation
          </>
        }
        title="Prompt Optimizer"
        desc="Turns detected weaknesses and observed failures into a rewritten prompt that keeps your original intent, then retests it on the identical suite."
        actions={
          <>
            <select className="select" style={{ width: 230, height: 36, padding: "0 32px 0 12px" }} value={source.id} onChange={(e) => setSourceId(e.target.value)} aria-label="Source version">
              {exp.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Improve: {v.label}
                </option>
              ))}
            </select>
            <Button variant="primary" icon={<Wand2 size={15} />} loading={busy === "opt"} disabled={isRunning} onClick={optimize}>
              {draft ? "Regenerate" : "Generate improved prompt"}
            </Button>
          </>
        }
      />
      <RunProgress exp={exp} />

      {!sourceRun && (
        <Banner>
          {source.label} has not been executed yet, so the optimiser can only use static analysis. For failure-driven improvements, run the tests first in the{" "}
          <a className="link" onClick={() => navigate("/studio")}>
            Testing Studio
          </a>
          .
        </Banner>
      )}

      <div className="grid g-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <Card
            title={`Source prompt · ${source.label}`}
            sub={sourceRun ? `Last run ${formatDateTime(sourceRun.finishedAt)} · ${formatPct(sourceRun.summary.passRate)} pass rate` : "Not executed yet"}
            actions={<CopyButton text={source.prompt} />}
          >
            <pre className="pre tall">{source.prompt}</pre>
          </Card>
          <Card
            title={
              <span className="row">
                <ListChecks size={16} /> Detected weaknesses
              </span>
            }
            sub={draft ? `From the optimiser (${draft.method === "analyst" ? "analyst model" : "rule-based"}) and static analysis` : "Static analysis of the source prompt"}
          >
            <WeaknessList items={draft && draft.sourceVersionId === source.id ? draft.weaknesses : lint} />
          </Card>
        </div>

        <div className="stack">
          {!draft ? (
            <Card>
              <EmptyState
                icon={<Sparkles size={26} />}
                title="No improved draft yet"
                action={
                  <Button variant="primary" icon={<Wand2 size={15} />} loading={busy === "opt"} disabled={isRunning} onClick={optimize}>
                    Generate improved prompt
                  </Button>
                }
              >
                {providers?.settings.geminiOnlyGeneration
                  ? `Gemini-only generation is on: the improved prompt is written by Google Gemini (${providers.providers.find((p) => p.id === "gemini")?.model ?? "gemini"}) with your API key, using the static findings and the failures from the latest run.`
                  : providers?.settings.analyst === "demo"
                    ? "Demo mode uses a rule-based optimiser that restructures the prompt and adds the missing rules. Select an analyst model in Settings for a full rewrite."
                    : "The analyst model rewrites the prompt using the static findings and the failures from the latest run."}
              </EmptyState>
            </Card>
          ) : (
            <Card
              title={
                <span className="row">
                  Improved prompt <ModeBadge mode={draft.mode} />
                </span>
              }
              sub={`Draft from ${draftSource?.label ?? "?"} · ${draft.providerLabel} · ${formatDateTime(draft.createdAt)}`}
              actions={<Segmented value={view} onChange={setView} items={[{ id: "edit", label: "Edit" }, { id: "diff", label: "Diff" }]} />}
            >
              <div className="stack" style={{ gap: 12 }}>
                {draft.mode === "demo" && <DemoNotice show what="This draft was generated by the rule-based optimiser (no language model) and" />}
                {view === "edit" ? (
                  <div className="editor-wrap">
                    <div className="editor-bar">
                      <span className="mono">improved-prompt.txt</span>
                      <span className="spacer" />
                      {edited !== draft.improvedPrompt && <span className="badge badge-accent">edited</span>}
                      <span>{edited.trim().split(/\s+/).filter(Boolean).length} words</span>
                    </div>
                    <textarea className="textarea code-editor" style={{ minHeight: 380 }} value={edited} onChange={(e) => setEdited(e.target.value)} spellCheck={false} />
                  </div>
                ) : (
                  <div className="diff" aria-label="Line diff between source and improved prompt">
                    {diff.map((l, i) => (
                      <div key={i} className={l.kind === "same" ? "" : l.kind}>
                        {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                        {l.text || " "}
                      </div>
                    ))}
                  </div>
                )}
                <div className="row">
                  <CopyButton text={edited} size="lg" />
                  <Button size="lg" icon={<Save size={15} />} loading={busy === "save"} disabled={isRunning || edited.trim().length < 10} onClick={() => save(false)}>
                    Save version
                  </Button>
                  <Button variant="primary" size="lg" icon={<Play size={15} />} loading={busy === "retest"} disabled={isRunning || edited.trim().length < 10 || !exp.testCases.length} onClick={() => save(true)}>
                    Save &amp; retest
                  </Button>
                  <span className="spacer" />
                  {edited !== draft.improvedPrompt && (
                    <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={() => setEdited(draft.improvedPrompt)}>
                      Reset
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    onClick={async () => {
                      const res = await run("discard", () => api.discardDraft(exp.id), "Draft discarded.");
                      if (res) setActive(res);
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            </Card>
          )}
          {draft && draft.changes.length > 0 && (
            <Card
              title={
                <span className="row">
                  <FileDiff size={16} /> What changed
                </span>
              }
            >
              <ul className="checklist">
                {draft.changes.map((c, i) => (
                  <li key={i}>
                    <ArrowRight size={14} style={{ color: "var(--accent)" }} />
                    {c}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card title="Prompt versions" sub="Every version is kept. Retest any of them on the identical test suite." bodyClass="">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Origin</th>
                <th>Created</th>
                <th>Latest full run</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exp.versions.map((v) => {
                const r = latestFullRun(exp, v.id);
                return (
                  <tr key={v.id}>
                    <td>
                      <b>{v.label}</b>
                    </td>
                    <td className="small text-2">{v.origin === "optimized" ? `optimised (${v.optimization?.method ?? "?"})` : v.origin}</td>
                    <td className="small muted nowrap">{formatDateTime(v.createdAt)}</td>
                    <td className="small">
                      {r ? (
                        <span className="row">
                          <b>{r.summary.passRate}%</b> <ModeBadge mode={r.mode} />
                        </span>
                      ) : (
                        <span className="muted">not run</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 4, flexWrap: "nowrap" }}>
                        <CopyButton text={v.prompt} />
                        <Button size="sm" icon={<Play size={13} />} disabled={isRunning || !exp.testCases.length} onClick={() => retestVersion(v.id)}>
                          {r ? "Retest" : "Run"}
                        </Button>
                        {v.origin !== "original" && <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={`Delete ${v.label}`} disabled={isRunning} onClick={() => removeVersion(v.id, v.label)} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {lastVersion.origin !== "original" && lastVersionRun && (
        <Banner>
          <span className="row">
            {lastVersion.label} has been retested: <b>{lastVersionRun.summary.passRate}%</b> pass rate.
            <Button size="sm" variant="primary" icon={<GitCompareArrows size={14} />} onClick={() => navigate("/compare")}>
              Open comparison
            </Button>
          </span>
        </Banner>
      )}
    </div>
  );
}
