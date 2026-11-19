import { AlertTriangle, Beaker, ClipboardList, Play, RefreshCw, Save, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { lintPrompt, lintScore } from "../../../shared/lint";
import { latestFullRun, originalVersion } from "../../../shared/selectors";
import { CATEGORY_LABELS, TEST_CATEGORIES, type ExperimentConfig, type OutputFormat, type TestCategory } from "../../../shared/types";
import { OutcomeMeter } from "../components/charts";
import { ResultsTable } from "../components/results";
import { Banner, Button, Card, Field, ModeBadge, PageHead, SeverityBadge, Segmented, TagInput } from "../components/ui";
import { DemoNotice, RunMeta, RunProgress, WorkflowStepper } from "../components/workflow";
import { api } from "../lib/api";
import { useAction, useApp } from "../lib/state";

const EMPTY: ExperimentConfig = {
  prompt: "",
  taskDescription: "",
  outputFormat: "free",
  formatDetails: "",
  constraints: { maxWords: null, minWords: null, mustInclude: [], mustNotInclude: [], requiredJsonKeys: [] },
  consistencyRuns: 1,
};

const EXAMPLES: Array<{ name: string; config: ExperimentConfig }> = [
  {
    name: "Support ticket triage (JSON)",
    config: {
      ...EMPTY,
      prompt: "Read the customer message and summarise it. Tell me how urgent it is and what category it belongs to. Be detailed but keep it short. Use JSON.",
      taskDescription: "Triage incoming customer support messages into a summary, urgency level and category for the support dashboard.",
      outputFormat: "json",
      formatDetails: 'Keys: "summary" (string), "urgency" (low|medium|high), "category" (billing|delivery|product|other).',
      constraints: { maxWords: 80, minWords: null, mustInclude: [], mustNotInclude: ["As an AI"], requiredJsonKeys: ["summary", "urgency", "category"] },
    },
  },
  {
    name: "Meeting notes to action items",
    config: {
      ...EMPTY,
      prompt: "You are a helpful assistant. Turn the meeting notes into action items. Try to include owners and dates if possible, etc.",
      taskDescription: "Convert raw meeting notes into a list of action items with owner and due date.",
      outputFormat: "bullets",
      formatDetails: "One action item per bullet: <action> | owner: <name or 'unassigned'> | due: <date or 'not set'>",
      constraints: { maxWords: 150, minWords: null, mustInclude: ["owner"], mustNotInclude: [], requiredJsonKeys: [] },
    },
  },
];

const FORMATS: Array<{ id: OutputFormat; label: string }> = [
  { id: "free", label: "Free text" },
  { id: "json", label: "JSON" },
  { id: "bullets", label: "Bullets" },
  { id: "markdown", label: "Markdown" },
  { id: "single-line", label: "Single line" },
  { id: "custom", label: "Custom" },
];

export default function Studio() {
  const { active, activeId, activeLoading, setActive, refreshList, providers, toast, confirm, isRunning } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = params.get("new") === "1" || !activeId;
  const { busy, run } = useAction();

  const [name, setName] = useState("");
  const [config, setConfig] = useState<ExperimentConfig>(EMPTY);
  const [count, setCount] = useState(12);
  const [categories, setCategories] = useState<TestCategory[]>([...TEST_CATEGORIES]);
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);

  // Load the active experiment into the form.
  useEffect(() => {
    if (isNew) {
      setName("");
      setConfig(EMPTY);
      setTouched(false);
      return;
    }
    if (active) {
      setName(active.name);
      setConfig(structuredClone(active.config));
    }
  }, [isNew, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lint = useMemo(() => (config.prompt.trim() ? lintPrompt(config) : []), [config]);
  const score = lintScore(lint);
  const promptError = touched && config.prompt.trim().length < 10 ? "Enter a prompt of at least 10 characters." : undefined;
  const words = config.prompt.trim() ? config.prompt.trim().split(/\s+/).length : 0;

  const set = <K extends keyof ExperimentConfig>(k: K, v: ExperimentConfig[K]) => setConfig((c) => ({ ...c, [k]: v }));
  const setC = <K extends keyof ExperimentConfig["constraints"]>(k: K, v: ExperimentConfig["constraints"][K]) => setConfig((c) => ({ ...c, constraints: { ...c.constraints, [k]: v } }));
  const dirty = Boolean(
    !isNew &&
      active &&
      (active.name !== name ||
        JSON.stringify({ ...active.config, prompt: "" }) !== JSON.stringify({ ...config, prompt: "" }) ||
        // An edited prompt is "saved" once any version holds it.
        !active.versions.some((v) => v.prompt === config.prompt)),
  );

  async function saveIfNeeded() {
    if (isNew || !active) {
      const exp = await api.create(name.trim() || undefined, config);
      setActive(exp);
      setParams({}, { replace: true });
      void refreshList();
      return exp;
    }
    if (dirty) {
      const { experiment, notice } = await api.update(active.id, { name: name.trim() || active.name, config });
      setActive(experiment);
      if (notice) toast(notice, "info");
      void refreshList();
      return experiment;
    }
    return active;
  }

  async function startTesting() {
    setTouched(true);
    if (config.prompt.trim().length < 10) return toast("Enter a prompt of at least 10 characters first.", "error");
    if (!categories.length) return toast("Select at least one test category.", "error");
    await run("start", async () => {
      setPhase("Saving experiment…");
      let exp = await saveIfNeeded();
      if (!exp.testCases.length) {
        setPhase(providers?.settings.analyst === "demo" ? "Generating rule-based test cases…" : "Generating test cases with the analyst model…");
        exp = (await api.generateTests(exp.id, { count, categories, replace: false })).experiment;
        setActive(exp);
      }
      setPhase("Starting execution…");
      const version = originalVersion(exp)!;
      // Run whichever version the edited prompt now lives in.
      const target = exp.versions.find((v) => v.prompt === config.prompt) ?? version;
      await api.startRun(exp.id, target.id);
      setActive(await api.get(exp.id));
      setPhase(null);
    });
    setPhase(null);
  }

  async function regenerate() {
    if (!active) return;
    if (active.testCases.length && !(await confirm({ title: "Replace test cases?", message: `This replaces all ${active.testCases.length} existing test cases. Previous runs remain in history but will no longer match the new suite.`, confirmLabel: "Replace tests", danger: true })))
      return;
    await run(
      "regen",
      async () => {
        const saved = await saveIfNeeded();
        const res = await api.generateTests(saved.id, { count, categories, replace: true });
        setActive(res.experiment);
        return res;
      },
      (r) => `Generated ${r.generated} test cases.`,
    );
  }

  const latest = active && !isNew ? active.runs.filter((r) => r.status !== "running").at(-1) : undefined;
  const origRun = active ? latestFullRun(active, originalVersion(active)?.id) : undefined;
  const shownRun = latest ?? origRun;

  if (!isNew && activeLoading) return <div className="skeleton" style={{ height: 480 }} />;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <Beaker size={13} /> Step 01 · Prompt submission
          </>
        }
        title={isNew ? "New crash test" : active?.name ?? "Testing Studio"}
        desc="Paste the prompt you want to break, describe what it should do, and set the output rules. Prompt Crash Lab generates adversarial tests, executes them and explains every failure."
        actions={
          <>
            {isNew && (
              <select className="select" style={{ width: 230, height: 36, padding: "0 32px 0 12px" }} value="" onChange={(e) => {
                const ex = EXAMPLES[Number(e.target.value)];
                if (ex) {
                  setConfig(structuredClone(ex.config));
                  setName(ex.name);
                }
              }} aria-label="Load an example prompt">
                <option value="">Load an example…</option>
                {EXAMPLES.map((e, i) => (
                  <option key={e.name} value={i}>{e.name}</option>
                ))}
              </select>
            )}
            {!isNew && dirty && (
              <Button icon={<Save size={15} />} loading={busy === "save"} onClick={() => run("save", saveIfNeeded, "Changes saved.")}>
                Save changes
              </Button>
            )}
            <Button variant="primary" size="lg" icon={<Play size={16} />} loading={busy === "start"} disabled={isRunning} onClick={startTesting}>
              {isNew || !active?.testCases.length ? "Start testing" : "Run tests again"}
            </Button>
          </>
        }
      />

      {!isNew && active && <WorkflowStepper exp={active} />}
      {phase && (
        <Banner>
          <span className="row">
            <span className="spinner" /> {phase}
          </span>
        </Banner>
      )}
      {providers?.mode === "demo" && (
        <Banner kind="demo">
          <b>Demo mode is active.</b> No AI provider is selected, so execution uses an offline simulator and results are labelled as demonstration data. Configure a real provider in <a className="link" onClick={() => navigate("/settings")}>Settings</a>.
        </Banner>
      )}

      <div className="grid g-main-side">
        <div className="stack">
          <Card title="Prompt under test" sub="Used as the system prompt. Include {{input}} to place the test input inside the prompt instead.">
            <div className="stack" style={{ gap: 14 }}>
              <Field label="Experiment name" hint="Optional. Defaults to the task description.">
                <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support triage v1" />
              </Field>
              <div className="field">
                <label htmlFor="prompt">Prompt</label>
                <div className="editor-wrap">
                  <div className="editor-bar">
                    <div className="editor-dots">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="mono">prompt.txt</span>
                    <span className="spacer" />
                    <span>
                      {words} words · {config.prompt.length.toLocaleString("en-IN")} chars
                    </span>
                  </div>
                  <textarea
                    id="prompt"
                    className={`textarea code-editor ${promptError ? "invalid" : ""}`}
                    value={config.prompt}
                    onChange={(e) => set("prompt", e.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder={"You are a support assistant. Summarise the customer's message…"}
                    spellCheck={false}
                  />
                </div>
                {promptError && <div className="error-text">{promptError}</div>}
              </div>
              <Field label="Intended task" hint="What should this prompt achieve? The test generator and judge use this to define correct behaviour.">
                <textarea className="textarea" rows={3} value={config.taskDescription} onChange={(e) => set("taskDescription", e.target.value)} placeholder="Triage customer messages for the support dashboard…" />
              </Field>
            </div>
          </Card>

          <Card title="Expected output" sub="These rules are checked automatically on every response.">
            <div className="stack" style={{ gap: 14 }}>
              <Field label="Output format">
                <Segmented value={config.outputFormat} onChange={(v) => set("outputFormat", v)} items={FORMATS} />
              </Field>
              <Field label="Format details" hint="Describe the structure, schema or example output (optional).">
                <textarea className="textarea" rows={2} value={config.formatDetails} onChange={(e) => set("formatDetails", e.target.value)} placeholder='e.g. Keys: "summary", "urgency" (low|medium|high)' />
              </Field>
              {config.outputFormat === "json" && (
                <Field label="Required JSON keys" hint="Press Enter after each key.">
                  <TagInput value={config.constraints.requiredJsonKeys} onChange={(v) => setC("requiredJsonKeys", v)} placeholder="summary, urgency…" />
                </Field>
              )}
              <div className="grid g-3">
                <Field label="Max words">
                  <input className="input" type="number" min={1} value={config.constraints.maxWords ?? ""} onChange={(e) => setC("maxWords", e.target.value ? Number(e.target.value) : null)} placeholder="none" />
                </Field>
                <Field label="Min words">
                  <input className="input" type="number" min={1} value={config.constraints.minWords ?? ""} onChange={(e) => setC("minWords", e.target.value ? Number(e.target.value) : null)} placeholder="none" />
                </Field>
                <Field label="Consistency runs" hint="Executions per test">
                  <select className="select" value={config.consistencyRuns} onChange={(e) => set("consistencyRuns", Number(e.target.value))}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? "1 (off)" : `${n}×`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid g-2">
                <Field label="Must include" hint="Text every response must contain.">
                  <TagInput value={config.constraints.mustInclude} onChange={(v) => setC("mustInclude", v)} placeholder="Add a phrase…" />
                </Field>
                <Field label="Must not include" hint="Text that counts as a failure.">
                  <TagInput value={config.constraints.mustNotInclude} onChange={(v) => setC("mustNotInclude", v)} placeholder="Add a phrase…" />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card
            title={
              <span className="row">
                <ShieldCheck size={16} /> Static prompt analysis
              </span>
            }
            sub="Instant, deterministic lint: runs before any model call."
          >
            {!config.prompt.trim() ? (
              <p className="muted small" style={{ margin: 0 }}>Start typing a prompt to see structural weaknesses.</p>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                <div className="row-between">
                  <div>
                    <div className="small muted">Structural robustness</div>
                    <div className="stat-value accent" style={{ marginTop: 2 }}>
                      {score}
                      <span className="small muted">/100</span>
                    </div>
                  </div>
                  <span className="badge badge-neutral">{lint.length} finding{lint.length === 1 ? "" : "s"}</span>
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>Heuristic indicator from lint rules only. It is not a test result.</p>
                <div className="stack" style={{ gap: 8 }}>
                  {lint.slice(0, 6).map((w) => (
                    <div key={w.id} className={`fail-card ${w.severity}`} style={{ padding: "10px 12px" }}>
                      <div className="row">
                        <SeverityBadge severity={w.severity} />
                        <b className="small">{w.title}</b>
                      </div>
                      <div className="small text-2 mt-8">{w.fix}</div>
                    </div>
                  ))}
                  {lint.length === 0 && (
                    <div className="row small ok">
                      <ShieldCheck size={15} /> No structural issues detected. Run the tests to find behavioural ones.
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>

          <Card
            title={
              <span className="row">
                <Wand2 size={16} /> Test generation
              </span>
            }
            sub={providers?.settings.analyst === "demo" ? "Rule-based generator (no analyst model selected)" : `Analyst model: ${providers?.providers.find((p) => p.id === providers.settings.analyst)?.model ?? "…"}`}
          >
            <div className="stack" style={{ gap: 14 }}>
              <Field label={`Number of test cases: ${count}`}>
                <input type="range" min={4} max={40} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ accentColor: "var(--accent)" }} />
              </Field>
              <Field label="Categories">
                <div className="chips">
                  {TEST_CATEGORIES.map((c) => (
                    <button key={c} type="button" className={`chip ${categories.includes(c) ? "on" : ""}`} onClick={() => setCategories((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
                      {CATEGORY_LABELS[c]}
                    </button>
                  ))}
                </div>
              </Field>
              {!isNew && active && (
                <div className="row">
                  <Button icon={<RefreshCw size={14} />} size="sm" loading={busy === "regen"} disabled={isRunning} onClick={regenerate}>
                    {active.testCases.length ? "Regenerate tests" : "Generate tests"}
                  </Button>
                  <Button icon={<ClipboardList size={14} />} size="sm" variant="ghost" onClick={() => navigate("/tests")}>
                    Open Test Lab ({active.testCases.length})
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {!isNew && active && <RunProgress exp={active} />}

      {!isNew && active && shownRun && (
        <Card
          title="Execution results"
          sub={<RunMeta run={shownRun} exp={active} />}
          bodyClass=""
          actions={
            <>
              <Button size="sm" icon={<AlertTriangle size={14} />} onClick={() => navigate("/failures")}>
                Analyse failures
              </Button>
              <Button size="sm" variant="primary" icon={<Sparkles size={14} />} onClick={() => navigate("/optimizer")}>
                Optimise prompt
              </Button>
            </>
          }
        >
          <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="stack" style={{ gap: 12 }}>
              <DemoNotice show={shownRun.mode === "demo"} />
              {shownRun.status === "failed" && <Banner kind="error">{shownRun.error ?? "The run failed."}</Banner>}
              <div className="row-between">
                <div className="row">
                  <span className="stat-value" style={{ fontSize: 26, marginTop: 0 }}>
                    {shownRun.summary.passRate}%
                  </span>
                  <span className="muted small">pass rate · {shownRun.summary.completed} tests</span>
                  <ModeBadge mode={shownRun.mode} />
                </div>
              </div>
              <OutcomeMeter passed={shownRun.summary.passed} failed={shownRun.summary.failed} errored={shownRun.summary.errored} />
            </div>
          </div>
          <ResultsTable tests={active.testCases.filter((t) => shownRun.testIds.includes(t.id))} results={shownRun.results} />
        </Card>
      )}

      {!isNew && active && !shownRun && !isRunning && active.testCases.length > 0 && (
        <Card>
          <div className="row-between">
            <span className="text-2">
              {active.testCases.length} test cases are ready. Click <b>Run tests again</b> to execute them against the prompt.
            </span>
            <Button variant="primary" icon={<Play size={15} />} loading={busy === "start"} onClick={startTesting}>
              Execute now
            </Button>
          </div>
        </Card>
      )}

      {isNew && (
        <p className="small muted" style={{ textAlign: "center" }}>
          Clicking <b>Start testing</b> saves the experiment, generates {count} test cases and executes them. Takes seconds in demo mode, longer with a real model.
        </p>
      )}
    </div>
  );
}
