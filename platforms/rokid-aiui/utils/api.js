import {
  DEFAULT_API_BASE_URL,
  DEFAULT_SESSION_DURATION,
  STORAGE_KEYS
} from "../config.js";

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, "");
}

function storageGet(key, fallback = "") {
  try {
    if (typeof wx !== "undefined" && wx.getStorageSync) {
      return wx.getStorageSync(key) || fallback;
    }
  } catch (error) {
    console.warn("Storage read failed", error);
  }
  return fallback;
}

function storageSet(key, value) {
  try {
    if (typeof wx !== "undefined" && wx.setStorageSync) {
      wx.setStorageSync(key, value);
    }
  } catch (error) {
    console.warn("Storage write failed", error);
  }
}

export function getRuntimeConfig(query = {}) {
  const appData = typeof getApp === "function" ? getApp()?.globalData || {} : {};
  const apiBaseUrl = normalizeBaseUrl(
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
  return { apiBaseUrl, apiToken, duration };
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
  const response = await new Promise((resolve, reject) => {
    const requestResult = wx.request({
      url: `${normalizeBaseUrl(config.apiBaseUrl)}${path}`,
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
  const { statusCode, payload } = await normalizeResponse(response);
  if (statusCode < 200 || statusCode >= 300 || payload.ok === false) {
    throw new Error(payload.error || `Learn Coach HTTP ${statusCode || "error"}`);
  }
  return payload;
}

export function checkConnection(config) {
  return request(config, "/health?live=1");
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
