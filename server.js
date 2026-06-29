import { createServer } from "node:http";
import crypto from "node:crypto";

const port = Number(process.env.PORT || 8793);
const host = process.env.HOST || "0.0.0.0";
const apiToken = process.env.LEARNING_API_TOKEN || "";
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const openAiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const chatModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const sttModel = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
const eventLog = [];

const learningCoachSystemPrompt = [
  "You are Learn Coach, a rigorous but patient AI teacher for Even G2 smart glasses.",
  "You can teach any subject to learners at any level.",
  "Use active recall, Feynman questioning, Socratic guidance, concrete examples, analogies, and short feedback loops.",
  "When planning a subject, organize the modern-citizen core knowledge into a reasonable sequence of teaching units.",
  "Each unit must contain a concise explanation and 1 to 3 Feynman-style questions that require the learner to answer in their own words.",
  "When evaluating an answer, first identify what is correct, then point out missing or confused parts, then ask one short follow-up question or give one concrete thinking clue.",
  "If the answer is wrong or empty, never criticize. Re-explain more simply and invite another attempt.",
  "For glasses output, be brief and structured. Avoid long lectures unless explicitly asked.",
  "Use Chinese primarily when the learner writes Chinese, but naturally include key English terms in parentheses when useful."
].join(" ");

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(body);
}

function optionsResponse(res) {
  res.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400"
  });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024 * 8) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function requireToken(req, res) {
  if (!apiToken) return true;
  const header = req.headers.authorization || "";
  if (header === `Bearer ${apiToken}`) return true;
  jsonResponse(res, 401, { ok: false, error: "Invalid token" });
  return false;
}

function parseJson(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fit(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textArray(value, maxItems = 3, maxLength = 90) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item).slice(0, maxLength)).filter(Boolean).slice(0, maxItems);
}

function parseJsonObject(text) {
  const stripped = String(text || "{}").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error("Model did not return a JSON object");
  }
}

const validAssessments = new Set(["correct", "partial", "incorrect", "unknown"]);

function normalizeAssessment(value, fallback = "unknown") {
  const assessment = clean(value).toLowerCase();
  return validAssessments.has(assessment) ? assessment : fallback;
}

function baseTutorResult(kind, card, transcript) {
  const front = clean(card.front || "this concept");
  const back = clean(card.back || "the core idea");

  if (kind === "repeat") {
    return {
      assessment: "unknown",
      message: `再听一遍：${front}。先说核心意思，再补一个例子。`,
      missingPoints: [],
      nextQuestion: `用自己的话解释 ${front}，不要照读。`,
      summary: "",
      g2Text: `Explain ${fit(front, 24)}`,
      shouldFollowUp: true
    };
  }

  if (kind === "known") {
    return {
      assessment: "correct",
      message: "已标记会了。下一次复习时优先检查你能否举例。",
      missingPoints: [],
      nextQuestion: "",
      summary: `${front}: ${back}`,
      g2Text: "Marked known",
      shouldFollowUp: false
    };
  }

  if (kind === "answer") {
    if (!transcript) {
      return {
        assessment: "incorrect",
        message: "还没有收到你的解释。先用一句自己的话说核心意思。",
        missingPoints: ["需要主动解释核心含义"],
        nextQuestion: `如果讲给朋友听，${front} 是什么意思？`,
        summary: "",
        g2Text: "Try explaining",
        shouldFollowUp: true
      };
    }

    return {
      assessment: transcript.length > 24 ? "partial" : "partial",
      message: `收到你的回答：“${fit(transcript, 36)}”。方向可以，下一步要把概念和具体情境连起来。`,
      missingPoints: ["补一个真实例子或应用场景"],
      nextQuestion: `请举一个生活或工作里的 ${front} 例子。`,
      summary: "",
      g2Text: "Add one example",
      shouldFollowUp: true
    };
  }

  return {
    assessment: "unknown",
    message: `小测：${front} 的核心意思是什么？`,
    missingPoints: [],
    nextQuestion: `请用简单语言解释 ${front}。`,
    summary: "",
    g2Text: `Explain ${fit(front, 24)}`,
    shouldFollowUp: true
  };
}

function normalizeTutorResult(input, context) {
  const base = baseTutorResult(context.kind, context.card, context.transcript);
  const assessment = normalizeAssessment(input.assessment, base.assessment);
  const missingPoints = textArray(input.missingPoints).length ? textArray(input.missingPoints) : base.missingPoints;
  const nextQuestion = clean(input.nextQuestion || input.followUpQuestion || base.nextQuestion).slice(0, 180);
  const summary = clean(input.summary || base.summary).slice(0, 220);
  const shouldFollowUp = typeof input.shouldFollowUp === "boolean"
    ? input.shouldFollowUp
    : Boolean(nextQuestion) && context.kind !== "known";

  return {
    ok: true,
    action: context.kind,
    assessment,
    message: clean(input.message || input.feedback || base.message).slice(0, 360),
    missingPoints,
    nextQuestion,
    summary,
    g2Text: fit(input.g2Text || base.g2Text || nextQuestion || summary, 42),
    shouldFollowUp
  };
}

function fallbackCards(text, maxCards = 40) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.slice(0, maxCards).map(line => {
    const csv = line.split(",").map(part => part.trim()).filter(Boolean);
    const splitPair = line.split(/\s+[-:：]\s+|\s{2,}/).map(part => part.trim()).filter(Boolean);
    const whitespacePair = line.split(/\s+/).map(part => part.trim()).filter(Boolean);
    const pair = csv.length >= 2 ? csv : splitPair.length >= 2 ? splitPair : whitespacePair;
    const front = clean(pair[0] || line).slice(0, 64);
    const back = clean(pair.slice(1).join(" ") || "用自己的话解释。").slice(0, 120);
    return {
      id: crypto.randomUUID(),
      front,
      back,
      prompt: `跟读：${front}。然后用自己的话解释。`,
      tags: ["ai-import"],
      due: Date.now(),
      repetitions: 0
    };
  });
}

function fallbackPlan(subject, level, maxUnits = 8) {
  const cleanSubject = clean(subject || "the subject");
  const units = [
    ["Big Picture", `What ${cleanSubject} studies, why it matters, and where it appears in daily life.`],
    ["Core Concepts", `The most important terms and distinctions a modern citizen should know.`],
    ["Mental Model", `A simple framework for organizing the subject and noticing relationships.`],
    ["Examples", `Concrete examples that make the abstract ideas easier to recall.`],
    ["Misconceptions", `Common misunderstandings and how to avoid them.`],
    ["Application", `How to use the ideas to analyze a small real-world situation.`],
    ["Review", `A compact synthesis of the main points and open questions.`]
  ].slice(0, maxUnits);

  return units.map(([title, body], index) => ({
    id: crypto.randomUUID(),
    front: `${index + 1}. ${title}`,
    back: body,
    prompt: `Feynman question: explain ${title.toLowerCase()} in your own words for ${cleanSubject}.`,
    tags: ["unit", cleanSubject, clean(level || "unknown")].slice(0, 4),
    due: Date.now(),
    repetitions: 0
  }));
}

async function chatJson(messages, fallback) {
  if (!openAiApiKey) return fallback();
  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${openAiApiKey}`,
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages
    })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  const content = payload.choices?.[0]?.message?.content || "{}";
  return parseJsonObject(content);
}

async function importCards(payload) {
  const text = String(payload.text || "").trim();
  const maxCards = Math.max(1, Math.min(80, Number(payload.maxCards || 40)));
  if (!text) return { ok: false, error: "Missing text" };

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Convert user learning material into concise Even G2 flashcards.",
          "Return JSON only: {\"cards\":[{\"front\":\"\",\"back\":\"\",\"prompt\":\"\",\"tags\":[\"\"]}]}",
          "Front must be glanceable, usually one word or short phrase. Back is short.",
          "Prompt must be a Feynman-style active recall question that asks the learner to explain, compare, give an example, or apply the idea."
        ].join(" ")
      },
      {
        role: "user",
        content: `Create at most ${maxCards} cards from this material:\n\n${text}`
      }
    ], () => ({ cards: fallbackCards(text, maxCards) }));
    const cards = Array.isArray(result.cards) ? result.cards.slice(0, maxCards) : fallbackCards(text, maxCards);
    return {
      ok: true,
      cards: cards.map(card => ({
        id: crypto.randomUUID(),
        front: clean(card.front).slice(0, 64),
        back: clean(card.back).slice(0, 120),
        prompt: clean(card.prompt || `Explain ${card.front}`).slice(0, 120),
        tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 4) : ["ai-import"],
        due: Date.now(),
        repetitions: 0
      })).filter(card => card.front)
    };
  } catch (error) {
    return { ok: true, cards: fallbackCards(text, maxCards), fallback: true, error: error.message };
  }
}

async function planCourse(payload) {
  const subject = clean(payload.subject);
  const level = clean(payload.level || "zero basis");
  const maxUnits = Math.max(3, Math.min(12, Number(payload.maxUnits || 8)));
  if (!subject) return { ok: false, error: "Missing subject" };

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Return JSON only: {\"overview\":\"\",\"cards\":[{\"front\":\"\",\"back\":\"\",\"prompt\":\"\",\"tags\":[\"\"]}]}",
          "Create a sequential course plan. Each card is one teaching unit.",
          "front: short unit title. back: compact explanation with key terms. prompt: 1 Feynman question requiring the learner to answer in their own words.",
          "Keep each card readable on smart glasses."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({ subject, level, maxUnits })
      }
    ], () => ({
      overview: `A ${maxUnits}-unit starter path for ${subject}.`,
      cards: fallbackPlan(subject, level, maxUnits)
    }));

    const cards = Array.isArray(result.cards) ? result.cards.slice(0, maxUnits) : fallbackPlan(subject, level, maxUnits);
    return {
      ok: true,
      overview: clean(result.overview || `Course created for ${subject}.`).slice(0, 160),
      cards: cards.map(card => ({
        id: crypto.randomUUID(),
        front: clean(card.front).slice(0, 64),
        back: clean(card.back).slice(0, 160),
        prompt: clean(card.prompt || "Explain this unit in your own words.").slice(0, 140),
        tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 4) : ["unit"],
        due: Date.now(),
        repetitions: 0
      })).filter(card => card.front)
    };
  } catch (error) {
    return {
      ok: true,
      overview: `Fallback course created for ${subject}.`,
      cards: fallbackPlan(subject, level, maxUnits),
      fallback: true,
      error: error.message
    };
  }
}

async function tutor(payload) {
  const card = payload.card || {};
  const kind = clean(payload.kind || "ask");
  const transcript = clean(payload.transcript || "");
  const safeKind = ["ask", "repeat", "known", "answer"].includes(kind) ? kind : "ask";
  const context = { kind: safeKind, card, transcript };
  const fallback = () => normalizeTutorResult({}, context);

  try {
    const result = await chatJson([
      {
        role: "system",
        content: [
          learningCoachSystemPrompt,
          "Return JSON only using this schema:",
          "{\"ok\":true,\"assessment\":\"correct|partial|incorrect|unknown\",\"message\":\"\",\"missingPoints\":[\"\"],\"nextQuestion\":\"\",\"summary\":\"\",\"g2Text\":\"\",\"shouldFollowUp\":true}.",
          "assessment evaluates learnerSaid only when action is answer; otherwise use unknown unless action is known.",
          "message is the learner-facing feedback. First affirm correct parts, then point out missing or confused parts.",
          "missingPoints contains at most 3 short missing ideas. Use [] if nothing is missing.",
          "nextQuestion is one Feynman or Socratic follow-up that makes the learner explain, compare, give an example, or apply the idea.",
          "summary is optional and should be a compact review note when no follow-up is needed.",
          "g2Text must be one short glasses line, max 42 characters, no markdown.",
          "If the answer is wrong or empty, re-explain simply and invite another attempt without criticism."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          action: safeKind,
          card: {
            front: card.front,
            back: card.back,
            prompt: card.prompt
          },
          learnerSaid: transcript,
          progress: payload.progress || {}
        })
      }
    ], fallback);
    return normalizeTutorResult(result, context);
  } catch (error) {
    return { ...fallback(), fallback: true, error: error.message };
  }
}

function wavFromPcm16(base64, sampleRate = 16000) {
  const pcm = Buffer.from(base64 || "", "base64");
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function transcribe(payload) {
  if (!openAiApiKey) return { ok: false, text: "", error: "OPENAI_API_KEY is not set" };
  const audioBase64 = clean(payload.audioBase64);
  if (!audioBase64) return { ok: false, error: "Missing audioBase64" };

  const wav = wavFromPcm16(audioBase64, Number(payload.sampleRate || 16000));
  const form = new FormData();
  form.append("model", sttModel);
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "g2-audio.wav");

  const response = await fetch(`${openAiBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { "authorization": `Bearer ${openAiApiKey}` },
    body: form
  });
  const result = await response.json();
  if (!response.ok) return { ok: false, error: result.error?.message || `STT HTTP ${response.status}` };
  return { ok: true, text: clean(result.text), confidence: 0 };
}

function recordEvent(payload) {
  const event = {
    at: new Date().toISOString(),
    type: clean(payload.type || "event").slice(0, 80),
    data: payload.data && typeof payload.data === "object" ? payload.data : {}
  };
  eventLog.push(event);
  while (eventLog.length > 200) eventLog.shift();
  return event;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      optionsResponse(res);
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health") {
      jsonResponse(res, 200, { ok: true, ai: Boolean(openAiApiKey), model: chatModel, sttModel });
      return;
    }

    if (!requireToken(req, res)) return;
    if (req.method === "GET" && url.pathname === "/api/learn/events") {
      const since = url.searchParams.get("since");
      const events = since ? eventLog.filter(event => event.at > since) : eventLog.slice(-80);
      jsonResponse(res, 200, { ok: true, events });
      return;
    }

    if (req.method !== "POST") {
      jsonResponse(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const payload = parseJson(await readBody(req));
    if (url.pathname === "/api/learn/events") {
      jsonResponse(res, 200, { ok: true, event: recordEvent(payload) });
      return;
    }
    if (url.pathname === "/api/learn/import") {
      jsonResponse(res, 200, await importCards(payload));
      return;
    }
    if (url.pathname === "/api/learn/plan") {
      jsonResponse(res, 200, await planCourse(payload));
      return;
    }
    if (url.pathname === "/api/learn/tutor") {
      jsonResponse(res, 200, await tutor(payload));
      return;
    }
    if (url.pathname === "/api/learn/transcribe") {
      jsonResponse(res, 200, await transcribe(payload));
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`G2 learning API listening on http://${host}:${port}`);
});
