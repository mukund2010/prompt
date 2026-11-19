import Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";
import { ProviderError } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Models that accept the server-side `fallbacks` parameter (refusal fallback). */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Models that accept `output_config.effort`. */
const EFFORT_MODELS = /^claude-(opus|fable|mythos|sonnet-5|haiku-5)/;

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic Claude";
  readonly isDemo = false;
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    private effort: Effort | undefined,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    try {
      const useFallbacks = FALLBACK_MODELS.has(this.model);
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 16000,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.user }],
        ...(this.effort && EFFORT_MODELS.test(this.model) ? { output_config: { effort: this.effort } } : {}),
        // Server-side refusal fallback: on a policy decline the API re-runs the
        // request on a fallback model inside the same call.
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });

      const text = response.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();

      return {
        text,
        model: response.model,
        latencyMs: Date.now() - started,
        stopReason: response.stop_reason ?? undefined,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }
}

function mapAnthropicError(error: unknown): ProviderError {
  if (error instanceof Anthropic.AuthenticationError)
    return new ProviderError("Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.", "anthropic", false, 401);
  if (error instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("The API key does not have permission for this model (403).", "anthropic", false, 403);
  if (error instanceof Anthropic.NotFoundError)
    return new ProviderError("Model not found (404). Check ANTHROPIC_MODEL.", "anthropic", false, 404);
  if (error instanceof Anthropic.RateLimitError)
    return new ProviderError("Rate limited by Anthropic (429). Retry shortly or reduce test count.", "anthropic", true, 429);
  if (error instanceof Anthropic.BadRequestError)
    return new ProviderError(`Request rejected (400): ${error.message}`, "anthropic", false, 400);
  if (error instanceof Anthropic.APIConnectionError)
    return new ProviderError("Could not reach the Anthropic API (network error).", "anthropic", true);
  if (error instanceof Anthropic.APIError)
    return new ProviderError(`Anthropic API error ${error.status ?? ""}: ${error.message}`, "anthropic", (error.status ?? 0) >= 500, error.status);
  return new ProviderError(error instanceof Error ? error.message : String(error), "anthropic");
}
