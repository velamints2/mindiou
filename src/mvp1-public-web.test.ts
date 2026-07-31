// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { createPublicWebResearch, parseDuckDuckGoResults } from "../mvp1-public-web.js";

const SEARCH_HTML = `
  <div class="result web-result">
    <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.gov%2Flaw&amp;rut=x">Current law</a></h2>
    <a class="result__snippet">Official text of the current law.</a>
  </div>
  <div class="result web-result">
    <h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.edu%2Fguide">University guide</a></h2>
    <a class="result__snippet">A practical explanation from a university.</a>
  </div>
`;

describe("MVP-1 public web research adapter", () => {
  it("parses destination URLs, titles, and snippets from search results", () => {
    expect(parseDuckDuckGoResults(SEARCH_HTML)).toEqual([
      {
        id: "source-1",
        url: "https://example.gov/law",
        title: "Current law",
        claim: "Official text of the current law."
      },
      {
        id: "source-2",
        url: "https://example.edu/guide",
        title: "University guide",
        claim: "A practical explanation from a university."
      }
    ]);
  });

  it("returns searchable evidence with real source identifiers", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SEARCH_HTML
    });
    const research = createPublicWebResearch({ fetchFn });
    const result = await research({ originalQuestion: "What changed in the law?" });

    expect(fetchFn.mock.calls[0][0]).toContain("What%20changed%20in%20the%20law");
    expect(result.sources).toHaveLength(2);
    expect(result.researchText).toContain("[source-1]");
    expect(result.researchText).toContain("https://example.gov/law");
  });

  it("rejects an empty or blocked result page", async () => {
    const research = createPublicWebResearch({
      fetchFn: vi.fn().mockResolvedValue({ ok: true, text: async () => "<html></html>" })
    });
    await expect(research({ originalQuestion: "test" })).rejects.toThrow("no cited sources");
  });
});
