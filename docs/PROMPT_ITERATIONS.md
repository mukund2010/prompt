# Prompt iteration history

Prompt Crash Lab uses three meta-prompts when an analyst model is configured. Final versions live in `prompts/final/` and are loaded at runtime. Superseded versions are kept unchanged in `prompts/history/`.

| Prompt | v1 (`prompts/history/v1/`) | v2: final (`prompts/final/`) |
|---|---|---|
| Test generator | One-paragraph request listing the categories | Role, category definitions, expected-behaviour policy, realism requirements, strict JSON shape, all context in tagged sections |
| Judge | "Did this response follow the prompt?" with a loose JSON request | Pass criterion, automatic checks treated as facts, failure-type and severity definitions, the four explanation fields, strict JSON shape |
| Optimiser | "Improve this prompt" plus a list of failures | Preserve intent; fix observed failures first; explicit output schema; instruction hierarchy and conflict priority; unusual-input handling; keep placeholders; keep it short; weaknesses and changes returned |

## Why each change was made (design rationale)

### Test generator v1 → v2
- **Category definitions added.** Without them "conflicting" and "instruction" were open to interpretation, and suites skewed towards normal inputs.
- **Expected behaviour defined from intent, not the current prompt.** Otherwise the generator writes expectations that the flawed prompt already satisfies, and nothing fails.
- **Domain realism required.** Generic inputs ("test input 1") don't exercise the prompt's domain.
- **Long inputs bounded to 300–600 words** to control cost and latency.
- **Tagged sections** separate the prompt under test from instructions, so text inside it isn't mistaken for instructions to the generator.

### Judge v1 → v2
- **Automatic checks passed in as facts**, so the judge can't pass a response that failed a deterministic check (also enforced in code).
- **Failure types and severities defined** so they map onto the app's enums and charts.
- **The four required explanation fields** (*what, why, responsible instruction, fix*) are requested explicitly.
- **"A careful product owner would accept it as-is"** gives a concrete pass bar.

### Optimiser v1 → v2
- **Preserve intent** and **do not add features**: v1 tended to change the task.
- **Fix observed failures first**: links the rewrite to evidence from the run.
- **Keep `{{input}}` placeholders**: a v1 rewrite could break prompts that embed the input.
- **Return weaknesses and changes**: powers the *Detected weaknesses* and *What changed* panels.

## Application-side safeguards (independent of prompt wording)
- JSON is extracted, validated with zod and retried once with the validation error (`server/core/json.ts`).
- A judge verdict of "passed" with listed failures is treated as a fail.
- Unknown categories, types and severities are normalised to valid values.

## Recording future iterations
1. Copy the current file from `prompts/final/` to `prompts/history/v<N>/` before editing.
2. Bump `version` in the front matter.
3. Add a row and a rationale section here, plus an entry in `CHANGELOG.md`.
4. Re-run `npm test` (the analyst paths are covered with stub providers), then a live smoke run.
