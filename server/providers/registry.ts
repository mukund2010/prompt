/**
 * Provider registry: the single place that knows which providers exist,
 * how they are configured, and which one serves each role.
 * API keys come from the environment or from a session-only override held in
 * memory. Keys are never persisted to disk and never returned to the client.
 */
import fs from "node:fs";
import path from "node:path";
import type { ProviderId, ProviderRole, ProviderSettings, ProviderStatus, ProvidersResponse } from "../../shared/types";
import { AnthropicProvider } from "./anthropic";
import { DemoProvider } from "./demo";
import { GeminiProvider, listGeminiModels, pickBestPro, type GeminiModelInfo } from "./gemini";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { LLMProvider } from "./types";

interface SessionOverrides {
  anthropicKey?: string;
  anthropicModel?: string;
  geminiKey?: string;
  geminiModel?: string;
  openaiBaseUrl?: string;
  openaiKey?: string;
  openaiModel?: string;
}

const PROVIDER_IDS: ProviderId[] = ["anthropic", "gemini", "openai-compatible", "demo"];
export const DEFAULT_GEMINI_MODEL = "gemini-4-hydrogen";
const demo = new DemoProvider();

export class ProviderRegistry {
  private overrides: SessionOverrides = {};
  private settings: ProviderSettings;

  constructor(private settingsFile: string) {
    this.settings = {
      executor: asProviderId(process.env.DEFAULT_EXECUTOR) ?? "demo",
      analyst: asProviderId(process.env.DEFAULT_ANALYST) ?? "demo",
      geminiOnlyGeneration: process.env.GEMINI_ONLY_GENERATION === "true",
    };
    try {
      const saved = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Partial<ProviderSettings & { anthropicModel: string; geminiModel: string; openaiModel: string; openaiBaseUrl: string }>;
      if (asProviderId(saved.executor)) this.settings.executor = saved.executor!;
      if (asProviderId(saved.analyst)) this.settings.analyst = saved.analyst!;
      if (typeof saved.geminiOnlyGeneration === "boolean") this.settings.geminiOnlyGeneration = saved.geminiOnlyGeneration;
      if (saved.anthropicModel) this.overrides.anthropicModel = saved.anthropicModel;
      if (saved.geminiModel) this.overrides.geminiModel = saved.geminiModel;
      if (saved.openaiModel) this.overrides.openaiModel = saved.openaiModel;
      if (saved.openaiBaseUrl) this.overrides.openaiBaseUrl = saved.openaiBaseUrl;
    } catch {
      /* no saved settings yet */
    }
  }

  private anthropicConfig() {
    const key = this.overrides.anthropicKey || process.env.ANTHROPIC_API_KEY || "";
    return {
      key,
      keySource: (this.overrides.anthropicKey ? "session" : process.env.ANTHROPIC_API_KEY ? "env" : "none") as ProviderStatus["keySource"],
      model: this.overrides.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      effort: (process.env.ANTHROPIC_EFFORT || "medium") as "low" | "medium" | "high" | "xhigh" | "max",
    };
  }

  private geminiConfig() {
    const key = this.overrides.geminiKey || process.env.GEMINI_API_KEY || "";
    return {
      key,
      keySource: (this.overrides.geminiKey ? "session" : process.env.GEMINI_API_KEY ? "env" : "none") as ProviderStatus["keySource"],
      model: this.overrides.geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      baseUrl: process.env.GEMINI_BASE_URL || undefined,
    };
  }

  private openaiConfig() {
    const key = this.overrides.openaiKey || process.env.OPENAI_COMPAT_API_KEY || "";
    return {
      baseUrl: this.overrides.openaiBaseUrl || process.env.OPENAI_COMPAT_BASE_URL || "",
      key,
      keySource: (this.overrides.openaiKey ? "session" : process.env.OPENAI_COMPAT_API_KEY ? "env" : "none") as ProviderStatus["keySource"],
      model: this.overrides.openaiModel || process.env.OPENAI_COMPAT_MODEL || "",
    };
  }

  status(): ProviderStatus[] {
    const a = this.anthropicConfig();
    const g = this.geminiConfig();
    const o = this.openaiConfig();
    return [
      {
        id: "gemini",
        label: "Google Gemini",
        configured: Boolean(g.key),
        model: g.model,
        isDemo: false,
        keySource: g.keySource,
        detail: g.key ? `Using ${g.model}.` : "Add a Gemini API key below, or set GEMINI_API_KEY in .env.",
      },
      {
        id: "anthropic",
        label: "Anthropic Claude",
        configured: Boolean(a.key),
        model: a.model,
        isDemo: false,
        keySource: a.keySource,
        detail: a.key ? `Using ${a.model} (effort: ${a.effort}).` : "Set ANTHROPIC_API_KEY in .env or add a session key.",
      },
      {
        id: "openai-compatible",
        label: "OpenAI-compatible endpoint",
        configured: Boolean(o.baseUrl && o.model),
        model: o.model || "(not set)",
        isDemo: false,
        keySource: o.keySource,
        detail: o.baseUrl && o.model ? `${o.baseUrl} · ${o.model}` : "Set OPENAI_COMPAT_BASE_URL and OPENAI_COMPAT_MODEL (key optional for local servers).",
      },
      {
        id: "demo",
        label: "Demo simulator",
        configured: true,
        model: demo.model,
        isDemo: true,
        keySource: "none",
        detail: "Offline deterministic simulator. Results are demonstration data, not real model output.",
      },
    ];
  }

  get(id: ProviderId): LLMProvider {
    if (id === "anthropic") {
      const a = this.anthropicConfig();
      if (!a.key) throw new Error("Anthropic is not configured. Add ANTHROPIC_API_KEY or a session key in Settings.");
      return new AnthropicProvider(a.key, a.model, a.effort);
    }
    if (id === "gemini") {
      const g = this.geminiConfig();
      if (!g.key) throw new Error("Gemini is not configured. Add GEMINI_API_KEY or a session key in Settings.");
      return new GeminiProvider(g.key, g.model, g.baseUrl);
    }
    if (id === "openai-compatible") {
      const o = this.openaiConfig();
      if (!o.baseUrl || !o.model) throw new Error("The OpenAI-compatible endpoint is not configured. Set its base URL and model in Settings or .env.");
      return new OpenAICompatibleProvider(o.baseUrl, o.key, o.model);
    }
    return demo;
  }

  forRole(role: ProviderRole): LLMProvider {
    if (role === "analyst" && this.settings.geminiOnlyGeneration) return this.generationProvider();
    return this.get(this.settings[role]);
  }

  /** Models the active Gemini key can use, plus the best Pro model among them. */
  async geminiModels(): Promise<{ models: GeminiModelInfo[]; suggestedPro?: string; current: string }> {
    const g = this.geminiConfig();
    if (!g.key) throw new Error("Add a Gemini API key first.");
    const models = await listGeminiModels(g.key, g.baseUrl);
    return { models, suggestedPro: pickBestPro(models.map((m) => m.id)), current: g.model };
  }

  /**
   * The provider used for test generation, judging and prompt optimisation.
   * With Gemini-only generation on, this is always Gemini; if no Gemini key is
   * active it throws instead of silently using the rule-based generator.
   */
  generationProvider(): LLMProvider {
    if (!this.settings.geminiOnlyGeneration) return this.get(this.settings.analyst);
    if (!this.geminiConfig().key)
      throw new Error(
        "Gemini-only generation is on, but no Gemini API key is active. Paste your key in Settings & Providers → Google Gemini. Keys entered in the browser are cleared when the server restarts; put GEMINI_API_KEY in .env to keep one.",
      );
    return this.get("gemini");
  }

  describe(): ProvidersResponse {
    const executorDemo = this.settings.executor === "demo";
    return { providers: this.status(), settings: { ...this.settings }, mode: executorDemo ? "demo" : "live" };
  }

  update(input: Partial<ProviderSettings> & SessionOverrides): ProvidersResponse {
    const next = { ...this.settings };
    for (const role of ["executor", "analyst"] as const) {
      const v = input[role];
      if (v !== undefined) {
        const id = asProviderId(v);
        if (!id) throw new Error(`Unknown provider "${v}".`);
        next[role] = id;
      }
    }
    if (typeof input.geminiOnlyGeneration === "boolean") next.geminiOnlyGeneration = input.geminiOnlyGeneration;
    if (next.geminiOnlyGeneration && next.analyst !== "gemini") {
      if (input.analyst !== undefined && input.analyst !== "gemini")
        throw new Error("Gemini-only generation is on, so the analyst must be Google Gemini. Turn the lock off in the Gemini card first.");
      next.analyst = "gemini";
    }
    // Apply credential changes tentatively; roll back if the resulting role setup is invalid.
    const previous = { ...this.overrides };
    for (const k of ["anthropicKey", "anthropicModel", "geminiKey", "geminiModel", "openaiBaseUrl", "openaiKey", "openaiModel"] as const) {
      const v = input[k];
      if (typeof v === "string") this.overrides[k] = v.trim() || undefined;
    }
    const status = this.status();
    for (const role of ["executor", "analyst"] as const) {
      const s = status.find((p) => p.id === next[role]);
      if (!s?.configured) {
        this.overrides = previous;
        throw new Error(`${s?.label ?? next[role]} is not configured yet, so it cannot be used as the ${role}.`);
      }
    }
    this.settings = next;
    this.persist();
    return this.describe();
  }

  private persist() {
    // Persist only non-secret choices.
    const data = {
      executor: this.settings.executor,
      analyst: this.settings.analyst,
      geminiOnlyGeneration: this.settings.geminiOnlyGeneration,
      anthropicModel: this.overrides.anthropicModel,
      geminiModel: this.overrides.geminiModel,
      openaiModel: this.overrides.openaiModel,
      openaiBaseUrl: this.overrides.openaiBaseUrl,
    };
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(data, null, 2));
  }
}

function asProviderId(v: unknown): ProviderId | null {
  return PROVIDER_IDS.includes(v as ProviderId) ? (v as ProviderId) : null;
}
