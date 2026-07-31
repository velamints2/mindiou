import * as cheerio from "cheerio";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function searchQuery(request) {
  return clean([
    request?.originalQuestion,
    request?.targetDebt,
    request?.purpose
  ].filter(Boolean).join(" "));
}

function destinationUrl(href) {
  if (!href) return "";
  try {
    const resolved = new URL(href, "https://duckduckgo.com");
    const redirected = resolved.searchParams.get("uddg");
    const target = redirected ? new URL(redirected) : resolved;
    if (!["http:", "https:"].includes(target.protocol)) return "";
    if (target.hostname === "duckduckgo.com") return "";
    return target.toString();
  } catch {
    return "";
  }
}

export function parseDuckDuckGoResults(html, maxSources = 5) {
  const $ = cheerio.load(html);
  const sources = [];

  $(".web-result").each((_index, element) => {
    if (sources.length >= maxSources) return false;
    const result = $(element);
    const anchor = result.find("a.result__a").first();
    const url = destinationUrl(anchor.attr("href"));
    const title = clean(anchor.text());
    const claim = clean(result.find(".result__snippet").first().text());
    if (!url || !title || !claim || sources.some(source => source.url === url)) return;
    sources.push({
      id: `source-${sources.length + 1}`,
      url,
      title,
      claim
    });
  });

  return sources;
}

export function createPublicWebResearch({
  fetchFn = fetch,
  timeoutMs = 15000,
  maxSources = 5
} = {}) {
  return async function research(request) {
    const query = searchQuery(request);
    if (!query) throw new Error("Public web research requires a search query");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          accept: "text/html",
          "user-agent": "MindIOU/1.0 (+https://demo.mindiou.top)"
        },
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Public web research timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error(`Public web research HTTP ${response.status}`);
    const sources = parseDuckDuckGoResults(await response.text(), maxSources);
    if (sources.length === 0) throw new Error("Public web research returned no cited sources");

    return {
      researchText: sources.map(source => (
        `[${source.id}] ${source.title}\n${source.claim}\n${source.url}`
      )).join("\n\n"),
      sources
    };
  };
}
