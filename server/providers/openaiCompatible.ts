import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";
import { ProviderError } from "./types";

/**
 * Generic adapter for any server implementing the OpenAI-style
 * `POST {baseUrl}/chat/completions` endpoint (OpenAI, OpenRouter, Groq,
 * Together, LM Studio, Ollama, vLLM, ...). Uses plain fetch, no vendor SDK.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai-compatible" as const;
  readonly label = "OpenAI-compatible endpoint";
  readonly isDemo = false;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    readonly model: string,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.user },
    ];
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.model, messages }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new ProviderError(`Could not reach ${url}: ${(e as Error).message}`, this.id, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      const hint = res.status === 401 ? " Check OPENAI_COMPAT_API_KEY." : res.status === 404 ? " Check the base URL and model name." : "";
      throw new ProviderError(`Endpoint returned ${res.status}.${hint} ${body.slice(0, 300)}`, this.id, retryable, res.status);
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    if (!choice) throw new ProviderError("Endpoint returned no choices.", this.id);
    return {
      text: (choice.message?.content ?? "").trim(),
      model: data.model ?? this.model,
      latencyMs: Date.now() - started,
      stopReason: choice.finish_reason,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}
