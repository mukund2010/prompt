import type { ExperimentConfig } from "../../shared/types";

const FORMAT_TEXT: Record<ExperimentConfig["outputFormat"], string> = {
  free: "No specific format required.",
  json: "A single valid JSON object.",
  markdown: "Markdown with headings and/or lists.",
  bullets: "A bullet list.",
  "single-line": "A single line of text.",
  custom: "Custom format (see details).",
};

export function describeFormat(c: ExperimentConfig): string {
  return [FORMAT_TEXT[c.outputFormat], c.formatDetails?.trim()].filter(Boolean).join("\n");
}

export function describeConstraints(c: ExperimentConfig): string {
  const k = c.constraints;
  const lines: string[] = [];
  if (k.maxWords) lines.push(`At most ${k.maxWords} words.`);
  if (k.minWords) lines.push(`At least ${k.minWords} words.`);
  if (k.mustInclude.length) lines.push(`Must include: ${k.mustInclude.map((s) => `"${s}"`).join(", ")}.`);
  if (k.mustNotInclude.length) lines.push(`Must not include: ${k.mustNotInclude.map((s) => `"${s}"`).join(", ")}.`);
  if (k.requiredJsonKeys.length) lines.push(`Required JSON keys: ${k.requiredJsonKeys.join(", ")}.`);
  return lines.length ? lines.join("\n") : "None.";
}

/** How the prompt under test is combined with a test input for execution. */
export function buildExecutionMessages(prompt: string, input: string): { system?: string; user: string } {
  const safeInput = input.trim() ? input : "[empty input]";
  if (prompt.includes("{{input}}")) return { user: prompt.split("{{input}}").join(safeInput) };
  return { system: prompt, user: safeInput };
}
