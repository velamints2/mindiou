export function commandFromUtterance(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[。.!！?？,，]/g, "");
  if (!text || text.length > 12) return "answer";
  if (["下一个", "下一题", "下一张", "next"].includes(text)) return "next";
  if (["上一个", "上一题", "上一张", "previous"].includes(text)) return "previous";
  if (["重复", "再说一遍", "repeat"].includes(text)) return "repeat";
  if (["提问", "问我", "ask"].includes(text)) return "ask";
  if (["会了", "懂了", "got it", "known"].includes(text)) return "known";
  if (["跳过", "skip"].includes(text)) return "skip";
  return "answer";
}

export function assessmentToReview(assessment) {
  if (assessment === "correct") return "mastered";
  if (assessment === "incorrect") return "incorrect";
  return "partial";
}

export function conciseFeedback(payload) {
  if (!payload) return "请再试一次。";
  return String(
    payload.display?.feedback
      || payload.tutor?.g2Text
      || payload.tutor?.message
      || payload.message
      || "继续用自己的话解释。"
  ).slice(0, 72);
}
