import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";
import { ProviderError } from "./types";

export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Google Gemini adapter using the native REST API:
 * `POST {baseUrl}/models/{model}:generateContent` with the key in the
 * `x-goog-api-key` header (never in the URL, so it can't leak into logs).
 * Plain fetch, no vendor SDK.
 *
 * "High demand" (503) and rate limits (429) are retried with backoff before
 * the error is surfaced.
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";
  readonly isDemo = false;

  constructor(
    private apiKey: string,
    readonly model: string,
    private baseUrl = GEMINI_DEFAULT_BASE,
    /** Waits before each retry of a 503/429. Two retries by default. */
    private retryDelaysMs: number[] = [2500, 6000],
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const model = this.model.replace(/^models\//, "");
    const url = `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
    const body = JSON.stringify({
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      // Thinking models count reasoning against this limit, so keep a floor
      // that leaves room for an actual answer even on short calls (e.g. ping).
      generationConfig: { maxOutputTokens: Math.max(req.maxTokens ?? 16000, 2048) },
    });

    let res: Response | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body,
          signal: AbortSignal.timeout(180_000),
        });
      } catch (e) {
        throw new ProviderError(`Could not reach the Gemini API: ${(e as Error).message}`, this.id, true);
      }
      const busy = res.status === 503 || res.status === 429;
      if (!busy || attempt >= this.retryDelaysMs.length) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : this.retryDelaysMs[attempt]);
    }

    if (!res.ok) throw await geminiError(res, model);

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      modelVersion?: string;
    };

    const usage = { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount };
    if (data.promptFeedback?.blockReason) {
      return { text: "", model: data.modelVersion ?? model, latencyMs: Date.now() - started, stopReason: "refusal", ...usage };
    }
    const cand = data.candidates?.[0];
    if (!cand) throw new ProviderError("Gemini returned no candidates.", this.id);
    const text = (cand.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();

    return { text, model: data.modelVersion ?? model, latencyMs: Date.now() - started, stopReason: mapFinish(cand.finishReason), ...usage };
  }
}

/* ---------------- Model discovery ---------------- */

export interface GeminiModelInfo {
  id: string;
  displayName: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/** Lists the models this key can call with generateContent. */
export async function listGeminiModels(apiKey: string, baseUrl = GEMINI_DEFAULT_BASE): Promise<GeminiModelInfo[]> {
  const out: GeminiModelInfo[] = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const url = `${baseUrl.replace(/\/+$/, "")}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new ProviderError(`Could not reach the Gemini API: ${(e as Error).message}`, "gemini", true);
    }
    if (!res.ok) throw await geminiError(res, "");
    const data = (await res.json()) as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number; outputTokenLimit?: number }>;
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
      out.push({ id: m.name.replace(/^models\//, ""), displayName: m.displayName ?? m.name, inputTokenLimit: m.inputTokenLimit, outputTokenLimit: m.outputTokenLimit });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

/**
 * Picks the newest general-purpose Gemini "Pro" text model from a list of ids.
 * Highest version wins; at equal version a stable release beats a preview,
 * then the shorter (undated) name wins.
 */
export function pickBestPro(ids: string[]): string | undefined {
  const special = /(tts|image|vision|embed|audio|live|native|computer|robotics|learnlm|customtools|thinking-exp)/i;
  const version = (id: string) => {
    const m = /gemini-(\d+(?:\.\d+)?)/i.exec(id);
    return m ? parseFloat(m[1]) : 0;
  };
  const unstable = (id: string) => (/(preview|exp)/i.test(id) ? 1 : 0);
  return ids
    .filter((id) => /^gemini/i.test(id) && /(^|-)pro($|-)/i.test(id) && !special.test(id))
    .sort((a, b) => version(b) - version(a) || unstable(a) - unstable(b) || a.length - b.length || a.localeCompare(b))[0];
}

/* ---------------- Helpers ---------------- */

async function geminiError(res: Response, model: string): Promise<ProviderError> {
  const raw = await res.text().catch(() => "");
  let message = raw.slice(0, 300);
  try {
    message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? message;
  } catch {
    /* not JSON */
  }
  const s = res.status;
  const hint =
    s === 400 && /api key/i.test(message)
      ? " Check the Gemini API key."
      : s === 403
        ? " The key does not have access to this model or API."
        : s === 404
          ? ` Model "${model}" was not found. Pick a model from the list in Settings.`
          : s === 503
            ? ` Model "${model}" is overloaded (high demand on Google's side). Retried automatically without success. Wait a minute, or switch to another model (for example the best Pro model) in Settings.`
            : s === 429
              ? " Rate limit or quota reached. Retried automatically without success; wait a minute or check your plan's quota."
              : "";
  return new ProviderError(`Gemini returned ${s}.${hint} ${message}`.trim(), "gemini", s === 429 || s >= 500, s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mapFinish(reason?: string): string | undefined {
  switch (reason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "refusal";
    default:
      return reason?.toLowerCase();
  }
}
