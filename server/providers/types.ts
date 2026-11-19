import type { ProviderId } from "../../shared/types";

export interface CompletionRequest {
  /** System / developer instructions. Optional. */
  system?: string;
  /** The user message. */
  user: string;
  maxTokens?: number;
  /** What the call is for: used for logging and by the demo simulator. */
  purpose: "execute" | "generate" | "judge" | "optimize" | "ping";
}

export interface CompletionResult {
  text: string;
  model: string;
  latencyMs: number;
  /** Provider-reported stop reason, normalised where possible ("end_turn", "max_tokens", "refusal", ...). */
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * The only contract the rest of the application depends on.
 * Add a provider by implementing this interface and registering it in registry.ts.
 */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  /** Demo providers never call a real model; their output is simulated and must be labelled as such. */
  readonly isDemo: boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderId,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
