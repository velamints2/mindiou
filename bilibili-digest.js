// Bilibili video digest: fetch metadata + CC subtitles and distill knowledge
// points, learning cards and cognitive-debt candidates with auditable rules.
// Mirrors the MindIOU Loop pitch from cross_0812: "对视频，Loop 会读取字幕、
// 语音和关键画面，而不只是看标题" — here implemented on real subtitle text.

const BILI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function parseBvid(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const direct = raw.match(/^(BV[0-9A-Za-z]{10})$/);
  if (direct) return direct[1];
  const fromUrl = raw.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/i)
    || raw.match(/b23\.tv\/\S*?(BV[0-9A-Za-z]{10})/i);
  return fromUrl ? fromUrl[1] : null;
}

async function biliFetch(url, sessdata) {
  const headers = {
    "user-agent": BILI_UA,
    "referer": "https://www.bilibili.com/",
    "accept": "application/json"
  };
  if (sessdata) headers.cookie = `SESSDATA=${sessdata}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`bilibili API ${response.status} ${url.slice(0, 80)}`);
  return response.json();
}

async function fetchView(bvid) {
  const data = await biliFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0) throw new Error(`view API code=${data.code}: ${data.message}`);
  const v = data.data || {};
  return {
    bvid: v.bvid,
    aid: v.aid,
    cid: v.cid,
    title: v.title || "",
    desc: v.desc || "",
    duration: v.duration || 0,
    pubdate: v.pubdate,
    owner: v.owner?.name || "",
    cover: v.pic || "",
    tags: [],
    pages: Array.isArray(v.pages) ? v.pages.map(p => ({ cid: p.cid, part: p.part })) : []
  };
}

async function fetchTags(bvid) {
  try {
    const data = await biliFetch(`https://api.bilibili.com/x/tag/archive/tags?bvid=${encodeURIComponent(bvid)}`);
    return data.code === 0 ? (data.data || []).map(t => t.tag_name).slice(0, 10) : [];
  } catch { return []; }
}

// CC subtitle list requires SESSDATA; without it Bilibili returns an empty list.
async function fetchSubtitle(bvid, cid, sessdata) {
  if (!sessdata) return { lines: null, reason: "no_sessdata" };
  const data = await biliFetch(
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
    sessdata
  );
  if (data.code !== 0) return { lines: null, reason: `player_api_${data.code}` };
  const tracks = data.data?.subtitle?.subtitles || [];
  const preferred = tracks.find(t => t.lan === "zh-CN") || tracks.find(t => (t.lan || "").startsWith("zh"))
    || tracks.find(t => (t.lan || "").startsWith("ai-zh")) || tracks[0];
  if (!preferred) return { lines: null, reason: "no_subtitle_track" };
  const subUrl = preferred.subtitle_url.startsWith("//") ? `https:${preferred.subtitle_url}` : preferred.subtitle_url;
  const sub = await biliFetch(subUrl, sessdata);
  const body = Array.isArray(sub?.body) ? sub.body : [];
  const lines = body
    .filter(item => typeof item?.content === "string" && item.content.trim())
    .map(item => ({ from: Number(item.from) || 0, to: Number(item.to) || 0, text: item.content.trim() }));
  return { lines: lines.length ? lines : null, reason: lines.length ? "ok" : "empty_subtitle", lan: preferred.lan };
}

// ── Rule-based digest (auditable, no LLM required) ──

const STOPWORDS = new Set(["我们", "你们", "他们", "这个", "那个", "就是", "然后", "但是", "所以", "因为", "如果", "的话", "什么", "怎么", "可以", "一个", "没有", "还是", "已经", "这样", "现在", "大家", "其实", "可能", "觉得", "知道", "时候", "东西", "自己", "出来", "进去", "一下", "一下", "非常", "特别", "直接", "这种", "这些", "some", "the", "and", "for", "with", "that", "this"]);

const CUE_PATTERNS = [
  { kind: "definition", re: /(就是|指的是|意思是|定义为|所谓|本质是|核心是)/ },
  { kind: "enumeration", re: /(第一|第二|第三|首先|其次|最后|一方面|另一方面|三个|几步|几种)/ },
  { kind: "causal", re: /(因为|所以|导致|原因是|结果是|从而|因此)/ },
  { kind: "contrast", re: /(区别|不同|对比|相比|差异|而是)/ },
  { kind: "actionable", re: /(要记住|注意|关键|重点|建议|做法|步骤|配置|设置)/ }
];

function tokenize(text) {
  return String(text)
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .split(" ")
    .filter(token => token.length >= 2 && !STOPWORDS.has(token));
}

// Merge subtitle lines into sentences split on punctuation or pauses > 1.2s.
function mergeSentences(lines) {
  const sentences = [];
  let current = null;
  for (const line of lines) {
    const pauseBreak = current && line.from - current.to > 1.2;
    const punctuated = current && /[。！？；.!?;]$/.test(current.text);
    if (!current || pauseBreak || punctuated) {
      if (current && current.text) sentences.push(current);
      current = { from: line.from, to: line.to, text: line.text };
    } else {
      current.to = line.to;
      current.text = `${current.text}${line.text}`;
    }
  }
  if (current && current.text) sentences.push(current);
  return sentences.filter(s => s.text.length >= 6);
}

// Sliding 90s windows stepped by 75s keep boundaries stable on long videos.
function segmentSentences(sentences, windowSec = 90, stepSec = 75) {
  if (!sentences.length) return [];
  const end = sentences[sentences.length - 1].to;
  const segments = [];
  for (let start = 0; start < end; start += stepSec) {
    const stop = start + windowSec;
    const inWindow = sentences.filter(s => s.from >= start && s.from < stop);
    if (!inWindow.length) continue;
    const text = inWindow.map(s => s.text).join("");
    const cues = CUE_PATTERNS.filter(p => p.re.test(text)).map(p => p.kind);
    const tokens = tokenize(text);
    const freq = new Map();
    for (const token of tokens) freq.set(token, (freq.get(token) || 0) + 1);
    const topTerms = [...freq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
    const digits = (text.match(/\d+(\.\d+)?%?/g) || []).length;
    const salience = tokens.length / Math.max(1, text.length) * 10
      + cues.length * 3
      + Math.min(6, digits)
      + topTerms.length * 2;
    segments.push({
      startSec: start,
      endSec: stop,
      sentences: inWindow.map(s => s.text).slice(0, 14),
      text: text.slice(0, 1200),
      cues,
      topTerms,
      salience: Math.round(salience * 10) / 10
    });
  }
  return segments;
}

function dedupeSegments(segments) {
  const kept = [];
  for (const seg of [...segments].sort((a, b) => b.salience - a.salience)) {
    if (kept.some(k => Math.abs(k.startSec - seg.startSec) < 60)) continue;
    kept.push(seg);
    if (kept.length >= 8) break;
  }
  return kept.sort((a, b) => a.startSec - b.startSec);
}

function timecode(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function cardsFromSegments(video, segments) {
  return segments.slice(0, 6).map((seg, index) => {
    const topic = seg.topTerms[0] || seg.cues[0] || `要点${index + 1}`;
    const core = seg.sentences.find(s => s.length >= 14) || seg.sentences[0] || seg.text.slice(0, 80);
    return {
      id: `${video.bvid}-card-${index}`,
      front: `《${video.title.slice(0, 20)}》${timecode(seg.startSec)}：${topic} 是怎么讲的？`,
      back: core.slice(0, 200),
      tags: ["bilibili", video.bvid],
      evidence: { kind: "video_segment", bvid: video.bvid, startSec: seg.startSec, url: `https://www.bilibili.com/video/${video.bvid}/?t=${Math.floor(seg.startSec)}` }
    };
  });
}

function debtCandidatesFromSegments(video, segments) {
  const covered = new Set(segments.flatMap(s => s.topTerms));
  const global = new Map();
  for (const seg of segments) {
    for (const token of tokenize(seg.text)) global.set(token, (global.get(token) || 0) + 1);
  }
  return [...global.entries()]
    .filter(([token, count]) => count >= 3 && !covered.has(token) && token.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([token, count]) => ({
      gapText: `能否脱离视频复述《${video.title.slice(0, 24)}》中「${token}」的作用与例子？`,
      reason: `视频字幕中「${token}」出现 ${count} 次，但未被选入重点段落卡片，存在看过即忘的欠账风险`,
      risk: "只记得视频结论，无法在真实工作中调用该概念",
      requiredEvidence: [`用自己的话解释 ${token}`, `举一个当前项目里的对应例子`],
      evidence: { kind: "video_term", bvid: video.bvid, term: token, mentions: count }
    }));
}

// Fallback when subtitles are unavailable: distill from title + desc + tags.
function digestFromMeta(video, tags) {
  const descLines = video.desc.split(/\n+/).map(l => l.trim()).filter(l => l.length >= 8);
  const outline = descLines.filter(l => /^[-–—*·]|\d+[.、）)]/.test(l) || l.length >= 20).slice(0, 10);
  const insights = outline.map((line, i) => ({
    timecode: null,
    cue: "desc",
    text: line.slice(0, 200),
    salience: 10 - i,
    url: `https://www.bilibili.com/video/${video.bvid}/`
  }));
  const cards = outline.slice(0, 4).map((line, i) => ({
    id: `${video.bvid}-meta-card-${i}`,
    front: `《${video.title.slice(0, 20)}》简介要点 ${i + 1} 是什么？`,
    back: line.slice(0, 200),
    tags: ["bilibili", video.bvid],
    evidence: { kind: "video_desc", bvid: video.bvid, url: `https://www.bilibili.com/video/${video.bvid}/` }
  }));
  // Fallback debts use description terms, not uploader tags: channel tags
  // ("摄影", "生活记录") are usually unrelated to a specific video's content.
  const corpus = `${video.title}\n${video.desc}`;
  const descTokens = [...new Set(tokenize(corpus))];
  const contentTags = tags.filter(tag => corpus.includes(tag));
  const debtTerms = (contentTags.length ? contentTags : descTokens.filter(token => token.length >= 2 && corpus.split(token).length - 1 >= 2)).slice(0, 2);
  const debtCandidates = debtTerms.map(term => ({
    gapText: `能否解释《${video.title.slice(0, 24)}》里的「${term}」？`,
    reason: `视频标题/简介中「${term}」被反复提及，但未获得字幕级证据，理解深度未验证`,
    risk: "基于简介的浅层认知被误当作已掌握",
    requiredEvidence: [`用自己的话解释 ${term}`],
    evidence: { kind: contentTags.length ? "video_tag" : "video_desc_term", bvid: video.bvid, term }
  }));
  return {
    mode: "metadata_fallback",
    note: "未配置 B 站 SESSDATA 或该视频无字幕，已用标题/简介/标签做降级消化；配置 SESSDATA 后可读取完整字幕。",
    insights, cards, debtCandidates,
    stats: { descLines: descLines.length, outlinePoints: outline.length, tags: tags.length }
  };
}

export function digestFromSubtitleText(video, lines, tags) {
  const sentences = mergeSentences(lines);
  const segments = dedupeSegments(segmentSentences(sentences));
  const insights = segments.map(seg => ({
    timecode: timecode(seg.startSec),
    startSec: seg.startSec,
    cue: seg.cues[0] || "plain",
    text: seg.sentences.slice(0, 4).join(" ").slice(0, 220),
    terms: seg.topTerms,
    salience: seg.salience,
    url: `https://www.bilibili.com/video/${video.bvid}/?t=${Math.floor(seg.startSec)}`
  }));
  return {
    mode: "subtitle",
    note: `基于 ${lines.length} 行字幕（${sentences.length} 句）的规则消化。`,
    insights, cards: cardsFromSegments(video, segments), debtCandidates: debtCandidatesFromSegments(video, segments),
    stats: { lines: lines.length, sentences: sentences.length, segments: segments.length, durationSec: video.duration, tags: tags.length }
  };
}

export async function digestBilibiliVideo({ url, sessdata }) {
  const bvid = parseBvid(url);
  if (!bvid) throw new Error("无法解析 B 站视频地址：请粘贴 BV 号或 bilibili.com/b23.tv 链接");
  const video = await fetchView(bvid);
  const tags = await fetchTags(bvid);
  video.tags = tags;
  const subtitle = await fetchSubtitle(bvid, video.cid, sessdata);
  const digest = subtitle.lines
    ? digestFromSubtitleText(video, subtitle.lines, tags)
    : { ...digestFromMeta(video, tags), subtitleReason: subtitle.reason };
  return {
    ok: true,
    video,
    subtitle: { lan: subtitle.lan || null, reason: subtitle.reason },
    digest,
    generatedAt: new Date().toISOString()
  };
}

export { parseBvid, mergeSentences, segmentSentences, timecode };
