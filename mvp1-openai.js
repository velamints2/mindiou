import { getClearanceResearchPrompt } from "./mvp1-clearance.js";

function responseTextAndCitations(payload) {
  let text = "";
  const citations = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type !== "output_text") continue;
      text += content.text || "";
      for (const annotation of content.annotations || []) {
        if (annotation?.type === "url_citation" && annotation.url) {
          citations.push({ url: annotation.url, title: annotation.title || "" });
        }
      }
    }
  }
  return { text, citations };
}

export function createOpenAiWebResearch({ apiKey, baseUrl, model, fetchFn = fetch, timeoutMs = 45000 }) {
  return async function research(request) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          model,
          tools: [{ type: "web_search", search_context_size: "low" }],
          tool_choice: "auto",
          max_output_tokens: 1600,
          input: getClearanceResearchPrompt(request)
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`External research timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI research HTTP ${response.status}`);
    const { text, citations } = responseTextAndCitations(payload);
    const sources = citations
      .filter((citation, index, all) => all.findIndex(item => item.url === citation.url) === index)
      .map((citation, index) => ({
        id: `source-${index + 1}`,
        url: citation.url,
        title: citation.title,
        claim: "Cited by the external research response."
      }));
    if (!text.trim()) throw new Error("External research returned no evidence text");
    if (sources.length === 0) throw new Error("External research returned no cited sources");
    return {
      researchText: text,
      sources
    };
  };
}
