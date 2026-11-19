# Demonstration script (about 8 minutes)

Works fully offline in demo mode. For a live demo, configure a provider first (step 0).

**0. (Optional) Live mode:** *Settings & Providers*: paste a Gemini key in the **Google Gemini** card and click **Save & connect** (this sets both roles and tests the connection). Alternatively, add an Anthropic key or an OpenAI-compatible endpoint → **Save configuration** → set Executor and Analyst → **Save roles** → **Test connection**. The badge in the sidebar switches from *Demo data* to *Live*.

**1. Dashboard:** introduce the idea: *"Don't trust your prompt. Crash it."* Point out the eight-step lifecycle and the demo/live labelling.

**2. Submit (Testing Studio):** **New experiment** → *Load an example… → Support ticket triage (JSON)*.
- Show the prompt: short, vague, "be detailed but keep it short".
- Show the **Static prompt analysis** panel updating live (robustness score, conflicting length instructions, JSON keys not named, no invalid-input handling).
- Set *Consistency runs* to 2× to demonstrate the consistency metric.

**3. Generate + execute:** click **Start testing**. Watch the phases (saving → generating → executing) and the live progress bar with pass/fail counters. Mention that a run can be cancelled.

**4. Test Case Lab:** filter by *Instruction-following challenge*, open a test and show input, expected behaviour, rationale and actual output. Edit a test, add one manually, then **run a single test** with the ▶ button.

**5. Failure Analysis:** severity chart and failure types. Select a critical failure (e.g. prompt injection) and walk through **What went wrong / Why / Responsible instruction / How to fix**. Switch to **Root causes** to show failures grouped by the instruction that caused them.

**6. Prompt Optimizer:** **Generate improved prompt**. Show detected weaknesses, the **Diff** view (original text kept under `# Task`), **What changed**, and **Copy**. Then **Save & retest**.

**7. Comparison Studio:** before/after pass rate, delta, fixed vs regressed, failure count, consistency, category and severity charts. Filter the test table to **Fixed** and expand one row to compare both outputs side by side. Point out that both runs used the identical suite and criteria (otherwise a warning banner appears).

**8. Reports:** **Preview** the HTML report, then download HTML, Markdown and JSON. Point out the demonstration-data banner inside the report.

**9. Prompt History:** search, expand an experiment to show versions and runs, select two experiments → **Compare selected**, and **Duplicate** to start a variant.

Key messages for evaluators:
- The architecture is provider-independent (one interface, four adapters: Claude, Gemini, OpenAI-compatible, demo).
- Results are honest: demo data is always labelled, errors are never counted as passes or failures, and comparisons are only "like-for-like" when tests and criteria match.
- It is fully persistent, tested (35 automated tests) and documented.
