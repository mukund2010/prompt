import type { z } from "zod";
import type { LLMProvider } from "../providers/types";

/** Extracts the first JSON object/array from model text (tolerates fences and prose). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = t.search(/[{[]/);
  if (start === -1) throw new Error("No JSON found in the model response.");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("Unterminated JSON in the model response.");
}

/**
 * Calls a provider expecting JSON that matches `schema`. On a parse or
 * validation failure it retries once, telling the model what was wrong.
 * Provider-neutral: works with any LLMProvider.
 */
export async function completeJson<T>(
  provider: LLMProvider,
  opts: { system?: string; user: string; purpose: "generate" | "judge" | "optimize"; maxTokens?: number },
  schema: z.ZodType<T>,
): Promise<T> {
  let user = opts.user;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await provider.complete({ system: opts.system, user, purpose: opts.purpose, maxTokens: opts.maxTokens });
    if (res.stopReason === "refusal") throw new Error("The analyst model declined this request (refusal).");
    try {
      const parsed = schema.safeParse(extractJson(res.text));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = (e as Error).message;
    }
    user = `${opts.user}\n\nYour previous reply could not be used: ${lastError}. Reply again with only the JSON object in the required shape.`;
  }
  throw new Error(`The analyst model did not return valid JSON: ${lastError}`);
}
