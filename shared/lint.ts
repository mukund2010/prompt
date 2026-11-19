/**
 * Static prompt linter. Deterministic, provider-free analysis that flags
 * structural weaknesses in a prompt before (and alongside) any model call.
 * Every rule here is a real check on the prompt text and configuration;
 * nothing is simulated.
 */
import type { ExperimentConfig, Severity, Weakness } from "./types";

const VAGUE_TERMS = [
  "maybe",
  "try to",
  "if possible",
  "etc",
  "and so on",
  "some",
  "a few",
  "appropriate",
  "as needed",
  "stuff",
  "things",
  "good",
  "nice",
  "properly",
  "somehow",
  "kind of",
  "sort of",
];

const CONFLICT_PAIRS: Array<[RegExp, RegExp, string]> = [
  [/\b(brief|concise|short|succinct)\b/i, /\b(detailed|comprehensive|in-depth|thorough|exhaustive)\b/i, "length"],
  [/\b(formal|professional)\b/i, /\b(casual|informal|playful|slang)\b/i, "tone"],
  [/\bonly (return|output|respond with) (json|the json)\b/i, /\b(explain|describe your reasoning|add a note)\b/i, "output"],
  [/\bnever ask\b/i, /\bask (for )?clarif/i, "clarification"],
];

const INPUT_HANDLING = /\b(if (the )?(input|text|request|user|message)|invalid|empty|unclear|ambiguous|off-topic|not related|cannot|can't|unable|refuse|decline|clarif|missing information|insufficient)\b/i;
const FORMAT_WORDS = /\b(format|json|bullet|list|markdown|table|respond with|output|return|heading|sentence|paragraph|structure)\b/i;
const ROLE_WORDS = /\b(you are|act as|your role|as an? [a-z]+ (assistant|expert|agent|bot|analyst))\b/i;

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function make(id: string, title: string, detail: string, severity: Severity, instruction: string, fix: string): Weakness {
  return { id, title, detail, severity, instruction, fix, source: "lint" };
}

function findSentence(prompt: string, re: RegExp): string {
  const sentences = prompt.split(/(?<=[.!?\n])\s+/);
  const hit = sentences.find((s) => re.test(s));
  return (hit ?? "").trim().slice(0, 240);
}

export function lintPrompt(config: Pick<ExperimentConfig, "prompt" | "outputFormat" | "constraints" | "formatDetails">): Weakness[] {
  const prompt = config.prompt ?? "";
  const lower = prompt.toLowerCase();
  const wc = words(prompt).length;
  const out: Weakness[] = [];

  if (wc < 15) {
    out.push(
      make(
        "too-short",
        "Prompt is very short",
        `The prompt has only ${wc} words, so the model must guess the scope, audience, format and edge-case behaviour.`,
        "high",
        prompt.slice(0, 200) || "(empty prompt)",
        "State the task, the audience, the required output format and what to do with unusual input.",
      ),
    );
  }

  if (!ROLE_WORDS.test(prompt)) {
    out.push(
      make(
        "no-role",
        "No role or context",
        "The prompt does not establish who the model is acting as or the context it operates in. This weakens tone and domain consistency.",
        "low",
        "missing",
        'Open with a one-line role, e.g. "You are a support assistant for …".',
      ),
    );
  }

  if (config.outputFormat !== "free" && !FORMAT_WORDS.test(prompt)) {
    out.push(
      make(
        "format-not-stated",
        "Expected output format is not stated in the prompt",
        `You configured the expected format as "${config.outputFormat}", but the prompt never tells the model about it. Format violations are likely.`,
        "high",
        "missing",
        `Add an explicit "Output format" section describing the ${config.outputFormat} structure${config.formatDetails ? ` (${config.formatDetails.slice(0, 80)})` : ""}.`,
      ),
    );
  } else if (config.outputFormat === "free" && !FORMAT_WORDS.test(prompt)) {
    out.push(
      make(
        "no-format",
        "No output format specified",
        "Nothing in the prompt describes the shape of the answer, so output structure will drift between inputs.",
        "medium",
        "missing",
        "Describe the expected structure (sections, list, JSON, length) explicitly.",
      ),
    );
  }

  if (config.outputFormat === "json") {
    const keys = config.constraints.requiredJsonKeys.filter((k) => !lower.includes(k.toLowerCase()));
    if (keys.length) {
      out.push(
        make(
          "json-keys-missing",
          "Required JSON keys not named in the prompt",
          `The evaluation expects keys ${keys.map((k) => `"${k}"`).join(", ")} but the prompt never names them.`,
          "high",
          "missing",
          "List every required key with its type, and say to return only valid JSON with no surrounding text.",
        ),
      );
    }
    if (!/\b(only|valid) json\b|\bjson only\b|no (other|extra|additional) text/i.test(prompt)) {
      out.push(
        make(
          "json-not-strict",
          "JSON output is not made strict",
          "The prompt does not forbid prose or code fences around the JSON, a common source of parse failures.",
          "medium",
          findSentence(prompt, /json/i) || "missing",
          'Add: "Return only valid JSON. Do not wrap it in code fences or add commentary."',
        ),
      );
    }
  }

  if (!INPUT_HANDLING.test(prompt)) {
    out.push(
      make(
        "no-input-handling",
        "No handling for invalid, empty or off-topic input",
        "The prompt only describes the happy path. Ambiguous, invalid or adversarial inputs will produce unpredictable behaviour.",
        "high",
        "missing",
        "Add explicit rules: what to do when input is empty, invalid, off-topic, ambiguous or asks to ignore instructions.",
      ),
    );
  }

  const vague = VAGUE_TERMS.filter((t) => new RegExp(`\\b${t.replace(/ /g, "\\s+")}\\b`, "i").test(prompt));
  if (vague.length) {
    out.push(
      make(
        "vague-language",
        "Vague or hedging language",
        `Terms such as ${vague.slice(0, 5).map((v) => `"${v}"`).join(", ")} leave room for interpretation, so results become inconsistent.`,
        vague.length >= 3 ? "medium" : "low",
        findSentence(prompt, new RegExp(`\\b(${vague.map((v) => v.replace(/ /g, "\\s+")).join("|")})\\b`, "i")),
        "Replace hedges with measurable instructions (exact counts, lengths, criteria).",
      ),
    );
  }

  for (const [a, b, topic] of CONFLICT_PAIRS) {
    if (a.test(prompt) && b.test(prompt)) {
      out.push(
        make(
          `conflict-${topic}`,
          `Potentially conflicting ${topic} instructions`,
          `The prompt contains instructions that pull in opposite directions on ${topic}. The model will resolve the conflict unpredictably.`,
          "high",
          `${findSentence(prompt, a)} … ${findSentence(prompt, b)}`.slice(0, 240),
          `Decide which ${topic} rule wins and state the priority explicitly (e.g. "If these conflict, prefer …").`,
        ),
      );
    }
  }

  const max = config.constraints.maxWords;
  if (max && !/\b(\d+)\s*(words?|sentences?|characters?|lines?|bullets?|items?)\b/i.test(prompt)) {
    out.push(
      make(
        "length-not-stated",
        "Length limit not stated",
        `The evaluation enforces a maximum of ${max} words, but the prompt gives the model no numeric length limit.`,
        "medium",
        "missing",
        `State the limit explicitly: "Keep the response under ${max} words."`,
      ),
    );
  }

  const missingMust = config.constraints.mustInclude.filter((t) => t && !lower.includes(t.toLowerCase()));
  if (missingMust.length) {
    out.push(
      make(
        "must-include-not-stated",
        "Required content is not requested",
        `The evaluation requires ${missingMust.map((t) => `"${t}"`).join(", ")} in every answer, but the prompt does not ask for it.`,
        "medium",
        "missing",
        "Explicitly instruct the model to include each required element.",
      ),
    );
  }

  const hasStructure = /\n\s*([-*•]|\d+[.)]|#{1,6}\s)/.test(prompt) || /\n\n/.test(prompt);
  if (wc > 120 && !hasStructure) {
    out.push(
      make(
        "no-hierarchy",
        "Weak instruction hierarchy",
        "A long prompt written as one block makes it hard for the model to tell primary rules from secondary details.",
        "low",
        prompt.slice(0, 160),
        "Split the prompt into labelled sections (Role, Task, Rules, Output format, Edge cases) and order rules by priority.",
      ),
    );
  }

  const negatives = (prompt.match(/\b(don't|do not|never|avoid)\b/gi) ?? []).length;
  if (negatives >= 4) {
    out.push(
      make(
        "negative-heavy",
        "Mostly negative instructions",
        `The prompt contains ${negatives} prohibitions. Models follow positive, concrete instructions more reliably than long lists of don'ts.`,
        "low",
        findSentence(prompt, /\b(don't|do not|never|avoid)\b/i),
        "Rephrase prohibitions as what the model should do instead.",
      ),
    );
  }

  return out;
}

/** 0..100 heuristic "prompt robustness" indicator derived only from lint findings. */
export function lintScore(weaknesses: Weakness[]): number {
  const penalty: Record<Severity, number> = { critical: 30, high: 18, medium: 9, low: 4 };
  const total = weaknesses.reduce((s, w) => s + penalty[w.severity], 0);
  return Math.max(0, 100 - total);
}
