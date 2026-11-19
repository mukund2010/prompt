/** Builds downloadable experiment reports (Markdown, standalone HTML, JSON). */
import { formatDateTime, formatPct, formatSigned } from "../../shared/format";
import { lintPrompt } from "../../shared/lint";
import { compareRuns, type Comparison } from "../../shared/metrics";
import { defaultComparison, latestImprovedVersion, originalVersion } from "../../shared/selectors";
import { CATEGORY_LABELS, FAILURE_TYPE_LABELS, type Experiment, type Run, type TestCase, type Weakness } from "../../shared/types";
import { aggregateFailures } from "./optimizer";

interface ReportModel {
  exp: Experiment;
  generatedAt: string;
  original: string;
  improved?: string;
  improvedLabel?: string;
  baseline?: Run;
  candidate?: Run;
  comparison?: Comparison;
  recommendations: Weakness[];
  hasDemo: boolean;
}

function buildModel(exp: Experiment): ReportModel {
  const { baseline, candidate } = defaultComparison(exp);
  const improvedVersion = latestImprovedVersion(exp);
  const latestRun = candidate ?? baseline;
  const groups = aggregateFailures(latestRun, exp.testCases);
  const recs: Weakness[] = [
    ...groups.slice(0, 6).map((g, i) => ({
      id: `rec-${i}`,
      title: `${FAILURE_TYPE_LABELS[g.failure.type]} (${g.count} test${g.count > 1 ? "s" : ""})`,
      detail: g.failure.what,
      severity: g.failure.severity,
      instruction: g.failure.instruction,
      fix: g.failure.fix,
      source: "failures" as const,
    })),
    ...lintPrompt({ ...exp.config, prompt: improvedVersion?.prompt ?? exp.config.prompt }),
  ];
  return {
    exp,
    generatedAt: new Date().toISOString(),
    original: originalVersion(exp)?.prompt ?? exp.config.prompt,
    improved: improvedVersion?.prompt,
    improvedLabel: improvedVersion?.label,
    baseline,
    candidate,
    comparison: baseline && candidate ? compareRuns(baseline, candidate) : undefined,
    recommendations: recs,
    hasDemo: exp.runs.some((r) => r.mode === "demo") || exp.testGeneration?.mode === "demo",
  };
}

const testById = (exp: Experiment) => new Map(exp.testCases.map((t) => [t.id, t]));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ----------------------------- Markdown ------------------------------------

export function reportMarkdown(exp: Experiment): string {
  const m = buildModel(exp);
  const L: string[] = [];
  const mdCell = (s: string) => clip(s, 160).replace(/\|/g, "\\|").replace(/\n/g, " ") || "(empty)";
  L.push(`# Prompt Crash Lab report: ${exp.name}`, "");
  L.push(`Generated ${formatDateTime(m.generatedAt)} · Experiment created ${formatDateTime(exp.createdAt)}`, "");
  if (m.hasDemo)
    L.push("> **Demonstration data.** Some or all results in this report were produced in demo mode by a deterministic simulator and rule-based evaluators, not by a real language model. Do not treat them as measurements of model behaviour.", "");

  L.push("## Summary", "");
  L.push("| Metric | Original | Improved |", "|---|---|---|");
  const row = (label: string, a: string, b: string) => L.push(`| ${label} | ${a} | ${b} |`);
  row("Pass rate", formatPct(m.baseline?.summary.passRate), formatPct(m.candidate?.summary.passRate));
  row("Passed / failed / errors", m.baseline ? `${m.baseline.summary.passed} / ${m.baseline.summary.failed} / ${m.baseline.summary.errored}` : "—", m.candidate ? `${m.candidate.summary.passed} / ${m.candidate.summary.failed} / ${m.candidate.summary.errored}` : "—");
  row("Critical + high failures", m.baseline ? String(m.baseline.summary.bySeverity.critical + m.baseline.summary.bySeverity.high) : "—", m.candidate ? String(m.candidate.summary.bySeverity.critical + m.candidate.summary.bySeverity.high) : "—");
  row("Consistency", formatPct(m.baseline?.summary.avgConsistency), formatPct(m.candidate?.summary.avgConsistency));
  row("Execution mode", m.baseline?.mode ?? "—", m.candidate?.mode ?? "—");
  row("Executor", m.baseline ? `${m.baseline.executor.provider} · ${m.baseline.executor.model}` : "—", m.candidate ? `${m.candidate.executor.provider} · ${m.candidate.executor.model}` : "—");
  L.push("");
  if (m.comparison) {
    const c = m.comparison;
    L.push(`**Change:** ${formatSigned(c.passRateDelta, " pts")} pass rate · ${c.fixed} fixed · ${c.regressed} regressed · ${c.stillFailing} still failing.`);
    if (!c.comparable) L.push("", "> Runs are not fully comparable (different test sets or execution modes).");
    L.push("");
  }

  L.push("## Original prompt", "", "```text", m.original, "```", "");
  L.push(`## Improved prompt${m.improvedLabel ? ` (${m.improvedLabel})` : ""}`, "");
  L.push(m.improved ? ["```text", m.improved, "```"].join("\n") : "_No improved version has been created yet._", "");

  L.push("## Test cases", "", "| ID | Category | Input | Expected behaviour |", "|---|---|---|---|");
  for (const t of exp.testCases) L.push(`| ${t.id} | ${CATEGORY_LABELS[t.category]} | ${mdCell(t.input)} | ${mdCell(t.expectedBehavior)} |`);
  L.push("");

  const runSection = (title: string, run?: Run) => {
    L.push(`## ${title}`, "");
    if (!run) return L.push("_No completed full run._", "");
    L.push(`Run ${run.id} · ${run.mode.toUpperCase()} · ${formatDateTime(run.startedAt)} · executor ${run.executor.provider}/${run.executor.model} · judge ${run.analyst.provider}/${run.analyst.model}`, "");
    const tests = testById(exp);
    for (const r of run.results) {
      const t = tests.get(r.testId);
      L.push(`### ${r.testId}: ${r.verdict.toUpperCase()} (${t ? CATEGORY_LABELS[t.category] : "?"})`, "");
      L.push(`**Input:** ${t?.input ? clip(t.input, 400) : "(empty)"}`, "");
      L.push("**Actual output:**", "", "```text", clip(r.output || r.error || "(no output)", 1500), "```", "");
      if (r.judge?.reasoning) L.push(`**Judge (${r.judge.method}):** ${r.judge.reasoning}`, "");
      for (const f of r.failures) {
        L.push(`- **[${f.severity.toUpperCase()}] ${FAILURE_TYPE_LABELS[f.type]}**`);
        L.push(`  - What went wrong: ${f.what}`, `  - Why: ${f.why}`, `  - Responsible instruction: ${f.instruction}`, `  - Fix: ${f.fix}`);
      }
      L.push("");
    }
  };
  runSection("Results: original prompt", m.baseline);
  if (m.candidate) runSection("Results: improved prompt", m.candidate);

  L.push("## Improvement recommendations", "");
  if (!m.recommendations.length) L.push("_No outstanding recommendations._");
  for (const w of m.recommendations) L.push(`- **[${w.severity.toUpperCase()}] ${w.title}:** ${w.fix}`);
  L.push("", "---", "Generated by Prompt Crash Lab.");
  return L.join("\n");
}

// ------------------------------- HTML --------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function reportHtml(exp: Experiment): string {
  const m = buildModel(exp);
  const tests = testById(exp);
  const sevColour: Record<string, string> = { critical: "#b42318", high: "#c4320a", medium: "#b54708", low: "#475467" };
  const stat = (label: string, a: string, b: string) => `<tr><th>${esc(label)}</th><td>${esc(a)}</td><td>${esc(b)}</td></tr>`;
  const runBlock = (title: string, run?: Run) => {
    if (!run) return `<h2>${esc(title)}</h2><p class="muted">No completed full run.</p>`;
    const rows = run.results
      .map((r) => {
        const t: TestCase | undefined = tests.get(r.testId);
        const fails = r.failures
          .map(
            (f) => `<div class="fail"><span class="sev" style="background:${sevColour[f.severity]}">${f.severity}</span> <b>${esc(FAILURE_TYPE_LABELS[f.type])}</b>
<dl><dt>What went wrong</dt><dd>${esc(f.what)}</dd><dt>Why</dt><dd>${esc(f.why)}</dd><dt>Responsible instruction</dt><dd>${esc(f.instruction)}</dd><dt>Fix</dt><dd>${esc(f.fix)}</dd></dl></div>`,
          )
          .join("");
        return `<section class="test"><h3><span class="verdict ${r.verdict}">${r.verdict}</span> ${esc(r.testId)} · ${esc(t ? CATEGORY_LABELS[t.category] : "?")}</h3>
<p><b>Input</b></p><pre>${esc(clip(t?.input || "(empty)", 1200))}</pre>
<p><b>Actual output</b></p><pre>${esc(clip(r.output || r.error || "(no output)", 3000))}</pre>
${r.judge?.reasoning ? `<p class="muted"><b>Judge (${esc(r.judge.method)}):</b> ${esc(r.judge.reasoning)}</p>` : ""}${fails}</section>`;
      })
      .join("");
    return `<h2>${esc(title)}</h2><p class="muted">Run ${esc(run.id)} · <b>${run.mode.toUpperCase()}</b> · ${esc(formatDateTime(run.startedAt))} · executor ${esc(run.executor.provider)}/${esc(run.executor.model)} · judge ${esc(run.analyst.provider)}/${esc(run.analyst.model)}</p>${rows}`;
  };
  const c = m.comparison;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prompt Crash Lab report: ${esc(exp.name)}</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2433;background:#fff;max-width:960px;margin:0 auto;padding:32px 20px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;border-bottom:2px solid #e4e7ec;padding-bottom:6px}h3{font-size:15px;margin:0 0 8px}
.muted{color:#667085}.banner{background:#fffaeb;border:1px solid #fec84b;padding:12px 14px;border-radius:8px;margin:16px 0}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #e4e7ec;padding:7px 9px;text-align:left;vertical-align:top;font-size:13.5px}th{background:#f9fafb}
pre{background:#f6f7f9;border:1px solid #e4e7ec;border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;font:12.5px/1.5 ui-monospace,Consolas,monospace}
.test{border:1px solid #e4e7ec;border-radius:10px;padding:14px;margin:12px 0;break-inside:avoid}
.verdict{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;text-transform:uppercase;color:#fff}.pass{background:#067647}.fail{background:#b42318}.error{background:#475467}
div.fail{background:#fff;border-left:3px solid #f04438;padding:6px 10px;margin:8px 0}.sev{color:#fff;font-size:11px;padding:1px 7px;border-radius:99px;text-transform:uppercase}
dl{margin:6px 0 0;display:grid;grid-template-columns:180px 1fr;gap:3px 10px;font-size:13.5px}dt{color:#667085}dd{margin:0}
.kpi{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.kpi div{border:1px solid #e4e7ec;border-radius:10px;padding:10px 14px;min-width:140px}.kpi b{display:block;font-size:22px}
@media print{body{padding:0}.test{page-break-inside:avoid}}
</style></head><body>
<h1>Prompt Crash Lab report</h1>
<p class="muted">${esc(exp.name)} · generated ${esc(formatDateTime(m.generatedAt))}</p>
${m.hasDemo ? `<div class="banner"><b>Demonstration data.</b> Some or all results were produced in demo mode by a deterministic simulator and rule-based evaluators, not by a real language model.</div>` : ""}
<h2>Summary</h2>
${c ? `<div class="kpi"><div>Pass rate change<b>${esc(formatSigned(c.passRateDelta, " pts"))}</b></div><div>Fixed<b>${c.fixed}</b></div><div>Regressed<b>${c.regressed}</b></div><div>Still failing<b>${c.stillFailing}</b></div></div>${c.comparable ? "" : '<p class="muted">Runs are not fully comparable (different test sets or execution modes).</p>'}` : ""}
<table><tr><th>Metric</th><th>Original</th><th>Improved</th></tr>
${stat("Pass rate", formatPct(m.baseline?.summary.passRate), formatPct(m.candidate?.summary.passRate))}
${stat("Passed / failed / errors", m.baseline ? `${m.baseline.summary.passed} / ${m.baseline.summary.failed} / ${m.baseline.summary.errored}` : "—", m.candidate ? `${m.candidate.summary.passed} / ${m.candidate.summary.failed} / ${m.candidate.summary.errored}` : "—")}
${stat("Critical + high failures", m.baseline ? String(m.baseline.summary.bySeverity.critical + m.baseline.summary.bySeverity.high) : "—", m.candidate ? String(m.candidate.summary.bySeverity.critical + m.candidate.summary.bySeverity.high) : "—")}
${stat("Consistency", formatPct(m.baseline?.summary.avgConsistency), formatPct(m.candidate?.summary.avgConsistency))}
${stat("Execution mode", m.baseline?.mode ?? "—", m.candidate?.mode ?? "—")}
</table>
<h2>Original prompt</h2><pre>${esc(m.original)}</pre>
<h2>Improved prompt${m.improvedLabel ? ` (${esc(m.improvedLabel)})` : ""}</h2>${m.improved ? `<pre>${esc(m.improved)}</pre>` : '<p class="muted">No improved version yet.</p>'}
<h2>Test cases (${exp.testCases.length})</h2>
<table><tr><th>ID</th><th>Category</th><th>Input</th><th>Expected behaviour</th><th>Reason</th></tr>
${exp.testCases.map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(CATEGORY_LABELS[t.category])}</td><td>${esc(clip(t.input || "(empty)", 220))}</td><td>${esc(t.expectedBehavior)}</td><td>${esc(t.rationale)}</td></tr>`).join("")}
</table>
${runBlock("Results: original prompt", m.baseline)}
${m.candidate ? runBlock("Results: improved prompt", m.candidate) : ""}
<h2>Improvement recommendations</h2>
${m.recommendations.length ? `<table><tr><th>Severity</th><th>Issue</th><th>Recommendation</th></tr>${m.recommendations.map((w) => `<tr><td>${w.severity}</td><td>${esc(w.title)}</td><td>${esc(w.fix)}</td></tr>`).join("")}</table>` : '<p class="muted">No outstanding recommendations.</p>'}
<p class="muted" style="margin-top:32px">Generated by Prompt Crash Lab.</p>
</body></html>`;
}

export function reportJson(exp: Experiment): string {
  const m = buildModel(exp);
  return JSON.stringify({ generatedAt: m.generatedAt, demonstrationData: m.hasDemo, comparison: m.comparison ?? null, recommendations: m.recommendations, experiment: exp }, null, 2);
}
