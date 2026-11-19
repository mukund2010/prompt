# Prompt Crash Lab: Break Your Own AI

> *Don't trust your prompt. Crash it, analyse it, fix it, and test it again.*

Prompt Crash Lab is a full-stack web application for testing, debugging and optimising LLM prompts. You submit a prompt, and the app:

**SUBMIT → GENERATE TESTS → EXECUTE → DETECT FAILURES → ANALYSE → OPTIMISE → RETEST → COMPARE → REPORT**

1. generates a diverse, adversarial test suite (normal, ambiguous, conflicting, unexpected, invalid, edge, long and instruction-injection inputs)
2. executes the prompt against every test through a provider-independent execution layer
3. evaluates each output with deterministic checks plus a judge, and explains every failure (*what* went wrong, *why*, *which instruction* caused it, *how to fix it*) with a severity level
4. rewrites the prompt to fix the observed failures while keeping the original intent
5. retests the new version on the **identical** suite and criteria, and shows the measured difference
6. exports a complete report (HTML, Markdown or JSON)

It runs fully offline in a clearly labelled **demo mode**, and with real models when a provider is configured.

---

## Quick start

Requirements: **Node.js 20+** (tested on Node 22.16) and npm.

```bash
npm install
cp .env.example .env      # optional: add provider keys (see Configuration)
npm run dev               # API on :8787, UI on http://localhost:5173
```

Open **http://localhost:5173**, click **New experiment**, choose **Load an example…** and press **Start testing**.

Production build (single server serving API and UI):

```bash
npm run build
npm start                 # http://localhost:8787
```

| Script | Purpose |
|---|---|
| `npm run dev` | API (tsx watch) and Vite dev server together |
| `npm run build` | Build the React client into `dist/` |
| `npm start` | Serve API and built client on `PORT` (default 8787) |
| `npm test` | Run the automated test suite (Vitest) |
| `npm run typecheck` | TypeScript strict type check of client, server, shared code and tests |

## Configuration

All configuration is in `.env` (copy `.env.example`). **Never commit `.env`**; it is git-ignored.

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Anthropic Claude provider |
| `ANTHROPIC_MODEL` | Default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | `low`/`medium`/`high`/`xhigh`/`max` (default `medium`) |
| `GEMINI_API_KEY` | Enables the Google Gemini provider (native `generateContent` API) |
| `GEMINI_MODEL` | Default `gemini-4-hydrogen` |
| `GEMINI_ONLY_GENERATION` | `true` locks test generation, judging and prompt optimisation to the Gemini key (no rule-based fallback) |
| `GEMINI_BASE_URL` | Optional API base override (default `https://generativelanguage.googleapis.com/v1beta`) |
| `OPENAI_COMPAT_BASE_URL` | Any OpenAI-style `/v1` endpoint: OpenAI, OpenRouter, Groq, LM Studio, Ollama (`http://localhost:11434/v1`) … |
| `OPENAI_COMPAT_API_KEY` | Key for that endpoint (optional for local servers) |
| `OPENAI_COMPAT_MODEL` | Model name for that endpoint |
| `DEFAULT_EXECUTOR` / `DEFAULT_ANALYST` | `anthropic`, `gemini`, `openai-compatible` or `demo` |
| `PORT` | API port (default 8787) |
| `DATA_FILE` | Experiment store (default `data/experiments.json`) |

Providers can also be connected at runtime in **Settings & Providers**. Keys entered there are held **in server memory only**. They are never written to disk and never returned to the browser.

**Using Gemini from the browser (optional):** the app runs in offline demo mode by default and never calls Gemini unless you opt in.
1. Open **Settings & Providers** and click **Add Gemini API key**.
2. Paste your API key. By default **Use the best Gemini Pro model available to my key** is ticked: the app asks Google which models your key can use and picks the newest Pro model. Untick it to type or pick a model yourself (fallback default `gemini-4-hydrogen`). If Google reports *high demand* (503), the app retries automatically. If it still fails, use **Switch to Pro and retest** or pick another model from the list.
3. Optionally tick **Generate everything with this Gemini key only** (off by default). With it on:
   - test cases, judging and improved prompts are always produced by Gemini;
   - the analyst role is locked to Gemini;
   - if no key is active, generation stops with a clear error instead of falling back to the rule-based generator.
4. Optionally tick **Also run the prompts under test on Gemini** to use it as the executor too (live mode).
5. Click **Save & connect**. The app runs a connection test straight away.
6. A key entered this way lasts until the server restarts. The lock persists, so after a restart generation pauses until you paste the key again. To avoid that, put the key in `.env` as `GEMINI_API_KEY`.

Each generated test suite and improved prompt records the model that made it (for example *Google Gemini · gemini-4-hydrogen*). This is shown in the Test Case Lab and the Prompt Optimizer.

### Two provider roles

- **Executor**: runs the prompt under test. Use the model your product actually uses.
- **Analyst**: generates tests, judges outputs and writes the improved prompt. A strong reasoning model works best.

They can be different providers (for example, a local Ollama model as executor and Claude as analyst).

### Demo mode vs live mode

| | Demo mode (`demo` provider) | Live mode |
|---|---|---|
| Execution | Deterministic **simulator**: imitates common LLM failure modes based on which safeguards the prompt contains | Real model call |
| Test generation | Rule-based template library (generic) | Analyst model, tailored to the prompt |
| Judging | Transparent heuristic rules per category | Analyst model (LLM judge) |
| Optimisation | Rule-based restructuring | Analyst model rewrite |
| Labelling | Every run, page and report is marked **Demo data** | Marked **Live** |

Deterministic checks (JSON validity, required keys, word limits, required or forbidden content, format) are real in both modes. Demo results are **never** presented as real model behaviour.

## Features

| Page | What it does |
|---|---|
| **Dashboard** | Totals (prompts, test cases, passed/failed tests, average pass rate), pass-rate trend, severity chart, improvement chart, category robustness, recent activity |
| **Testing Studio** | Prompt editor, task description, expected-output configuration, constraints, live static lint, test-generation controls, *Start testing*, execution results |
| **Test Case Lab** | Filter/search tests, add, edit, delete, generate more, run all, run selected or run a single test against any version |
| **Failure Analysis** | Failed tests with severity, failure types, the four-question explanation, root-cause grouping by responsible instruction |
| **Prompt Optimizer** | Source prompt, detected weaknesses, editable improved prompt, diff view, copy, *Save version*, *Save & retest*, version table |
| **Comparison Studio** | Pass rate before/after, delta and relative change, fixed/regressed tests, failure count, consistency, latency, category and severity charts, test-by-test diff |
| **Prompt History** | Search and sort experiments, inspect versions and runs, open, duplicate, delete, compare two experiments |
| **Reports** | Download HTML (printable to PDF), Markdown or JSON; live HTML preview |
| **Settings & Providers** | Provider status, role selection, session keys, connection test |

Supporting details: warm brown-and-beige design (single theme), responsive layout, loading skeletons, empty states, error banners, toasts, confirmation dialogs, deep links (`?exp=<id>`).

### 3D and motion

- **Crash core (Dashboard hero):** a Three.js prompt core made of 80 shards. Red shards are faults. Click it (or press Enter when focused) and it shatters, the faults heal while the shards are apart, and it reassembles. This is the crash → fix → retest loop in miniature. It is decorative and never shows data.
- **Lab floor background:** an animated 3D grid with drifting particles behind every page. The camera follows the mouse and page scroll.
- **Interface motion:** cards tilt in 3D with a glare effect, numbers count up, pages transition in 3D, live runs show a 3D gyroscope, and the hero has a spinning gradient border and a glitch headline.
- **Performance and accessibility:**
  - Three.js is lazy-loaded and every page is its own chunk.
  - The background renders at about 30 fps and pauses when the tab is hidden. The hero pauses when it's off-screen.
  - `prefers-reduced-motion` gives static frames.
  - Without WebGL, a CSS fallback is shown instead.
  - The **cube button** in the top bar switches all 3D effects on or off for that browser.

## Repository structure

```
prompt-crash-lab/
├── client/                    React 19 + Vite front end
│   ├── index.html
│   ├── public/favicon.svg
│   └── src/
│       ├── components/        Layout, UI kit, charts, results, workflow widgets
│       ├── lib/               API client, app state, diff
│       ├── pages/             One file per page (9 pages, lazy-loaded)
│       ├── three/             3D layer: CrashCore hero, BackgroundField, hooks (Three.js / React Three Fiber)
│       └── styles/global.css  Design system (tokens, components, responsive)
├── server/                    Express 5 API (TypeScript, run with tsx)
│   ├── providers/             LLMProvider interface + anthropic, gemini, openai-compatible, demo, registry
│   ├── core/                  testGenerator, runner, judge, optimizer, report, json, templates
│   ├── routes/api.ts          REST endpoints + input validation (zod)
│   ├── store/                 JSON-file experiment store (atomic writes)
│   ├── app.ts / index.ts
├── shared/                    Types, lint, deterministic checks, metrics, selectors (used by both sides)
├── prompts/
│   ├── final/                 Meta-prompts used at runtime (test generator, judge, optimiser)
│   └── history/v1/            Earlier prompt versions, kept for the iteration record
├── tests/                     Vitest: unit, analyst-path (stub providers), end-to-end API workflow
├── docs/                      Architecture, diagrams, modules, testing, prompt iterations, demo script
├── data/                      Runtime data (git-ignored)
├── .env.example  CHANGELOG.md  README.md
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system architecture, prompt workflow and input/output flow diagrams, design decisions
- [docs/MODULES.md](docs/MODULES.md): module-by-module reference and REST API
- [docs/TESTING.md](docs/TESTING.md): automated test cases and latest results
- [docs/PROMPT_ITERATIONS.md](docs/PROMPT_ITERATIONS.md): meta-prompt version history
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): step-by-step demonstration walkthrough
- [CHANGELOG.md](CHANGELOG.md)

## Troubleshooting

- **"Cannot reach the Prompt Crash Lab server"**: the API isn't running. Use `npm run dev`, not only `vite`.
- **Vitest fails with "failed to find the runner" on Windows**: run tests from a path with an upper-case drive letter (`C:\…`, not `c:\…`). Some terminals (for example VS Code's) open with a lower-case drive letter, which makes Node load Vitest twice.
- **401 / 404 from a provider**: check the key or model name in `.env`, then use *Test connection* in Settings.
- **A run shows "Interrupted"**: the server stopped mid-run. Re-run it; finished results were kept.

## Security notes

- API keys stay server-side. They are read from `.env` or held in memory, never persisted with experiments, and never sent to the client.
- `.env`, `data/*.json` and build output are git-ignored.
- The HTML report escapes all user and model content, and the in-app preview is sandboxed.
