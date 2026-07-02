const params = new URL(location.href).searchParams;
const apiBaseUrl = (params.get("api") || "http://localhost:8793").replace(/\/+$/, "");
const demo = params.get("demo") !== "0";

const elements = {
  progress: document.querySelector("#progress"),
  priority: document.querySelector("#priority"),
  status: document.querySelector("#status"),
  concept: document.querySelector("#concept"),
  question: document.querySelector("#question"),
  feedback: document.querySelector("#feedback"),
  answer: document.querySelector("#answer")
};

let cards = [];
let index = 0;

function card() {
  return cards[index];
}

function render() {
  const current = card();
  if (!current) return;
  elements.progress.textContent = `${index + 1} / ${cards.length}`;
  elements.priority.textContent = current.debtScore
    ? `DEBT ${Math.round(current.debtScore)}`
    : "ACTIVE RECALL";
  elements.concept.textContent = current.front;
  elements.concept.className = current.front.length > 24
    ? "compact"
    : current.front.length > 14
      ? "long"
      : "";
  elements.question.textContent = current.prompt;
  elements.feedback.hidden = true;
}

function showFeedback(text, status = "继续解释") {
  elements.status.textContent = status;
  elements.feedback.textContent = text;
  elements.feedback.hidden = false;
}

async function request(path, options) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function load() {
  try {
    const payload = await request(`/api/rokid/session?duration=60${demo ? "&demo=1" : ""}`);
    cards = payload.session.cards;
    elements.status.textContent = payload.display.mode === "demo" ? "演示模式" : "请先回答";
    render();
  } catch (error) {
    showFeedback(error.message, "连接失败");
  }
}

document.querySelector("#next").addEventListener("click", () => {
  index = Math.min(cards.length - 1, index + 1);
  render();
});

document.querySelector("#hint").addEventListener("click", () => {
  showFeedback(card().back, "提示");
});

document.querySelector("#known").addEventListener("click", async () => {
  if (card().id.startsWith("demo-")) {
    showFeedback("演示卡已完成。", "已掌握");
    return;
  }
  try {
    await request("/api/rokid/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: card().id, result: "mastered" })
    });
    showFeedback("这笔学习债务已清偿。", "已掌握");
  } catch (error) {
    showFeedback(error.message, "保存失败");
  }
});

document.querySelector("#answer-form").addEventListener("submit", async event => {
  event.preventDefault();
  const transcript = elements.answer.value.trim();
  if (!transcript) return;
  elements.status.textContent = "AI 评估中";
  try {
    const payload = await request("/api/rokid/tutor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ card: card(), action: "answer", transcript })
    });
    showFeedback(
      payload.tutor.nextQuestion || payload.tutor.message,
      String(payload.tutor.assessment || "评估完成").toUpperCase()
    );
  } catch (error) {
    showFeedback(error.message, "评估失败");
  }
});

void load();
