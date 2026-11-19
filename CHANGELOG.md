# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/); dates DD-MMM-YYYY.

## [1.3.0] - 18-Nov-2026 · Brown & beige redesign

### Changed
- New warm palette: beige background, brown for the second colour (primary buttons, active navigation, accents), and brown or near-black text. Purple, blue gradients and dark backgrounds are gone, and the app uses this single theme. The dark theme and its toggle were removed.
- Typography: Bricolage Grotesque for headings, Instrument Serif italic accents, Inter body, JetBrains Mono labels.
- Tactile details:
  - pill buttons with a hard offset shadow that "presses" on click;
  - pill navigation;
  - lowercase mono labels;
  - dashed card dividers;
  - dotted-paper hero with a sticker label and a hand-drawn underline that draws itself under "Crash it.";
  - static paper-grain texture.
- 3D:
  - caramel-to-sand shards with deep-red faults, softer lighting for the beige page, brown grid lines in the background;
  - the inner globe is now polished gold (metal + clear coat reflecting a studio environment), with a warm golden inner light and twinkling four-point sparkles.
- Chart series re-validated for colour-vision deficiency on the beige surface: original `#2E72A3`, improved `#B5652B`.

### Removed
- Glitch headline effect, spinning gradient border and button light-sweep.

## [1.2.0] - 18-Nov-2026 · Google Gemini

### Added
- Google Gemini provider (`server/providers/gemini.ts`):
  - native `generateContent` API, default model `gemini-4-hydrogen`;
  - key sent in a header and never in the URL;
  - thought parts filtered out, refusals and finish reasons normalised, error hints for 400/403/404/429.
- **Google Gemini** card in Settings: API key field with show/hide, model field, **Save & connect** (saves, then runs a connection test) and **Remove session key**.
- **Gemini-only generation** lock (`geminiOnlyGeneration`, UI checkbox or `GEMINI_ONLY_GENERATION`):
  - test cases, judging and improved prompts always use the Gemini key, and the analyst is pinned to Gemini;
  - if no key is active, generation returns a clear error instead of falling back to the rule-based generator.
- 4 tests (`tests/gemini.test.ts`): request shape, key kept out of the URL, error mapping, keys never persisted, lock behaviour across a restart.

- "High demand" (503) and rate-limit (429) responses are retried automatically with backoff (2 retries, honouring `Retry-After`). If they still fail, the error explains the cause and suggests switching model.
- Model discovery: `GET /api/providers/gemini/models` lists the models the key can use, and `pickBestPro()` selects the newest general-purpose Pro model.
- Settings changes:
  - **Use the best Gemini Pro model available to my key** (on by default);
  - **Switch to best Pro model** button and a clickable list of the key's models;
  - a high-demand banner with **Switch to Pro and retest**.

### Changed
- Gemini is strictly opt-in. Settings shows a collapsed **Google Gemini (optional)** row, and every Gemini option starts unticked. The default remains offline demo mode for both roles.

### Fixed
- A provider update that failed validation no longer leaves credential changes half-applied.

## [1.1.0] - 18-Nov-2026 · Front-end refresh

### Added
- 3D layer built with Three.js 0.187 and React Three Fiber 9:
  - interactive "crash core" hero on the Dashboard (shards shatter and heal on click);
  - app-wide animated lab-floor background.
- 3D on/off toggle in the top bar, stored per browser.
- Motion: 3D tilt and glare on cards, count-up numbers, 3D page transitions with staggered entry, gyroscope run indicator, spinning gradient hero border, glitch headline, travelling workflow highlight.
- Fallbacks: no WebGL → CSS orb; `prefers-reduced-motion` → static frames; rendering pauses off-screen and in hidden tabs.

### Changed
- Pages are lazy-loaded, and Three.js loads only when a 3D scene is shown. The initial JS bundle dropped from about 839 kB to 269 kB.
- Panels and the sidebar are translucent so the 3D background shows through. Modals and sticky table headers stay opaque.

### Fixed
- The mobile menu button was visible on desktop.

## [1.0.0] - 18-Nov-2026 · Milestone 1

### Added
- Full prompt-testing lifecycle: submit → generate tests → execute → detect failures → analyse → optimise → retest → compare → report.
- Provider-independent execution layer (`LLMProvider`) with Anthropic Claude (official SDK), any OpenAI-compatible endpoint, and an offline demo simulator; separate executor and analyst roles.
- Test generation across 8 categories (analyst model or rule-based templates), with ID, input, category, expected behaviour and rationale.
- Evaluation: deterministic output checks (JSON, keys, format, length, required/forbidden content), LLM or heuristic judge, consistency scoring across repeated runs, four-question failure explanations with severity.
- Static prompt linter (12 rules) running live in the editor.
- Prompt optimiser (analyst or rule-based), editable draft, diff view, versioning, save and retest.
- Comparison Studio with fairness check (`criteriaHash`), fixed/regressed analysis and charts.
- Pages: Dashboard, Testing Studio, Test Case Lab, Failure Analysis, Prompt Optimizer, Comparison Studio, Prompt History, Reports, Settings & Providers.
- Reports in HTML (printable), Markdown and JSON.
- JSON-file persistence with atomic writes and recovery of interrupted runs.
- Dark-first design system with light theme, responsive layout, empty/loading/error states, toasts and confirmation dialogs.
- 35 automated tests (unit, stub-provider analyst paths, end-to-end API workflow).
- Documentation: README, architecture and diagrams, module reference, testing, prompt iterations, demo script.
- Meta-prompts v2 in `prompts/final/`; v1 drafts kept in `prompts/history/v1/`.
