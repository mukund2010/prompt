/**
 * Deterministic output checks. These run on every executed output,
 * regardless of provider, and are fully reproducible.
 */
import type { CheckResult, ExperimentConfig, Failure } from "./types";

export function stripCodeFence(text: string): { body: string; fenced: boolean } {
  const m = text.trim().match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? { body: m[1].trim(), fenced: true } : { body: text.trim(), fenced: false };
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function runDeterministicChecks(output: string, config: ExperimentConfig): CheckResult[] {
  const checks: CheckResult[] = [];
  const text = output ?? "";
  const trimmed = text.trim();

  checks.push({
    id: "non-empty",
    label: "Response is not empty",
    passed: trimmed.length > 0,
    detail: trimmed.length > 0 ? `${trimmed.length} characters returned.` : "The model returned an empty response.",
    failureType: "unexpected_response",
    severity: "critical",
  });
  if (!trimmed) return checks;

  switch (config.outputFormat) {
    case "json": {
      const { body, fenced } = stripCodeFence(trimmed);
      let parsed: unknown = undefined;
      let ok = false;
      try {
        parsed = JSON.parse(body);
        ok = true;
      } catch (e) {
        ok = false;
      }
      checks.push({
        id: "json-valid",
        label: "Output is valid JSON",
        passed: ok && !fenced,
        detail: ok
          ? fenced
            ? "JSON parsed, but it was wrapped in a Markdown code fence, so a strict parser would reject it."
            : "Output parsed as JSON."
          : "Output could not be parsed as JSON.",
        failureType: "format_violation",
        severity: ok ? "medium" : "high",
      });
      if (ok && config.constraints.requiredJsonKeys.length) {
        const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        const missing = config.constraints.requiredJsonKeys.filter((k) => !(k in obj));
        checks.push({
          id: "json-keys",
          label: "Required JSON keys present",
          passed: missing.length === 0,
          detail: missing.length ? `Missing keys: ${missing.join(", ")}.` : "All required keys present.",
          failureType: "missing_instruction",
          severity: "high",
        });
      }
      break;
    }
    case "bullets": {
      const lines = trimmed.split(/\n/).filter((l) => l.trim());
      const bulletLines = lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
      const ok = bulletLines.length >= 1 && bulletLines.length >= Math.ceil(lines.length * 0.6);
      checks.push({
        id: "bullets",
        label: "Output is a bullet list",
        passed: ok,
        detail: `${bulletLines.length} of ${lines.length} non-empty lines are list items.`,
        failureType: "format_violation",
        severity: "medium",
      });
      break;
    }
    case "single-line": {
      const ok = !/\n/.test(trimmed);
      checks.push({
        id: "single-line",
        label: "Output is a single line",
        passed: ok,
        detail: ok ? "Single line." : `Output spans ${trimmed.split(/\n/).length} lines.`,
        failureType: "format_violation",
        severity: "medium",
      });
      break;
    }
    case "markdown": {
      const ok = /(^|\n)\s*(#{1,6}\s|[-*]\s|\d+\.\s|\|.+\|)|\*\*[^*]+\*\*/.test(trimmed);
      checks.push({
        id: "markdown",
        label: "Output uses Markdown structure",
        passed: ok,
        detail: ok ? "Markdown structure detected." : "No headings, lists, tables or emphasis detected.",
        failureType: "format_violation",
        severity: "low",
      });
      break;
    }
    default:
      break;
  }

  const wc = wordCount(trimmed);
  const { maxWords, minWords } = config.constraints;
  if (maxWords) {
    checks.push({
      id: "max-words",
      label: `At most ${maxWords} words`,
      passed: wc <= maxWords,
      detail: `${wc} words.`,
      failureType: "missing_instruction",
      severity: wc > maxWords * 1.5 ? "high" : "medium",
    });
  }
  if (minWords) {
    checks.push({
      id: "min-words",
      label: `At least ${minWords} words`,
      passed: wc >= minWords,
      detail: `${wc} words.`,
      failureType: "missing_instruction",
      severity: "medium",
    });
  }

  const lower = trimmed.toLowerCase();
  for (const term of config.constraints.mustInclude.filter(Boolean)) {
    const ok = lower.includes(term.toLowerCase());
    checks.push({
      id: `include:${term}`,
      label: `Contains "${term}"`,
      passed: ok,
      detail: ok ? "Present." : "Not found in the output.",
      failureType: "missing_instruction",
      severity: "medium",
    });
  }
  for (const term of config.constraints.mustNotInclude.filter(Boolean)) {
    const ok = !lower.includes(term.toLowerCase());
    checks.push({
      id: `exclude:${term}`,
      label: `Does not contain "${term}"`,
      passed: ok,
      detail: ok ? "Absent." : "Forbidden content found in the output.",
      failureType: "unexpected_response",
      severity: "high",
    });
  }

  return checks;
}

/** Converts failed deterministic checks into explained failures. */
export function failuresFromChecks(checks: CheckResult[], config: ExperimentConfig): Failure[] {
  return checks
    .filter((c) => !c.passed)
    .map((c): Failure => {
      const base = { type: c.failureType ?? "unexpected_response", severity: c.severity ?? "medium", source: "rule" as const };
      if (c.id === "non-empty")
        return {
          ...base,
          what: "The model produced no output.",
          why: "The prompt or input may have triggered a refusal, a length limit, or a provider-side issue.",
          instruction: "Whole prompt",
          fix: "Add a fallback instruction: always reply, and explain briefly if the request cannot be completed.",
        };
      if (c.id === "json-valid")
        return {
          ...base,
          what: c.detail,
          why: "The prompt does not make the JSON-only requirement strict enough, so the model adds prose or fences.",
          instruction: "Output format",
          fix: 'State: "Return only valid JSON, no code fences or commentary," and give an exact example object.',
        };
      if (c.id === "json-keys")
        return {
          ...base,
          what: c.detail,
          why: "Required keys are not enumerated, or the input led the model to change the schema.",
          instruction: "Output schema",
          fix: `List every required key (${config.constraints.requiredJsonKeys.join(", ")}) with types, and say they must always be present (use null if unknown).`,
        };
      if (c.id === "max-words" || c.id === "min-words")
        return {
          ...base,
          what: `Length constraint violated: ${c.detail}`,
          why: "The prompt gives no numeric length limit, or complex input caused the model to expand.",
          instruction: "Length constraint",
          fix: `Put an explicit word limit in the prompt (${c.label.toLowerCase()}) and say it applies even to long inputs.`,
        };
      if (c.id.startsWith("include:"))
        return {
          ...base,
          what: `Required content missing: ${c.label}.`,
          why: "The prompt does not instruct the model to always include this element.",
          instruction: "Required content",
          fix: `Add: "Always include ${c.label.replace(/^Contains /, "")}."`,
        };
      if (c.id.startsWith("exclude:"))
        return {
          ...base,
          what: `Forbidden content present: ${c.label.replace(/^Does not contain /, "")}.`,
          why: "The prohibition is missing from the prompt or is overridden by the input.",
          instruction: "Content restrictions",
          fix: "Add the prohibition explicitly and state that user input cannot override it.",
        };
      return {
        ...base,
        what: `${c.label}: ${c.detail}`,
        why: `The expected ${config.outputFormat} structure is not described clearly enough in the prompt.`,
        instruction: "Output format",
        fix: `Add an "Output format" section describing the ${config.outputFormat} structure with an example.`,
      };
    });
}
