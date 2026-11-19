import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider, listGeminiModels, pickBestPro } from "../server/providers/gemini";
import { ProviderRegistry } from "../server/providers/registry";
import { ProviderError } from "../server/providers/types";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("GeminiProvider", () => {
  it("G1 sends system + user to generateContent with the key in a header, not the URL", async () => {
    const fn = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: " pong " }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
      modelVersion: "gemini-4-hydrogen",
    });
    const p = new GeminiProvider("test-key", "gemini-4-hydrogen");
    const r = await p.complete({ system: "Be terse.", user: "ping", purpose: "ping", maxTokens: 50 });

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const sent = JSON.parse(init.body as string);
    expect(sent.systemInstruction.parts[0].text).toBe("Be terse.");
    expect(sent.contents[0]).toEqual({ role: "user", parts: [{ text: "ping" }] });
    expect(sent.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048); // floor for thinking models

    expect(r.text).toBe("pong"); // thought parts excluded
    expect(r.stopReason).toBe("end_turn");
    expect(r.inputTokens).toBe(12);
    expect(r.outputTokens).toBe(3);
  });

  it("G2 maps safety blocks to a refusal and errors to ProviderError with hints", async () => {
    mockFetch(200, { promptFeedback: { blockReason: "SAFETY" } });
    const blocked = await new GeminiProvider("k", "m").complete({ user: "x", purpose: "execute" });
    expect(blocked).toMatchObject({ text: "", stopReason: "refusal" });

    mockFetch(404, { error: { message: "models/nope is not found" } });
    const e404 = await new GeminiProvider("k", "nope").complete({ user: "x", purpose: "execute" }).catch((e) => e);
    expect(e404).toBeInstanceOf(ProviderError);
    expect(e404.message).toMatch(/not found/i);
    expect(e404.retryable).toBe(false);

    const f429 = mockFetch(429, { error: { message: "quota" } });
    const e429 = await new GeminiProvider("k", "m", undefined, [0, 0]).complete({ user: "x", purpose: "execute" }).catch((e) => e);
    expect(e429.retryable).toBe(true);
    expect(f429).toHaveBeenCalledTimes(3); // 1 call + 2 automatic retries
  });

  it("G5 retries 'high demand' (503) automatically and succeeds when Gemini recovers", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls < 3) return new Response(JSON.stringify({ error: { message: "The model is overloaded. Please try again later." } }), { status: 503 });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }), { status: 200 });
      }),
    );
    const r = await new GeminiProvider("k", "m", undefined, [0, 0]).complete({ user: "x", purpose: "execute" });
    expect(r.text).toBe("ok");
    expect(calls).toBe(3);

    // Still overloaded after the retries: a clear, retryable error that suggests switching model.
    mockFetch(503, { error: { message: "The model is overloaded." } });
    const e = await new GeminiProvider("k", "busy-model", undefined, [0, 0]).complete({ user: "x", purpose: "execute" }).catch((x) => x);
    expect(e.retryable).toBe(true);
    expect(e.message).toMatch(/high demand/);
    expect(e.message).toMatch(/Pro model/);
  });

  it("G6 lists the key's models and picks the newest general-purpose Pro model", async () => {
    const fn = mockFetch(200, {
      models: [
        { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-pro-preview", displayName: "Gemini 3 Pro Preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-pro-image-preview", displayName: "Image", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    const models = await listGeminiModels("key-xyz");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("key-xyz");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("key-xyz");
    expect(models.map((m) => m.id)).toEqual(["gemini-2.5-pro", "gemini-3-pro-preview", "gemini-3-pro-image-preview", "gemini-3-flash"]);
    expect(pickBestPro(models.map((m) => m.id))).toBe("gemini-3-pro-preview");
    // Stable beats preview at the same version; no Pro available → undefined.
    expect(pickBestPro(["gemini-3-pro-preview", "gemini-3-pro", "gemini-2.5-pro"])).toBe("gemini-3-pro");
    expect(pickBestPro(["gemini-3-flash", "gemini-3-pro-tts"])).toBeUndefined();
  });

  it("G3 registry: a key entered in the UI enables Gemini for both roles, is never persisted, and invalid setups roll back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcl-gem-"));
    const file = path.join(dir, "settings.json");
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const reg = new ProviderRegistry(file);
      const before = reg.describe().providers.find((p) => p.id === "gemini")!;
      expect(before).toMatchObject({ configured: false, model: "gemini-4-hydrogen" });

      // Choosing Gemini without a key is rejected and nothing changes.
      expect(() => reg.update({ executor: "gemini" })).toThrow(/not configured/);
      expect(reg.describe().settings.executor).toBe("demo");

      const res = reg.update({ geminiKey: "secret-gemini-key", geminiModel: "gemini-4-hydrogen", executor: "gemini", analyst: "gemini" });
      expect(res.mode).toBe("live");
      expect(res.settings).toEqual({ executor: "gemini", analyst: "gemini", geminiOnlyGeneration: false });
      expect(res.providers.find((p) => p.id === "gemini")).toMatchObject({ configured: true, keySource: "session" });
      expect(JSON.stringify(res)).not.toContain("secret-gemini-key");
      expect(fs.readFileSync(file, "utf8")).not.toContain("secret-gemini-key");
      expect(reg.get("gemini").model).toBe("gemini-4-hydrogen");

      // Removing the key while Gemini is still a role is rejected and the key is kept.
      expect(() => reg.update({ geminiKey: "" })).toThrow(/not configured/);
      expect(reg.describe().providers.find((p) => p.id === "gemini")!.configured).toBe(true);
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("G4 Gemini-only generation: analyst pinned to Gemini, survives restart, and never falls back without a key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcl-gem-"));
    const file = path.join(dir, "settings.json");
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const reg = new ProviderRegistry(file);
      // Lock without a key is rejected.
      expect(() => reg.update({ geminiOnlyGeneration: true })).toThrow(/not configured/);

      // Lock with the key: the analyst becomes Gemini automatically, the executor can stay demo.
      const res = reg.update({ geminiKey: "k-123", geminiOnlyGeneration: true });
      expect(res.settings).toMatchObject({ executor: "demo", analyst: "gemini", geminiOnlyGeneration: true });
      expect(reg.generationProvider().id).toBe("gemini");
      expect(reg.forRole("analyst").id).toBe("gemini");
      expect(reg.forRole("executor").id).toBe("demo");

      // Switching the analyst away while locked is refused.
      expect(() => reg.update({ analyst: "demo" })).toThrow(/must be Google Gemini/);

      // After a restart the session key is gone: generation refuses instead of using the rule-based generator.
      const restarted = new ProviderRegistry(file);
      expect(restarted.describe().settings.geminiOnlyGeneration).toBe(true);
      expect(() => restarted.generationProvider()).toThrow(/no Gemini API key is active/);
      expect(() => restarted.forRole("analyst")).toThrow(/no Gemini API key is active/);

      // Re-entering the key resumes Gemini generation.
      restarted.update({ geminiKey: "k-456" });
      expect(restarted.generationProvider().id).toBe("gemini");
    } finally {
      if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
