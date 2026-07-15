export const DEFAULT_API_BASE_URL = "https://114.67.169.78/mindiou-api";
export const LEGACY_API_BASE_URLS = [
  "https://launch-wonder-construction-unto.trycloudflare.com/mindiou-api"
];
export const DEFAULT_REPORT_ID = "c18ecc67-6725-4b60-bc0a-a73e53150d5e";
export const DEFAULT_CARD_ID = "card-2";
export const DEFAULT_SESSION_DURATION = 60;
export const STORAGE_KEYS = {
  apiBaseUrl: "learnCoachRokidApiBaseUrl",
  apiToken: "learnCoachRokidApiToken",
  currentCard: "learnCoachRokidCurrentCard",
  clearanceSession: "mindIouRokidClearanceSession"
};

export const DEMO_CARD = {
  id: "demo-cors",
  front: "CORS",
  back: "浏览器读取跨域响应的规则。",
  prompt: "用自己的话解释：CORS 和网络白名单有什么区别？",
  projectId: "learn-coach-demo",
  debtScore: 72,
  due: 0,
  repetitions: 0,
  tags: ["demo", "web"]
};
