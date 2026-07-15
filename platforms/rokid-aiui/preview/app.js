const params = new URL(location.href).searchParams;
const publicDeployment = location.pathname.startsWith('/mindiou/');
const apiBaseUrl = (
  publicDeployment
    ? `${location.origin}/mindiou-api`
    : params.get("api") || ""
).replace(/\/+$/, "");
const staticDemo = params.get("demo") === "1";
const directReportId = params.get("reportId") || "";
const directCardId = params.get("cardId") || "";

const elements = {
  progress: document.querySelector("#progress"),
  domain: document.querySelector("#domain"),
  status: document.querySelector("#status"),
  target: document.querySelector("#target"),
  question: document.querySelector("#question"),
  feedback: document.querySelector("#feedback"),
  followUp: document.querySelector("#follow-up"),
  answer: document.querySelector("#answer"),
  submit: document.querySelector("#answer-form button"),
  end: document.querySelector("#end"),
  source: document.querySelector("#source")
};

let session = null;

async function request(path, options) {
  if (!apiBaseUrl) throw new Error("Learning API URL is required");
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function showFeedback(text, followUp = "") {
  document.body.classList.toggle("has-feedback", Boolean(text || followUp));
  elements.feedback.textContent = text;
  elements.feedback.hidden = !text;
  elements.followUp.textContent = followUp;
  elements.followUp.hidden = !followUp;
}

function setReady(value) {
  elements.submit.disabled = !value;
  elements.end.disabled = !value;
}

function loadStaticDemo() {
  session = { id: "preview-session", sources: [{ id: "source-1" }, { id: "source-2" }] };
  elements.progress.textContent = "1 / 4";
  elements.domain.textContent = "AR 眼镜网络调试";
  elements.status.textContent = "请直接口述回答";
  elements.target.textContent = "WebView 请求边界";
  elements.question.textContent = "为什么 API 在电脑浏览器可访问，在光波导眼镜中仍可能请求失败？";
  elements.source.textContent = "2 个来源";
  elements.source.disabled = false;
  setReady(true);
}

async function load() {
  session = null;
  setReady(false);
  showFeedback("");
  elements.status.textContent = "读取认知欠条";
  if (staticDemo) {
    loadStaticDemo();
    return;
  }
  try {
    if (directReportId && directCardId) {
      elements.progress.textContent = "1 / 1";
      elements.domain.textContent = "MVP-1 清偿";
      elements.target.textContent = "正在准备你的费曼问题";
      elements.status.textContent = "检索外部证据";
      const started = await request("/api/mvp1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId: directReportId, cardId: directCardId })
      });
      session = started.session;
      elements.target.textContent = session.originalCard.target || "认知债务";
      elements.question.textContent = session.clearanceQuestion;
      elements.status.textContent = "请直接口述回答";
      elements.source.textContent = `${session.sources.length} 个来源`;
      elements.source.disabled = false;
      setReady(true);
      return;
    }
    if (publicDeployment) {
      elements.status.textContent = "请从报告进入";
      elements.target.textContent = "缺少当前报告 ID";
      elements.question.textContent = "请先返回 MVP-0 生成认知欠条报告，再点击费曼卡中的“开始 MVP-1 清偿”。";
      return;
    }
    const entryPayload = await request("/api/rokid/clearance-entry");
    const entry = entryPayload.entry;
    if (!entry) {
      elements.status.textContent = "暂无认知欠条";
      elements.target.textContent = "先在电脑端生成报告";
      elements.question.textContent = "导入一段 AI 对话并生成认知欠条报告后，再回到眼镜开始清偿。";
      elements.progress.textContent = "0 / 0";
      return;
    }
    elements.progress.textContent = `${entry.cardNumber} / ${entry.cardCount}`;
    elements.domain.textContent = entry.domain;
    elements.target.textContent = entry.target;
    elements.question.textContent = entry.prompt;
    elements.status.textContent = "检索外部证据";
    const started = await request("/api/mvp1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId: entry.reportId, cardId: entry.cardId })
    });
    session = started.session;
    elements.question.textContent = session.clearanceQuestion;
    elements.status.textContent = "请直接口述回答";
    elements.source.textContent = `${session.sources.length} 个来源`;
    elements.source.disabled = false;
    setReady(true);
  } catch (error) {
    elements.status.textContent = "暂时无法开始";
    elements.target.textContent = "连接或 AI 研究失败";
    elements.question.textContent = error.message;
    showFeedback("检查后端地址、OPENAI_API_KEY 与网络后重试。");
  }
}

document.querySelector("#restart").addEventListener("click", load);

document.querySelector("#source").addEventListener("click", () => {
  if (!session) return;
  showFeedback(`已核对 ${session.sources.length} 个来源。回答前不显示解释提纲。`);
});

document.querySelector("#answer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const answer = elements.answer.value.trim();
  if (!answer || !session) return;
  elements.status.textContent = "分析你的解释";
  try {
    if (staticDemo) {
      elements.status.textContent = "继续解释";
      showFeedback("你区分了网络可达性，但还没有说明 WebView 的跨域读取限制。", "CORS 控制的是请求发送，还是 JavaScript 读取响应？");
      return;
    }
    const payload = await request(`/api/mvp1/sessions/${encodeURIComponent(session.id)}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer })
    });
    session = payload.session;
    const analysis = payload.attempt.analysis;
    elements.status.textContent = analysis.recommendation === "end" ? "可以结束" : "继续解释";
    showFeedback(analysis.feedback || analysis.teaching, analysis.nextQuestion || analysis.teaching);
  } catch (error) {
    elements.status.textContent = "分析失败";
    showFeedback(error.message);
  }
});

document.querySelector("#end").addEventListener("click", async () => {
  if (!session) return;
  if (staticDemo) {
    elements.status.textContent = "本轮结束";
    elements.target.textContent = "继续练习";
    elements.question.textContent = "先补齐 WebView 请求链路，再做一次完整解释。";
    showFeedback("结果是谨慎判断，不等于永久掌握。");
    setReady(false);
    return;
  }
  try {
    const payload = await request(`/api/mvp1/sessions/${encodeURIComponent(session.id)}/end`, { method: "POST" });
    session = payload.session;
    elements.status.textContent = "本轮结束";
    elements.target.textContent = payload.result.status.replaceAll("_", " ");
    elements.question.textContent = payload.result.nextRecommendation;
    showFeedback(payload.result.sourceReviewRequired ? "关键判断包含普通网页来源，需要查证。" : "结果是谨慎判断，不等于永久掌握。");
    setReady(false);
  } catch (error) {
    showFeedback(error.message);
  }
});

void load();
