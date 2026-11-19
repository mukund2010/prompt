# Module reference

## shared/

| File | Responsibility |
|---|---|
| `types.ts` | Domain model and API contract: experiments, tests, versions, runs, results, failures, provider status, dashboard stats; category/severity/failure-type enums and labels |
| `lint.ts` | `lintPrompt(config)`: deterministic static analysis (too short, no role, format not stated, JSON keys or strictness missing, no invalid-input handling, vague language, conflicting instructions, length limit not stated, required content not requested, weak hierarchy, negative-heavy). `lintScore()` is a heuristic 0–100 indicator, shown as *not a test result* |
| `checks.ts` | `runDeterministicChecks(output, config)`: non-empty, JSON valid (fences count as a violation), required keys, bullets, single line, Markdown, min/max words, must or must-not include. `failuresFromChecks()` turns failed checks into explained `Failure`s |
| `metrics.ts` | Jaccard similarity, `consistencyScore`, `summarize` (pass rate excludes errors), `compareRuns` (fixed/regressed/still-failing, deltas, comparability) |
| `selectors.ts` | Pick the original version, latest improved version, latest full run, default comparison pair |
| `format.ts` | Dates as DD-MMM-YYYY, percentages, signed deltas, durations |

## server/providers/

| File | Responsibility |
|---|---|
| `types.ts` | `LLMProvider` interface, `CompletionRequest/Result`, `ProviderError` (retryable flag, status) |
| `anthropic.ts` | Official `@anthropic-ai/sdk`. Default model `claude-opus-5-5`, configurable effort, server-side refusal fallback (`fallbacks: "default"`) on supported models, typed error mapping |
| `gemini.ts` | Native Gemini REST API (`models/{model}:generateContent`), key sent in the `x-goog-api-key` header, default model `gemini-4-hydrogen`, thought parts filtered out, finish reasons and blocked prompts normalised, error hints for 400/403/404/429 |
| `openaiCompatible.ts` | Plain `fetch` to `{baseUrl}/chat/completions`; works with any OpenAI-style server |
| `demo.ts` | Offline simulator. `analysePromptFeatures()` detects safeguards in the prompt and `simulateResponse()` produces deterministic, seeded outputs that fail more often when safeguards are missing |
| `registry.ts` | Provider status, role assignment (executor/analyst), session-only key overrides, persistence of non-secret settings to `data/settings.json` |

## server/core/

| File | Responsibility |
|---|---|
| `testGenerator.ts` | `generateWithAnalyst()` uses `prompts/final/test-generator.md`; `generateRuleBased()` is a template library covering 8 categories |
| `runner.ts` | `evaluateTest()`: execute (× consistency runs, retry once on retryable errors), checks, judge, combined verdict. `RunManager`: background runs, concurrency, cancel, `criteriaHash` |
| `judge.ts` | `judgeWithAnalyst()` uses `prompts/final/judge.md` and normalises types and severities; `judgeHeuristically()` applies category rules (injection compliance, missing clarification, unresolved conflicts, runaway length, filler) |
| `optimizer.ts` | `aggregateFailures()`; `optimizeWithAnalyst()` uses `prompts/final/optimizer.md`; `optimizeRuleBased()` builds a Role/Task/Rules/Edge-cases/Output-format structure that preserves the original text |
| `report.ts` | Markdown, standalone HTML (escaped, print-ready) and JSON reports |
| `json.ts` | `extractJson()` (tolerates fences and prose); `completeJson()` validates with zod and retries once with the error message |
| `templates.ts` | Loads `prompts/final/*.md` and does single-pass `{{placeholder}}` rendering |
| `describe.ts` | Human-readable format and constraint descriptions; `buildExecutionMessages()` (system prompt vs `{{input}}` substitution; empty input sent as `[empty input]`) |

## server/routes/api.ts: REST API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness and current mode |
| `GET /api/providers` · `PUT /api/providers` · `POST /api/providers/test` | Provider status, role and key configuration, connection test |
| `GET /api/stats` | Dashboard aggregates |
| `GET/POST /api/experiments` | List summaries / create |
| `GET/PATCH/DELETE /api/experiments/:id` | Read / update (a prompt edit after runs becomes a new version) / delete |
| `POST /api/experiments/:id/duplicate` | Copy prompt and tests without runs |
| `POST /api/experiments/:id/tests/generate` | Generate tests `{count, categories, replace}` |
| `POST /api/experiments/:id/tests` · `PUT/DELETE …/tests/:testId` | Manual test CRUD |
| `POST /api/experiments/:id/runs` | Start a run `{versionId, testIds?}` (202) |
| `GET …/runs/:runId` · `POST …/runs/:runId/cancel` · `DELETE …/runs/:runId` | Poll / cancel / delete |
| `POST /api/experiments/:id/optimize` · `DELETE …/draft` | Create or discard the optimiser draft |
| `POST /api/experiments/:id/versions` · `DELETE …/versions/:versionId` | Save a version (optionally from the draft) / delete |
| `GET /api/experiments/:id/report?format=html\|md\|json` | Download report (`&inline=1` for preview) |

All bodies are validated with zod. Errors return `{ "error": "message" }` with 400/404/409/502, and unexpected errors return 500 without stack traces.

## client/src/

| Path | Responsibility |
|---|---|
| `lib/api.ts` | Typed REST client with friendly error messages |
| `lib/state.tsx` | Providers, experiment list, active experiment (localStorage or `?exp=`), polling while running, toasts, confirmation dialogs, `useAction` helper |
| `lib/diff.ts` | Line-level LCS diff for the optimiser |
| `components/ui.tsx` | Button, Card, Stat, badges (verdict/severity/mode), Banner, EmptyState, Loading, Progress, CopyButton, Modal, Tabs, Segmented, TagInput, Field |
| `components/charts.tsx` | Recharts wrappers: grouped bars, severity bars, trend line, improvement bars, outcome meter (palette validated for colour-vision deficiency in both themes) |
| `components/results.tsx` | FailureCard (the four questions), ResultDetail, ResultsTable |
| `components/workflow.tsx` | Workflow stepper, live run progress with cancel, run metadata, demo notice |
| `components/Layout.tsx` | Sidebar, top bar (experiment switcher, theme, new experiment), `NeedsExperiment` gate |
| `pages/*` | One page per feature (see README), each lazy-loaded |
| `three/hooks.ts` | WebGL detection, the 3D on/off preference, reduced motion, theme, in-view and tab-visibility hooks. Imports nothing from Three.js, so it stays in the main bundle |
| `three/CrashCore.tsx` | Dashboard hero scene: 80-shard icosahedral core with fault/heal cycle, wire shell, orbiting probes, particle dust, pointer parallax |
| `three/BackgroundField.tsx` | App-wide background: shader grid floor, drifting particles, horizon glow, mouse/scroll camera rig, about 30 fps on-demand rendering |
| `three/util.ts` | Seeded PRNG, glow sprite texture, frame-rate-independent damping |
