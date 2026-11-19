import { Edit3, Play, Plus, Search, TestTubes, Trash2, Wand2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { CATEGORY_LABELS, TEST_CATEGORIES, type Experiment, type TestCase, type TestCategory, type TestResult } from "../../../shared/types";
import { NeedsExperiment } from "../components/Layout";
import { ResultDetail } from "../components/results";
import { Button, Card, EmptyState, Field, Modal, ModeBadge, PageHead, VerdictBadge } from "../components/ui";
import { DemoNotice, RunProgress } from "../components/workflow";
import { api, type TestInput } from "../lib/api";
import { useAction, useApp } from "../lib/state";

const BLANK: TestInput = { input: "", category: "normal", expectedBehavior: "", rationale: "" };

/** Most recent result per test for a version, across full and partial runs. */
function latestResults(exp: Experiment, versionId: string): Map<string, { result: TestResult; mode: string }> {
  const map = new Map<string, { result: TestResult; mode: string }>();
  for (const run of exp.runs.filter((r) => r.versionId === versionId)) for (const r of run.results) map.set(r.testId, { result: r, mode: run.mode });
  return map;
}

export default function TestLab() {
  return (
    <NeedsExperiment>
      <TestLabInner />
    </NeedsExperiment>
  );
}

function TestLabInner() {
  const { active, setActive, isRunning, confirm, providers } = useApp();
  const exp = active!;
  const { busy, run } = useAction();
  const [versionId, setVersionId] = useState(exp.versions[0].id);
  const [filter, setFilter] = useState<TestCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; data: TestInput } | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({ count: 8, categories: [...TEST_CATEGORIES] as TestCategory[], replace: false });

  const version = exp.versions.find((v) => v.id === versionId) ?? exp.versions[0];
  const results = useMemo(() => latestResults(exp, version.id), [exp, version.id]);
  const running = exp.runs.find((r) => r.status === "running");
  const runningIds = new Set(running && running.versionId === version.id ? running.testIds.filter((id) => !running.results.some((r) => r.testId === id)) : []);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of exp.testCases) c[t.category] = (c[t.category] ?? 0) + 1;
    return c;
  }, [exp.testCases]);
  const visible = exp.testCases.filter((t) => (filter === "all" || t.category === filter) && (!query || `${t.id} ${t.input} ${t.expectedBehavior}`.toLowerCase().includes(query.toLowerCase())));
  const showDemo = [...results.values()].some((r) => r.mode === "demo");

  const startRun = (ids?: string[]) =>
    run("run", async () => {
      await api.startRun(exp.id, version.id, ids);
      setActive(await api.get(exp.id));
      setSelected(new Set());
    });

  const saveTest = async () => {
    if (!editing) return;
    if (editing.data.expectedBehavior.trim().length < 3) return;
    const res = await run(
      "save",
      () => (editing.id ? api.updateTest(exp.id, editing.id, editing.data) : api.addTest(exp.id, editing.data)),
      editing.id ? "Test case updated." : "Test case added.",
    );
    if (res) {
      setActive(res);
      setEditing(null);
    }
  };

  const remove = async (t: TestCase) => {
    if (!(await confirm({ title: `Delete ${t.id}?`, message: "This test case will be removed from the suite. Past run results remain in history.", confirmLabel: "Delete", danger: true }))) return;
    const res = await run("del", () => api.deleteTest(exp.id, t.id), `${t.id} deleted.`);
    if (res) setActive(res);
  };

  const generate = async () => {
    const res = await run("gen", () => api.generateTests(exp.id, gen), (r) => `Generated ${r.generated} test cases.`);
    if (res) {
      setActive(res.experiment);
      setGenOpen(false);
    }
  };

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <TestTubes size={13} /> Step 02 · Test case laboratory
          </>
        }
        title="Test Case Lab"
        desc="Inspect, edit and extend the generated test suite. Run the whole suite or individual tests against any prompt version."
        actions={
          <>
            <Button icon={<Wand2 size={15} />} onClick={() => setGenOpen(true)} disabled={isRunning}>
              Generate more
            </Button>
            <Button icon={<Plus size={15} />} onClick={() => setEditing({ id: null, data: { ...BLANK } })} disabled={isRunning}>
              Add test
            </Button>
            <Button variant="primary" icon={<Play size={15} />} loading={busy === "run"} disabled={isRunning || !exp.testCases.length} onClick={() => startRun(selected.size ? [...selected] : undefined)}>
              {selected.size ? `Run ${selected.size} selected` : "Run all tests"}
            </Button>
          </>
        }
      />

      {exp.testGeneration && (
        <div className="row small text-2">
          Suite generated by <b>{exp.testGeneration.providerLabel}</b>
          <ModeBadge mode={exp.testGeneration.mode} />
          {exp.testGeneration.method === "rule-based" && <span className="muted">(template-based, generic to any task)</span>}
        </div>
      )}
      <RunProgress exp={exp} />
      <DemoNotice show={showDemo} what="Results shown in this table" />

      {exp.testCases.length === 0 ? (
        <Card>
          <EmptyState
            icon={<TestTubes size={26} />}
            title="No test cases yet"
            action={
              <>
                <Button variant="primary" icon={<Wand2 size={15} />} onClick={() => setGenOpen(true)}>
                  Generate test cases
                </Button>
                <Button icon={<Plus size={15} />} onClick={() => setEditing({ id: null, data: { ...BLANK } })}>
                  Write one manually
                </Button>
              </>
            }
          >
            Generate a diverse suite automatically ({providers?.settings.analyst === "demo" ? "rule-based in demo mode" : "using the analyst model"}) or write your own.
          </EmptyState>
        </Card>
      ) : (
        <Card bodyClass="">
          <div className="card-body row-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="chips">
              <button className={`chip ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
                All <span className="count">{exp.testCases.length}</span>
              </button>
              {TEST_CATEGORIES.filter((c) => counts[c]).map((c) => (
                <button key={c} className={`chip ${filter === c ? "on" : ""}`} onClick={() => setFilter(c)}>
                  {CATEGORY_LABELS[c]} <span className="count">{counts[c]}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <div style={{ position: "relative" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--muted)" }} />
                <input className="input" style={{ paddingLeft: 30, width: 200, height: 36 }} placeholder="Search tests…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <select className="select" style={{ width: 210, height: 36, padding: "0 32px 0 12px" }} value={version.id} onChange={(e) => setVersionId(e.target.value)} aria-label="Prompt version">
                {exp.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Run against: {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={visible.length > 0 && visible.every((t) => selected.has(t.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((t) => t.id)) : new Set())}
                    />
                  </th>
                  <th>ID</th>
                  <th>Category</th>
                  <th>Input</th>
                  <th className="hide-mobile">Expected behaviour</th>
                  <th>Last result</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const r = results.get(t.id);
                  const isOpen = open === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr className={isOpen ? "selected" : ""}>
                        <td>
                          <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.id}`} />
                        </td>
                        <td className="mono small nowrap">
                          {t.id}
                          {t.edited && <div className="tiny muted">edited</div>}
                          {t.source === "manual" && <div className="tiny muted">manual</div>}
                        </td>
                        <td className="small nowrap">{CATEGORY_LABELS[t.category]}</td>
                        <td className="small clickable" style={{ maxWidth: 320, cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : t.id)}>
                          <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.input || <span className="muted">(empty input)</span>}</div>
                        </td>
                        <td className="small text-2 hide-mobile" style={{ maxWidth: 320 }}>
                          <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.expectedBehavior}</div>
                        </td>
                        <td className="nowrap" style={{ cursor: r ? "pointer" : undefined }} onClick={() => r && setOpen(isOpen ? null : t.id)}>
                          <VerdictBadge verdict={runningIds.has(t.id) ? "running" : r ? r.result.verdict : "pending"} />
                        </td>
                        <td>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 4, flexWrap: "nowrap" }}>
                            <Button size="sm" variant="ghost" icon={<Play size={14} />} title="Run this test" aria-label={`Run ${t.id}`} disabled={isRunning} onClick={() => startRun([t.id])} />
                            <Button size="sm" variant="ghost" icon={<Edit3 size={14} />} title="Edit" aria-label={`Edit ${t.id}`} disabled={isRunning} onClick={() => setEditing({ id: t.id, data: { input: t.input, category: t.category, expectedBehavior: t.expectedBehavior, rationale: t.rationale } })} />
                            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} title="Delete" aria-label={`Delete ${t.id}`} disabled={isRunning} onClick={() => remove(t)} />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--panel-2)", padding: 18 }}>
                            {r ? (
                              <ResultDetail test={t} result={r.result} />
                            ) : (
                              <div className="stack" style={{ gap: 10 }}>
                                <div className="label">Input</div>
                                <pre className="pre">{t.input || "(empty)"}</pre>
                                <div className="label">Expected behaviour</div>
                                <div className="text-2">{t.expectedBehavior}</div>
                                <div className="small muted">Why: {t.rationale || "—"}</div>
                                <div className="small muted">Not yet executed against {version.label}.</div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 28 }}>
                      No tests match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        wide
        title={editing?.id ? `Edit ${editing.id}` : "Add test case"}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy === "save"} disabled={!editing || editing.data.expectedBehavior.trim().length < 3} onClick={saveTest}>
              {editing?.id ? "Save changes" : "Add test"}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="stack" style={{ gap: 14, color: "var(--text)" }}>
            <Field label="Category">
              <select className="select" value={editing.data.category} onChange={(e) => setEditing({ ...editing, data: { ...editing.data, category: e.target.value as TestCategory } })}>
                {TEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Input" hint="Leave empty to test empty input.">
              <textarea className="textarea code-editor" style={{ minHeight: 140 }} value={editing.data.input} onChange={(e) => setEditing({ ...editing, data: { ...editing.data, input: e.target.value } })} />
            </Field>
            <Field label="Expected behaviour" error={editing.data.expectedBehavior.trim().length < 3 ? "Required: describe what a correct response does." : undefined}>
              <textarea className="textarea" rows={3} value={editing.data.expectedBehavior} onChange={(e) => setEditing({ ...editing, data: { ...editing.data, expectedBehavior: e.target.value } })} />
            </Field>
            <Field label="Reason for testing">
              <input className="input" value={editing.data.rationale} onChange={(e) => setEditing({ ...editing, data: { ...editing.data, rationale: e.target.value } })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate test cases"
        footer={
          <>
            <Button onClick={() => setGenOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={<Wand2 size={15} />} loading={busy === "gen"} disabled={!gen.categories.length} onClick={generate}>
              Generate {gen.count}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 14, color: "var(--text)" }}>
          <Field label={`How many: ${gen.count}`}>
            <input type="range" min={1} max={40} value={gen.count} onChange={(e) => setGen({ ...gen, count: Number(e.target.value) })} style={{ accentColor: "var(--accent)" }} />
          </Field>
          <Field label="Categories">
            <div className="chips">
              {TEST_CATEGORIES.map((c) => (
                <button key={c} type="button" className={`chip ${gen.categories.includes(c) ? "on" : ""}`} onClick={() => setGen({ ...gen, categories: gen.categories.includes(c) ? gen.categories.filter((x) => x !== c) : [...gen.categories, c] })}>
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </Field>
          <label className="row small">
            <input type="checkbox" checked={gen.replace} onChange={(e) => setGen({ ...gen, replace: e.target.checked })} /> Replace the existing {exp.testCases.length} tests instead of appending
          </label>
          <p className="small muted" style={{ margin: 0 }}>
            {providers?.settings.analyst === "demo" ? "Demo mode: tests come from a rule-based template library (generic, not tailored to your prompt)." : "Tests are written by the analyst model, tailored to your prompt and task."}
          </p>
        </div>
      </Modal>
    </div>
  );
}
