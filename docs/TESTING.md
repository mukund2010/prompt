# Testing

Run everything with:

```bash
npm run typecheck   # strict TypeScript across client, server, shared, tests
npm test            # Vitest
npm run build       # production client build
```

> Windows: run `npm test` from a path with an upper-case drive letter (`C:\…`). See the README's Troubleshooting section.

## Automated test cases

### `tests/shared.test.ts`: shared logic (10 tests)

| # | Test | Verifies |
|---|---|---|
| S1 | Weak, vague prompt | Lint flags *too-short*, *no-input-handling*, *conflict-length*, *vague-language*; score < 60 |
| S2 | JSON expected | Lint names only the missing JSON keys and flags non-strict JSON |
| S3 | Well-structured prompt | Lint score ≥ 90 |
| S4 | Clean JSON | All checks pass |
| S5 | Fenced JSON, missing key | Both checks fail; every failure has what/why/instruction/fix |
| S6 | Empty, bullets, limits, forbidden | Each check behaves correctly |
| S7 | Similarity | Jaccard and consistency edge cases |
| S8 | Pass rate | Execution errors are excluded from the pass rate |
| S9 | Run comparison | Fixed / regressed / still-failing / still-passing classified; differing `criteriaHash` → not comparable |
| S10 | Date format | `03-Nov-2026` (DD-MMM-YYYY) |

### `tests/analyst.test.ts`: analyst code paths with stub providers (10 tests)

| # | Test | Verifies |
|---|---|---|
| A1 | JSON extraction | Fenced, chatty and nested replies parse; no JSON → error |
| A2 | Template rendering | Single pass; inserted values are not re-substituted; unknown placeholders kept |
| A3 | Test generation | Invalid JSON triggers exactly one repair retry; IDs continue (TC-002…); category aliases normalised |
| A4 | Judge | Severity normalised; a "passed" verdict with failures is forced to fail |
| A5 | Optimiser | Improved prompt, weaknesses and method/mode recorded |
| A6 | Execution | Prompt sent as system message, input as user message; pass when checks and judge pass |
| A7 | `{{input}}` prompts | Input substituted into the prompt |
| A8 | Provider error | `verdict: error`, `execution_error`, not counted as a model failure |
| A9 | Judge error | `verdict: error` ("Evaluation failed"), never a pass |
| A10 | Consistency | Divergent repeated outputs produce an *inconsistent behaviour* failure |

### `tests/api.workflow.test.ts`: end-to-end over HTTP in demo mode (15 tests)

Covers: health and mode, input validation (400/404), refusal to run without tests, generation of 16 tests across all 8 categories, manual test CRUD, a full execution with explained failures, the 409-style guard against concurrent runs, single-test partial runs, optimisation preserving original intent and naming JSON keys, saving a version, a retest on an identical suite (same test IDs and `criteriaHash`) with a higher pass rate, prompt edits becoming new versions, Markdown/HTML/JSON reports (all required sections, demo labelling, no `<script>` in HTML), dashboard stats and history, rejection of an unconfigured provider, persistence to disk (no keys stored), and duplicate/delete.

### `tests/gemini.test.ts`: Gemini adapter and Gemini-only generation (6 tests)

| # | Test | Verifies |
|---|---|---|
| G1 | Request shape | System + user sent to `generateContent`; key in header, not URL; thought parts dropped; usage mapped |
| G2 | Errors | Safety block → refusal; 404 not retryable; 429 retried twice then retryable error |
| G3 | Registry | UI key enables Gemini for both roles; key never persisted or returned; invalid setups roll back |
| G4 | Gemini-only lock | Analyst pinned to Gemini; persists across restart; no key → error, never rule-based fallback |
| G5 | High demand | 503 retried and succeeds on recovery; persistent 503 gives a clear "switch model" error |
| G6 | Model discovery | Lists generateContent models via header auth; picks newest Pro (stable over preview, excludes image/TTS) |

## Latest results (18-Nov-2026)

```
Test Files  4 passed (4)
     Tests  41 passed (41)
```

- `npm run typecheck`: no errors
- `npm run build`: succeeds

## Manual end-to-end check (production build, demo mode)

Executed against `npm start` with the *Support ticket triage (JSON)* example, 16 rule-based tests and 2 consistency runs:

| Step | Result |
|---|---|
| Baseline run (v1 · original) | completed, **0.0 %** pass rate; failures: 2 critical, 20 high, 9 medium |
| Rule-based optimisation → v2 | saved; original text preserved under `# Task` |
| Retest (v2, identical 16 tests) | completed, **62.5 %** pass rate; failures: 0 critical, 3 high, 4 medium |
| Comparison | +62.5 pts, 10 fixed, 0 regressed, failures 31 → 7 |

> **These figures are demonstration data** from the offline simulator and heuristic judge. They show that the pipeline works end to end. They are *not* a measurement of any real model. Run the same workflow with a configured provider to get real results.

UI rendering was checked with headless Chrome screenshots of the Dashboard, Testing Studio, Test Case Lab, Failure Analysis, Prompt Optimizer and Comparison Studio at desktop width, and the Optimizer at a narrow width (no horizontal overflow).

## Not covered by automated tests

- Live calls to Anthropic, Gemini or OpenAI-compatible endpoints (no credentials in CI). The analyst code paths are covered with stub providers, and the Gemini adapter is covered with a mocked `fetch`.
- Browser interaction tests (clicks, forms). Pages were verified visually and through the API they call.
