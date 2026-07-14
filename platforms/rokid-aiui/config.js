export const DEFAULT_API_BASE_URL = "http://192.168.1.10:8793";
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
