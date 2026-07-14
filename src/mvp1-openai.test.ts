// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { createOpenAiWebResearch } from "../mvp1-openai.js";

describe("MVP-1 OpenAI web research adapter", () => {
  it("keeps only URLs that appear in response citations", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: "CORS controls whether browser JavaScript can read a cross-origin response.",
            annotations: [{ type: "url_citation", url: "https://developer.mozilla.org/cors", title: "CORS" }]
          }]
        }]
      })
    });
    const research = createOpenAiWebResearch({ apiKey: "test", baseUrl: "https://api.openai.com/v1", model: "gpt-5.5", fetchFn });
    const result = await research({ originalQuestion: "What is CORS?" });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toContain("mozilla.org");
    expect(result.researchText).toContain("JavaScript");
    const request = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(request.tools[0].type).toBe("web_search");
    expect(request.tools[0].search_context_size).toBe("low");
    expect(request.max_output_tokens).toBe(1600);
    expect(request.input).toContain("Even Realities G2");
  });

  it("turns a hung research call into a visible timeout", async () => {
    const fetchFn = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const research = createOpenAiWebResearch({ apiKey: "test", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", fetchFn, timeoutMs: 5 });
    await expect(research({ originalQuestion: "What is CORS?" })).rejects.toThrow("timed out");
  });
});
