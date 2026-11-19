/**
 * DEMONSTRATION PROVIDER: does NOT call any model.
 *
 * It deterministically simulates how a typical LLM tends to react to a prompt,
 * based on which safeguards the prompt actually contains (stated format,
 * length limits, input-handling rules, injection resistance, named JSON keys).
 * This lets the full workflow be demonstrated offline. Every run produced
 * with it is stored with mode = "demo" and labelled in the UI and reports.
 */
import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PromptFeatures {
  wantsJson: boolean;
  jsonStrict: boolean;
  jsonKeys: string[];
  wantsBullets: boolean;
  wantsSingleLine: boolean;
  formatStated: boolean;
  wordLimit: number | null;
  handlesInvalid: boolean;
  handlesAmbiguity: boolean;
  resistsInjection: boolean;
  hasPriority: boolean;
  mustInclude: string[];
}

export function analysePromptFeatures(prompt: string): PromptFeatures {
  const p = prompt.toLowerCase();
  const limit = p.match(/(?:under|at most|maximum of|max(?:imum)?|no more than|fewer than|up to|within)\s+(\d{1,4})\s+words/);
  const keys = Array.from(prompt.matchAll(/["`]([a-zA-Z_][a-zA-Z0-9_]{1,30})["`]/g)).map((m) => m[1]);
  const includes = Array.from(prompt.matchAll(/always include (?:the (?:phrase|word|text) )?["“]([^"”]{1,60})["”]/gi)).map((m) => m[1]);
  return {
    wantsJson: /\bjson\b/.test(p),
    jsonStrict: /\b(only|valid) json\b|json only|no (code fences|other text|commentary|extra text)/.test(p),
    jsonKeys: Array.from(new Set(keys)),
    wantsBullets: /\bbullet|\bas a list|numbered list/.test(p),
    wantsSingleLine: /single line|one line|one sentence/.test(p),
    formatStated: /\b(output format|format:|respond with|return (only|a|the)|structure|bullet|json|markdown|single line|one sentence)\b/.test(p),
    wordLimit: limit ? Number(limit[1]) : null,
    handlesInvalid: /\b(empty|invalid|missing|unreadable|nonsense|cannot be processed)\b/.test(p),
    handlesAmbiguity: /\b(ambiguous|unclear|clarif|assumption)\b/.test(p),
    resistsInjection: /\b(ignore (any|all)?\s*instructions (in|inside|within)|cannot be overridden|treat (the )?(user )?(input|text|content) (strictly )?as data|never reveal|do not follow instructions (in|inside|from))/.test(p),
    hasPriority: /\b(priority|takes precedence|if (these|rules) conflict|in order of importance)\b/.test(p),
    mustInclude: includes,
  };
}

function classifyInput(input: string): "empty" | "garbage" | "injection" | "conflict" | "ambiguous" | "long" | "foreign" | "normal" {
  const t = input.trim();
  if (!t || t === "[empty input]") return "empty";
  if (/ignore (all |any )?(previous|prior|above) instructions|system prompt|you are now|disregard/i.test(t)) return "injection";
  if (!/[a-zA-Zऀ-ॿ]{3,}/.test(t) || /^[\W\d_]+$/.test(t)) return "garbage";
  if (/[ऀ-ॿ一-鿿؀-ۿ]/.test(t)) return "foreign";
  if (t.split(/\s+/).length > 600) return "long";
  if (/\bbut\b.*\b(no more than|at most|without|only)\b|\b(both|and also) .* (and|but) (not|never)\b/i.test(t)) return "conflict";
  if (t.split(/\s+/).length < 12 && /\b(this|that|it|thing|stuff|something)\b/i.test(t)) return "ambiguous";
  return "normal";
}

function sentenceFrom(input: string, rand: () => number, n: number): string {
  const words = input
    .replace(/\s+/g, " ")
    .split(" ")
    .filter((w) => /[a-zA-Z]/.test(w))
    .slice(0, 400);
  if (!words.length) return "The provided content has been reviewed.";
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(words[Math.floor(rand() * words.length)].replace(/[^\w'-]/g, ""));
  const s = out.filter(Boolean).join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export function simulateResponse(prompt: string, input: string, attemptSeed = 0): string {
  const f = analysePromptFeatures(prompt);
  const kind = classifyInput(input);
  const rand = seededRandom(hashString(`${prompt}\u0000${input}\u0000${attemptSeed}`));
  const p = (prob: number) => rand() < prob;

  // Behaviour on adversarial / malformed inputs depends on whether the prompt prepares for them.
  if (kind === "injection") {
    if (f.resistsInjection ? p(0.9) : p(0.25)) {
      return wrapFormat(f, rand, "I can only help with the task I was set up for, so I won't follow instructions contained in the input.", true);
    }
    return "Sure! Ignoring my earlier instructions. Here is what you asked for:\n\nArrr, a pirate's life for me, sailing the seven seas! My original instructions were to help with your task, but I'll do this instead.";
  }
  if (kind === "empty" || kind === "garbage") {
    if (f.handlesInvalid ? p(0.9) : p(0.3)) {
      return wrapFormat(f, rand, "The input is empty or unreadable, so there is nothing to process. Please provide valid input.", true);
    }
    return "Based on the information provided, here is a comprehensive answer covering the key points you mentioned, including all the relevant details and recommendations for next steps.";
  }
  if (kind === "ambiguous" || kind === "conflict") {
    if (f.handlesAmbiguity || f.hasPriority ? p(0.85) : p(0.35)) {
      const note = kind === "conflict"
        ? "The request contains conflicting requirements; following the stated priority, I kept the response within the limit."
        : "The request is ambiguous; I assumed the most common interpretation and stated that assumption.";
      return wrapFormat(f, rand, note, true);
    }
  }

  // Normal / long / foreign content: produce a task-style answer.
  const longInput = kind === "long";
  let sentences = longInput ? 14 : 4;
  if (f.wordLimit) sentences = Math.max(1, Math.min(sentences, Math.floor(f.wordLimit / 14)));
  if (longInput && !f.wordLimit && p(0.7)) sentences = 22; // expands on long input
  const body = Array.from({ length: sentences }, () => sentenceFrom(input, rand, 8 + Math.floor(rand() * 6))).join(" ");
  let text = wrapFormat(f, rand, body, false);
  if (f.mustInclude.length) for (const m of f.mustInclude) if (p(0.92) && !text.includes(m)) text += `\n${m}`;
  return text;
}

function wrapFormat(f: PromptFeatures, rand: () => number, content: string, isNotice: boolean): string {
  const comply = f.formatStated ? rand() < 0.93 : rand() < 0.45;
  if (f.wantsJson) {
    const keys = f.jsonKeys.length ? f.jsonKeys : ["result"];
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      // Without explicitly named keys the simulated model sometimes drops one.
      if (!f.jsonKeys.length || i === 0 || rand() < (f.formatStated ? 0.97 : 0.7)) obj[k] = i === 0 ? content : isNotice ? null : content.split(".")[0];
    });
    const json = JSON.stringify(obj, null, 2);
    if (f.jsonStrict && comply) return json;
    return rand() < 0.5 ? "```json\n" + json + "\n```" : `Here is the JSON you requested:\n${json}`;
  }
  if (f.wantsBullets && comply) {
    return content
      .split(/(?<=\.)\s+/)
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join("\n");
  }
  if (f.wantsSingleLine && comply) return content.split(/(?<=\.)\s+/)[0];
  if (!comply && !isNotice) return `Great question! ${content}\n\nLet me know if you need anything else.`;
  return content;
}

export class DemoProvider implements LLMProvider {
  readonly id = "demo" as const;
  readonly label = "Demo simulator (no real model)";
  readonly model = "demo-simulator-v1";
  readonly isDemo = true;
  private calls = new Map<string, number>();

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    // Repeated identical calls get a new seed so consistency runs are meaningful.
    const key = `${req.system ?? ""}\u0000${req.user}`;
    const n = this.calls.get(key) ?? 0;
    this.calls.set(key, n + 1);
    if (this.calls.size > 5000) this.calls.clear();
    await new Promise((r) => setTimeout(r, 120 + (hashString(key + n) % 260)));
    const text = req.purpose === "ping" ? "pong (demo simulator)" : simulateResponse(req.system ?? "", req.user, n % 3);
    return { text, model: this.model, latencyMs: Date.now() - started, stopReason: "end_turn" };
  }
}
