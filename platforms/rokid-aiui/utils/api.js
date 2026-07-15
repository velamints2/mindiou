import {
  DEFAULT_API_BASE_URL,
  DEFAULT_CARD_ID,
  LEGACY_API_BASE_URLS,
  DEFAULT_REPORT_ID,
  DEFAULT_SESSION_DURATION,
  STORAGE_KEYS
} from "../config.js";

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
}

function migrateLegacyBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  return LEGACY_API_BASE_URLS.includes(normalized) ? DEFAULT_API_BASE_URL : normalized;
}

function storageGet(key, fallback = "") {
  try {
    const runtimeWx = globalThis.wx;
    if (runtimeWx?.getStorageSync) {
      return runtimeWx.getStorageSync(key) || fallback;
    }
    if (globalThis.localStorage?.getItem) {
      const stored = globalThis.localStorage.getItem(key);
      return stored === null ? fallback : JSON.parse(stored);
    }
  } catch (error) {
    console.warn("Storage read failed", error);
  }
  return fallback;
}

function storageSet(key, value) {
  try {
    const runtimeWx = globalThis.wx;
    if (runtimeWx?.setStorageSync) {
      runtimeWx.setStorageSync(key, value);
      return;
    }
    if (globalThis.localStorage?.setItem) {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    console.warn("Storage write failed", error);
  }
}

export function getRuntimeConfig(query = {}) {
  const appData = typeof getApp === "function" ? getApp()?.globalData || {} : {};
  const apiBaseUrl = migrateLegacyBaseUrl(
    query.api
      ? decodeURIComponent(query.api)
      : storageGet(STORAGE_KEYS.apiBaseUrl, appData.apiBaseUrl || DEFAULT_API_BASE_URL)
  );
  const apiToken = String(
    query.token
      ? decodeURIComponent(query.token)
      : storageGet(STORAGE_KEYS.apiToken, appData.apiToken || "")
  ).trim();
  const duration = [15, 60, 180].includes(Number(query.duration))
    ? Number(query.duration)
    : Number(appData.sessionDuration || DEFAULT_SESSION_DURATION);
  const useLatestEntry = String(query.latest || "") === "1";
  const reportId = useLatestEntry ? "" : String(query.reportId || appData.reportId || DEFAULT_REPORT_ID).trim();
  const cardId = useLatestEntry ? "" : String(query.cardId || appData.cardId || DEFAULT_CARD_ID).trim();
  return { apiBaseUrl, apiToken, duration, reportId, cardId };
}

export function saveRuntimeConfig(apiBaseUrl, apiToken = "") {
  const normalized = normalizeBaseUrl(apiBaseUrl);
  storageSet(STORAGE_KEYS.apiBaseUrl, normalized);
  storageSet(STORAGE_KEYS.apiToken, String(apiToken || "").trim());
  const appData = typeof getApp === "function" ? getApp()?.globalData : null;
  if (appData) {
    appData.apiBaseUrl = normalized;
    appData.apiToken = String(apiToken || "").trim();
  }
  return normalized;
}

export function saveCurrentCard(card) {
  if (!card) return;
  storageSet(STORAGE_KEYS.currentCard, card);
}

export function loadCurrentCard() {
  return storageGet(STORAGE_KEYS.currentCard, null);
}

export function saveClearanceSession(session) {
  storageSet(STORAGE_KEYS.clearanceSession, session || "");
}

export function loadClearanceSession() {
  return storageGet(STORAGE_KEYS.clearanceSession, null);
}

async function normalizeResponse(response) {
  if (response && typeof response.json === "function") {
    return {
      statusCode: Number(response.status || 0),
      payload: await response.json()
    };
  }

  let payload = response?.data ?? {};
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = { error: payload };
    }
  }
  return {
    statusCode: Number(response?.statusCode || response?.status || 0),
    payload
  };
}

async function request(config, path, method = "GET", data) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json"
  };
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`;
  const url = `${normalizeBaseUrl(config.apiBaseUrl)}${path}`;
  const runtimeWx = globalThis.wx;
  let response;

  if (runtimeWx?.request) {
    response = await new Promise((resolve, reject) => {
      const requestResult = runtimeWx.request({
        url,
        method,
        header: headers,
        data,
        dataType: "json",
        responseType: "text",
        success: resolve,
        fail: reject
      });
      if (requestResult && typeof requestResult.then === "function") {
        requestResult.then(resolve, reject);
      } else if (
        requestResult &&
        (
          typeof requestResult.json === "function" ||
          "statusCode" in requestResult ||
          "status" in requestResult
        )
      ) {
        resolve(requestResult);
      }
    });
  } else if (typeof globalThis.fetch === "function") {
    response = await globalThis.fetch(url, {
      method,
      headers,
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
  } else {
    throw new Error("This AIUI runtime provides neither wx.request nor fetch");
  }

  const { statusCode, payload } = await normalizeResponse(response);
  if (statusCode < 200 || statusCode >= 300 || payload.ok === false) {
    throw new Error(payload.error || `Learn Coach HTTP ${statusCode || "error"}`);
  }
  return payload;
}

export function checkConnection(config) {
  return request(config, "/health");
}

export function fetchSession(config, duration = config.duration || DEFAULT_SESSION_DURATION, demo = false) {
  return request(config, `/api/rokid/session?duration=${duration}${demo ? "&demo=1" : ""}`);
}

export function sendTutorAction(config, card, action, transcript = "", progress = {}) {
  return request(config, "/api/rokid/tutor", "POST", {
    card,
    action,
    transcript,
    progress
  });
}

export function sendReview(config, cardId, result, responseText = "") {
  return request(config, "/api/rokid/review", "POST", {
    cardId,
    result,
    responseText
  });
}

export function importMaterial(config, text, projectId = "rokid-import") {
  return request(config, "/api/rokid/import", "POST", {
    text,
    projectId,
    maxCards: 5
  });
}

export function fetchClearanceEntry(config) {
  if (config.reportId && config.cardId) {
    return request(config, `/api/mvp0/reports/${encodeURIComponent(config.reportId)}`).then(payload => {
      const report = payload.report;
      const cards = report?.sections?.feynmanCards || [];
      const card = cards.find(item => item.id === config.cardId);
      if (!card) throw new Error("Configured cognitive debt card was not found");
      const rawDomain = report.analysis?.userCapability?.currentDomain || "认知债务";
      const domain = /server|linux|nginx|systemd|cloudflare/i.test(rawDomain)
        ? "服务器部署与运维"
        : String(rawDomain).slice(0, 18);
      return {
        ok: true,
        platform: "rokid-aiui",
        entry: {
          reportId: report.id,
          cardId: card.id,
          createdAt: report.createdAt,
          domain,
          target: card.target || "理解缺口",
          prompt: card.prompt || "请用自己的话解释这个问题。",
          cardNumber: cards.findIndex(item => item.id === card.id) + 1,
          cardCount: cards.length
        }
      };
    });
  }
  return request(config, "/api/rokid/clearance-entry");
}

export function startClearance(config, reportId, cardId) {
  return request(config, "/api/mvp1/sessions", "POST", { reportId, cardId });
}

export function submitClearanceAnswer(config, sessionId, answer) {
  return request(config, `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/answers`, "POST", { answer });
}

export function endClearance(config, sessionId) {
  return request(config, `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/end`, "POST");
}
