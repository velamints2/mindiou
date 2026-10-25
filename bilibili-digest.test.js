import { describe, expect, it } from "vitest";
import { parseBvid, mergeSentences, segmentSentences, timecode, digestFromSubtitleText } from "./bilibili-digest.js";

describe("parseBvid", () => {
  it("accepts a raw BV id", () => {
    expect(parseBvid("BV1GJ411x7h7")).toBe("BV1GJ411x7h7");
  });
  it("extracts from desktop urls", () => {
    expect(parseBvid("https://www.bilibili.com/video/BV1GJ411x7h7?p=2")).toBe("BV1GJ411x7h7");
  });
  it("extracts from short links", () => {
    expect(parseBvid("https://b23.tv/abc123BV1GJ411x7h7")).toBe("BV1GJ411x7h7");
  });
  it("rejects non-bilibili input", () => {
    expect(parseBvid("https://youtube.com/watch?v=x")).toBeNull();
    expect(parseBvid("")).toBeNull();
  });
});

describe("mergeSentences", () => {
  it("merges adjacent lines into sentences", () => {
    const lines = [
      { from: 0, to: 2, text: "光遗传学" },
      { from: 2.1, to: 4, text: "的核心是一种通道蛋白" },
      { from: 4.1, to: 6, text: "它对光敏感" }
    ];
    const sentences = mergeSentences(lines);
    expect(sentences).toHaveLength(1);
    expect(sentences[0].text).toBe("光遗传学的核心是一种通道蛋白它对光敏感");
    expect(sentences[0].from).toBe(0);
    expect(sentences[0].to).toBe(6);
  });
  it("splits on long pauses", () => {
    const lines = [
      { from: 0, to: 3, text: "第一句话讲完了。" },
      { from: 10, to: 13, text: "停顿很久之后的另一句" }
    ];
    const sentences = mergeSentences(lines);
    expect(sentences).toHaveLength(2);
  });
  it("splits on terminal punctuation", () => {
    const lines = [
      { from: 0, to: 2, text: "这就是光遗传学。" },
      { from: 2.2, to: 4, text: "接下来讲应用" }
    ];
    expect(mergeSentences(lines)).toHaveLength(2);
  });
  it("drops fragments shorter than 6 chars", () => {
    const lines = [{ from: 0, to: 1, text: "好" }];
    expect(mergeSentences(lines)).toHaveLength(0);
  });
});

describe("segmentSentences", () => {
  const mkLines = (count, step = 4) => Array.from({ length: count }, (_, i) => ({
    from: i * step, to: i * step + 3, text: `第${i}句讲光遗传学的通道蛋白机制`
  }));
  it("produces windows with scores and terms", () => {
    const sentences = mergeSentences(mkLines(30));
    const segments = segmentSentences(sentences);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).toHaveProperty("salience");
    expect(segments[0]).toHaveProperty("topTerms");
    expect(segments.every(s => s.startSec >= 0)).toBe(true);
  });
  it("returns empty for empty input", () => {
    expect(segmentSentences([])).toEqual([]);
  });
});

describe("timecode", () => {
  it("formats mm:ss", () => {
    expect(timecode(0)).toBe("00:00");
    expect(timecode(83)).toBe("01:23");
    expect(timecode(3671)).toBe("61:11");
  });
});

describe("digestFromSubtitleText", () => {
  const video = { bvid: "BV1test00000", title: "光遗传学入门", duration: 600 };
  it("returns insights, cards and debt candidates from real-shaped lines", () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      const t = i * 5;
      lines.push({ from: t, to: t + 4, text: i % 3 === 0 ? "所谓光遗传学就是用光控制神经元的技术。" : "通道蛋白是光遗传学的核心，因为它对蓝光敏感。" });
    }
    const result = digestFromSubtitleText(video, lines, ["脑科学"]);
    expect(result.mode).toBe("subtitle");
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.insights[0].url).toContain("t=");
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.cards[0].front).toContain(video.title.slice(0, 20));
    expect(result.stats.lines).toBe(60);
  });
  it("keeps debt candidates textual and bounded", () => {
    const lines = [];
    for (let i = 0; i < 120; i++) {
      const t = i * 5;
      lines.push({ from: t, to: t + 4, text: `蓝光照射之后通道蛋白开门放电，光遗传学实验继续。` });
    }
    const result = digestFromSubtitleText(video, lines, []);
    expect(result.debtCandidates.length).toBeLessThanOrEqual(3);
    for (const candidate of result.debtCandidates) {
      expect(candidate.gapText).toContain(video.title.slice(0, 10));
      expect(candidate.requiredEvidence.length).toBeGreaterThan(0);
    }
  });
});
