import { CheckCircle2, Cpu, Eye, EyeOff, FlaskConical, KeyRound, Lock, Plug, Save, Server, Settings as SettingsIcon, Sparkles, XCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";

const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
import type { ProviderId } from "../../../shared/types";
import { Banner, Button, Card, Field, ModeBadge, PageHead } from "../components/ui";
import { api } from "../lib/api";
import { useAction, useApp } from "../lib/state";

type TestResult = Awaited<ReturnType<typeof api.testProvider>>;
type ModelList = Awaited<ReturnType<typeof api.geminiModels>>;
const isOverloaded = (msg?: string) => Boolean(msg && /(503|overloaded|high demand|unavailable)/i.test(msg));

export default function Settings() {
  const { providers, refreshProviders, toast } = useApp();
  const { busy, run } = useAction();
  const [executor, setExecutor] = useState<ProviderId>("demo");
  const [analyst, setAnalyst] = useState<ProviderId>("demo");
  const [form, setForm] = useState({ anthropicKey: "", anthropicModel: "", openaiBaseUrl: "", openaiKey: "", openaiModel: "" });
  // Gemini is optional: nothing is switched on unless the user opts in.
  const [gemini, setGemini] = useState({ key: "", model: DEFAULT_GEMINI_MODEL, autoPro: true, useAsExecutor: false, geminiOnly: false, show: false });
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [geminiTest, setGeminiTest] = useState<TestResult | null>(null);
  const [geminiModels, setGeminiModels] = useState<ModelList | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});

  useEffect(() => {
    if (!providers) return;
    setExecutor(providers.settings.executor);
    setAnalyst(providers.settings.analyst);
    const a = providers.providers.find((p) => p.id === "anthropic");
    const g = providers.providers.find((p) => p.id === "gemini");
    const o = providers.providers.find((p) => p.id === "openai-compatible");
    setForm((f) => ({ ...f, anthropicModel: a?.model ?? "", openaiModel: o?.model === "(not set)" ? "" : o?.model ?? "" }));
    if (g?.model) setGemini((s) => ({ ...s, model: g.model }));
    if (providers.settings.geminiOnlyGeneration) setGemini((s) => ({ ...s, geminiOnly: true }));
    if (g?.configured || providers.settings.geminiOnlyGeneration) setGeminiOpen(true);
  }, [providers]);

  const geminiStatus = providers?.providers.find((p) => p.id === "gemini");
  const geminiKeyMissing = !gemini.key.trim() && !geminiStatus?.configured;
  const locked = Boolean(providers?.settings.geminiOnlyGeneration);

  /** Asks Google which models this key can use; returns the list (or undefined on error). */
  const loadGeminiModels = async () => {
    const list = await run("gemini-models", () => api.geminiModels());
    if (list) setGeminiModels(list);
    return list;
  };

  /** Switches to the best Pro model the key can use. */
  const switchToPro = async (list?: ModelList) => {
    const l = list ?? (await loadGeminiModels());
    if (!l) return undefined;
    if (!l.suggestedPro) {
      toast("No Gemini Pro model is available to this key. Pick one from the list instead.", "error");
      return undefined;
    }
    if (l.suggestedPro === l.current) return l.suggestedPro;
    const res = await run("gemini-model", () => api.updateProviders({ geminiModel: l.suggestedPro! }), `Switched to ${l.suggestedPro}.`);
    if (!res) return undefined;
    setGemini((s) => ({ ...s, model: l.suggestedPro! }));
    setGeminiModels({ ...l, current: l.suggestedPro });
    await refreshProviders();
    return l.suggestedPro;
  };

  const testGemini = async (role: "executor" | "analyst") => {
    setGeminiTest(null);
    const r = await run("gemini-test", () => api.testProvider(role));
    if (r) {
      setGeminiTest(r);
      toast(r.ok ? `Gemini replied in ${r.latencyMs} ms.` : `Gemini connection failed: ${r.error}`, r.ok ? "success" : "error");
    }
  };

  const connectGemini = async () => {
    const body: Record<string, string | boolean> = { geminiOnlyGeneration: gemini.geminiOnly };
    if (!gemini.autoPro) body.geminiModel = gemini.model.trim() || DEFAULT_GEMINI_MODEL;
    if (gemini.key.trim()) body.geminiKey = gemini.key.trim();
    if (gemini.useAsExecutor) body.executor = "gemini";
    if (gemini.geminiOnly) body.analyst = "gemini";
    setGeminiTest(null);
    const res = await run(
      "gemini",
      () => api.updateProviders(body),
      gemini.geminiOnly ? "Gemini connected. All new tests and prompts will be generated with your Gemini key." : "Gemini configuration saved.",
    );
    if (!res) return;
    setGemini((s) => ({ ...s, key: "", show: false }));
    await refreshProviders();
    if (gemini.autoPro) await switchToPro();
    else void loadGeminiModels();
    // Verify the key straight away when Gemini now serves a role.
    if (res.settings.executor === "gemini" || res.settings.analyst === "gemini") {
      await testGemini(res.settings.executor === "gemini" ? "executor" : "analyst");
    }
  };

  const chooseModel = async (model: string) => {
    const res = await run("gemini-model", () => api.updateProviders({ geminiModel: model }), `Gemini model set to ${model}.`);
    if (res) {
      setGemini((s) => ({ ...s, model, autoPro: false }));
      setGeminiModels((l) => (l ? { ...l, current: model } : l));
      setGeminiTest(null);
      await refreshProviders();
    }
  };

  const disconnectGemini = async () => {
    const body: Record<string, string | boolean> = { geminiKey: "", geminiOnlyGeneration: false };
    if (providers?.settings.executor === "gemini") body.executor = "demo";
    if (providers?.settings.analyst === "gemini") body.analyst = "demo";
    const res = await run("gemini-clear", () => api.updateProviders(body), "Gemini session key removed.");
    if (res) {
      setGeminiTest(null);
      await refreshProviders();
    }
  };

  const saveCredentials = async () => {
    const body: Record<string, string> = { anthropicModel: form.anthropicModel, openaiModel: form.openaiModel };
    if (form.anthropicKey) body.anthropicKey = form.anthropicKey;
    if (form.openaiKey) body.openaiKey = form.openaiKey;
    if (form.openaiBaseUrl) body.openaiBaseUrl = form.openaiBaseUrl;
    const res = await run("creds", () => api.updateProviders(body), "Provider configuration updated.");
    if (res) {
      setForm((f) => ({ ...f, anthropicKey: "", openaiKey: "" }));
      await refreshProviders();
    }
  };

  const saveRoles = async () => {
    const res = await run("roles", () => api.updateProviders({ executor, analyst }), "Provider roles saved.");
    if (res) await refreshProviders();
  };

  const testRole = async (role: "executor" | "analyst") => {
    setTests((t) => ({ ...t, [role]: null }));
    const r = await run(`test-${role}`, () => api.testProvider(role));
    if (r) {
      setTests((t) => ({ ...t, [role]: r }));
      toast(r.ok ? `${role} connection OK (${r.latencyMs} ms).` : `${role} connection failed: ${r.error}`, r.ok ? "success" : "error");
    }
  };

  if (!providers) return <div className="skeleton" style={{ height: 400 }} />;
  const rolesDirty = executor !== providers.settings.executor || analyst !== providers.settings.analyst;

  const RoleSelect = ({ role, value, set, desc }: { role: "executor" | "analyst"; value: ProviderId; set: (v: ProviderId) => void; desc: string }) => (
    <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
      <div className="row-between">
        <b style={{ textTransform: "capitalize" }}>{role}</b>
        <Button size="sm" icon={<Zap size={13} />} loading={busy === `test-${role}`} onClick={() => testRole(role)} disabled={rolesDirty}>
          Test connection
        </Button>
      </div>
      <p className="small muted" style={{ margin: "6px 0 12px" }}>
        {desc}
      </p>
      {role === "analyst" && locked && (
        <p className="tiny" style={{ margin: "-4px 0 8px", color: "var(--accent)" }}>
          <Lock size={11} /> Locked to Google Gemini by "Generate everything with this Gemini key only".
        </p>
      )}
      <select className="select" value={value} onChange={(e) => set(e.target.value as ProviderId)} aria-label={`${role} provider`} disabled={role === "analyst" && locked}>
        {providers.providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.configured}>
            {p.label}
            {p.configured ? "" : " (not configured)"}
          </option>
        ))}
      </select>
      {tests[role] && (
        <div className={`small mt-8 row ${tests[role]!.ok ? "ok" : "no"}`}>
          {tests[role]!.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {tests[role]!.ok ? `Replied "${tests[role]!.reply?.slice(0, 40)}" in ${tests[role]!.latencyMs} ms via ${tests[role]!.model}` : tests[role]!.error}
        </div>
      )}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        eyebrow={
          <>
            <SettingsIcon size={13} /> System
          </>
        }
        title="Settings & Providers"
        desc="Prompt Crash Lab is provider-independent. Choose which provider executes your prompt and which one analyses results."
        actions={<ModeBadge mode={providers.mode} />}
      />

      {providers.mode === "demo" && (
        <Banner kind="demo">
          <b>Demo mode.</b> The executor is the offline simulator, so new runs are labelled as demonstration data. Configure a provider below and select it as executor for real model execution.
        </Banner>
      )}

      <Card title={<span className="row"><Cpu size={16} /> Provider roles</span>} sub="Executor runs the prompt under test. Analyst generates tests, judges outputs and rewrites prompts. They can be different models.">
        <div className="grid g-2">
          <RoleSelect role="executor" value={executor} set={setExecutor} desc="Runs your prompt against each test input. Use the model your product will actually use." />
          <RoleSelect role="analyst" value={analyst} set={setAnalyst} desc="Generates test cases, judges responses and writes the improved prompt. A strong reasoning model works best." />
        </div>
        <div className="row mt-16">
          <Button variant="primary" icon={<Save size={15} />} loading={busy === "roles"} disabled={!rolesDirty} onClick={saveRoles}>
            Save roles
          </Button>
          {rolesDirty && <span className="small muted">Unsaved changes. Save before testing the connection.</span>}
        </div>
      </Card>

      {!geminiOpen ? (
        <div className="card card-pad row-between">
          <span className="row">
            <Sparkles size={17} />
            <span>
              <b>Google Gemini (optional)</b>
              <span className="small muted" style={{ display: "block" }}>
                The app works fully offline in demo mode. Add a Gemini API key only if you want real model runs.
              </span>
            </span>
          </span>
          <Button icon={<KeyRound size={15} />} onClick={() => setGeminiOpen(true)}>
            Add Gemini API key
          </Button>
        </div>
      ) : (
      <Card
        title={
          <span className="row">
            <Sparkles size={16} /> Google Gemini (optional)
            {geminiStatus?.configured ? <span className="badge badge-pass">Connected</span> : <span className="badge badge-neutral">Not connected</span>}
          </span>
        }
        sub="Optional. Paste a Gemini API key and choose what it should be used for. Nothing changes until you tick an option below. The key is held in server memory for this session only: it is never saved to disk or sent back to the browser."
        actions={
          !geminiStatus?.configured && !locked ? (
            <Button size="sm" variant="ghost" onClick={() => setGeminiOpen(false)}>
              Hide
            </Button>
          ) : undefined
        }
      >
        <div className="grid g-2">
          <Field label={<><KeyRound size={13} /> Gemini API key</>} hint={geminiStatus?.configured ? `A key is active (from ${geminiStatus.keySource === "env" ? ".env" : "this session"}). Leave blank to keep it.` : "Create a key in Google AI Studio."}>
            <div className="input-affix">
              <input
                className="input mono"
                type={gemini.show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={gemini.key}
                onChange={(e) => setGemini({ ...gemini, key: e.target.value })}
                placeholder={geminiStatus?.configured ? "•••••••• (key active, enter a new one to replace)" : "Paste your Gemini API key here (e.g. AIza…)"}
                aria-label="Gemini API key"
              />
              <button type="button" className="affix-btn" onClick={() => setGemini({ ...gemini, show: !gemini.show })} aria-label={gemini.show ? "Hide key" : "Show key"} title={gemini.show ? "Hide key" : "Show key"}>
                {gemini.show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </Field>
          <Field
            label="Model"
            hint={
              gemini.autoPro
                ? geminiStatus?.configured
                  ? `Auto: the newest Pro model your key can use. Currently ${geminiStatus.model}.`
                  : "Auto: the newest Pro model your key can use is picked when you connect."
                : "Type a model name or pick one from your key's model list."
            }
          >
            <input
              className="input mono"
              list="gemini-model-list"
              value={gemini.autoPro ? "Auto: best Gemini Pro model" : gemini.model}
              disabled={gemini.autoPro}
              onChange={(e) => setGemini({ ...gemini, model: e.target.value })}
              placeholder="e.g. a gemini-…-pro model"
              aria-label="Gemini model"
            />
            <datalist id="gemini-model-list">
              {geminiModels?.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <div className="stack mt-12" style={{ gap: 8 }}>
          <label className="row small" style={{ cursor: "pointer", gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={gemini.autoPro} onChange={(e) => setGemini({ ...gemini, autoPro: e.target.checked, model: geminiStatus?.model ?? gemini.model })} style={{ marginTop: 3 }} />
            <span>
              <b>Use the best Gemini Pro model available to my key.</b> The app asks Google which models your key can use and picks the newest Pro model.
            </span>
          </label>
          <label className="row small" style={{ cursor: "pointer", gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={gemini.geminiOnly} onChange={(e) => setGemini({ ...gemini, geminiOnly: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              <b>Generate everything with this Gemini key only.</b> Test cases, judging and improved prompts always use Gemini. If the key is missing, the app stops with an error instead of falling back to the built-in rule-based generator.
            </span>
          </label>
          <label className="row small" style={{ cursor: "pointer", gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
            <input type="checkbox" checked={gemini.useAsExecutor} onChange={(e) => setGemini({ ...gemini, useAsExecutor: e.target.checked })} style={{ marginTop: 3 }} />
            <span>Also run the prompts under test on Gemini (executor). This switches from demo mode to live.</span>
          </label>
        </div>
        {locked && (
          <Banner kind="info" icon={<Lock size={15} />}>
            <b>Gemini-only generation is on.</b> New test cases, judgements and improved prompts are produced with your Gemini key ({geminiStatus?.model}).
            {!geminiStatus?.configured && <> No key is active right now (for example after a server restart), so generation is paused until you paste the key again.</>}
          </Banner>
        )}
        <div className="row mt-16">
          <Button variant="primary" icon={<Plug size={15} />} loading={busy === "gemini" || busy === "gemini-test"} disabled={geminiKeyMissing} onClick={connectGemini}>
            Save &amp; connect
          </Button>
          {geminiStatus?.keySource === "session" && (
            <Button variant="danger" loading={busy === "gemini-clear"} onClick={disconnectGemini}>
              Remove session key
            </Button>
          )}
          {geminiStatus?.configured && (
            <>
              <Button icon={<Sparkles size={15} />} loading={busy === "gemini-model" || busy === "gemini-models"} onClick={() => switchToPro()}>
                Switch to best Pro model
              </Button>
              <Button variant="ghost" icon={<Zap size={15} />} loading={busy === "gemini-test"} onClick={() => testGemini(providers.settings.executor === "gemini" ? "executor" : "analyst")} disabled={providers.settings.executor !== "gemini" && providers.settings.analyst !== "gemini"}>
                Test connection
              </Button>
            </>
          )}
          {geminiKeyMissing && <span className="small muted">Enter an API key to connect.</span>}
        </div>
        {geminiTest && (
          <div className={`small mt-12 row ${geminiTest.ok ? "ok" : "no"}`} style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
            {geminiTest.ok ? <CheckCircle2 size={14} style={{ marginTop: 3, flex: "none" }} /> : <XCircle size={14} style={{ marginTop: 3, flex: "none" }} />}
            <span>{geminiTest.ok ? `Connected: replied "${geminiTest.reply?.slice(0, 40)}" in ${geminiTest.latencyMs} ms via ${geminiTest.model}` : geminiTest.error}</span>
          </div>
        )}
        {geminiTest && !geminiTest.ok && isOverloaded(geminiTest.error) && (
          <div className="mt-12">
            <Banner kind="info">
              <b>Google reports high demand for {geminiStatus?.model}.</b> This is on Google's side, not your key. The app already retried automatically. Switch to a less busy model, such as the best Pro model, or wait a minute and try again.
              <div className="row mt-8">
                <Button size="sm" variant="primary" icon={<Sparkles size={13} />} loading={busy === "gemini-model" || busy === "gemini-models"} onClick={async () => { if (await switchToPro()) await testGemini(providers.settings.executor === "gemini" ? "executor" : "analyst"); }}>
                  Switch to Pro and retest
                </Button>
              </div>
            </Banner>
          </div>
        )}
        {geminiModels && (
          <div className="mt-16">
            <div className="small muted" style={{ marginBottom: 8 }}>
              {geminiModels.models.length} models available to your key. Click one to use it.
            </div>
            <div className="chips">
              {[...geminiModels.models]
                .sort((a, b) => Number(b.id === geminiModels.suggestedPro) - Number(a.id === geminiModels.suggestedPro) || Number(/pro/i.test(b.id)) - Number(/pro/i.test(a.id)) || a.id.localeCompare(b.id))
                .slice(0, 24)
                .map((m) => (
                  <button key={m.id} type="button" className={`chip mono ${m.id === geminiModels.current ? "on" : ""}`} title={m.displayName} onClick={() => m.id !== geminiModels.current && chooseModel(m.id)}>
                    {m.id}
                    {m.id === geminiModels.suggestedPro && <span className="badge badge-accent" style={{ marginLeft: 2 }}>best Pro</span>}
                  </button>
                ))}
            </div>
          </div>
        )}
        {geminiStatus?.configured && !geminiModels && (
          <div className="mt-12">
            <a className="link small" onClick={() => loadGeminiModels()}>
              Show all models available to my key
            </a>
          </div>
        )}
      </Card>
      )}

      <div className="grid g-4">
        {providers.providers.map((p) => (
          <Card key={p.id}>
            <div className="stack" style={{ gap: 8 }}>
              <div className="row-between">
                <span className="row">
                  {p.id === "demo" ? <FlaskConical size={17} /> : p.id === "anthropic" ? <Plug size={17} /> : p.id === "gemini" ? <Sparkles size={17} /> : <Server size={17} />}
                  <b>{p.label}</b>
                </span>
                {p.configured ? <span className="badge badge-pass">Ready</span> : <span className="badge badge-error">Not configured</span>}
              </div>
              <div className="small text-2">{p.detail}</div>
              <div className="tiny muted">
                Model: <span className="mono">{p.model}</span>
                {p.keySource !== "none" && <> · key from {p.keySource === "env" ? ".env" : "this session"}</>}
              </div>
              <div className="row tiny">
                {providers.settings.executor === p.id && <span className="badge badge-accent">executor</span>}
                {providers.settings.analyst === p.id && <span className="badge badge-accent">analyst</span>}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card title={<span className="row"><KeyRound size={16} /> Other providers</span>} sub="Recommended: put keys in the server's .env file. Keys entered here are held in server memory for this session only. They are never written to disk or sent back to the browser.">
        <div className="grid g-2">
          <div className="stack" style={{ gap: 12 }}>
            <b>Anthropic Claude</b>
            <Field label="API key" hint="Leave blank to keep the current key.">
              <input className="input" type="password" autoComplete="off" value={form.anthropicKey} onChange={(e) => setForm({ ...form, anthropicKey: e.target.value })} placeholder="sk-ant-…" />
            </Field>
            <Field label="Model" hint="Default: claude-opus-5-5">
              <input className="input mono" value={form.anthropicModel} onChange={(e) => setForm({ ...form, anthropicModel: e.target.value })} />
            </Field>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <b>OpenAI-compatible endpoint</b>
            <Field label="Base URL" hint="e.g. http://localhost:11434/v1 (Ollama) or your provider's /v1 URL">
              <input className="input mono" value={form.openaiBaseUrl} onChange={(e) => setForm({ ...form, openaiBaseUrl: e.target.value })} placeholder="https://…/v1" />
            </Field>
            <div className="grid g-2">
              <Field label="API key" hint="Optional for local servers.">
                <input className="input" type="password" autoComplete="off" value={form.openaiKey} onChange={(e) => setForm({ ...form, openaiKey: e.target.value })} />
              </Field>
              <Field label="Model">
                <input className="input mono" value={form.openaiModel} onChange={(e) => setForm({ ...form, openaiModel: e.target.value })} placeholder="model name" />
              </Field>
            </div>
          </div>
        </div>
        <div className="row mt-16">
          <Button variant="primary" icon={<Save size={15} />} loading={busy === "creds"} onClick={saveCredentials}>
            Save configuration
          </Button>
        </div>
      </Card>

      <Card title="How results are labelled">
        <ul className="checklist">
          <li>
            <CheckCircle2 size={15} className="ok" />
            <span>
              <b>Live</b>: the executor is a real model. Outputs are genuine model responses.
            </span>
          </li>
          <li>
            <FlaskConical size={15} style={{ color: "var(--warn)" }} />
            <span>
              <b>Demo data</b>: the executor is the offline simulator. Outputs are generated by a deterministic program that imitates common LLM failure modes based on which safeguards your prompt contains. Useful for demonstrating the workflow, never as evidence of model behaviour.
            </span>
          </li>
          <li>
            <Cpu size={15} className="muted" />
            <span>
              Judging is done by the analyst model when one is selected, otherwise by transparent heuristic rules. Each verdict records which method produced it.
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
