export function commandFromUtterance(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[。.!！?？,，]/g, "");
  if (!text || text.length > 12) return "answer";
  if (["下一个", "下一题", "下一张", "next"].includes(text)) return "next";
  if (["上一个", "上一题", "上一张", "previous"].includes(text)) return "previous";
  if (["重复", "再说一遍", "repeat"].includes(text)) return "repeat";
  if (["提问", "问我", "ask"].includes(text)) return "ask";
  if (["会了", "懂了", "got it", "known"].includes(text)) return "known";
  if (["跳过", "skip"].includes(text)) return "skip";
  if (["结束清偿", "结束学习", "完成清偿", "结束", "end", "stop"].includes(text)) return "end";
  return "answer";
}

export function clearanceStatusLabel(status) {
  const labels = {
    provisionally_cleared: "暂时清偿",
    needs_practice: "继续练习",
    needs_verification: "需要查证",
    no_valid_attempt: "尚未作答"
  };
  return labels[status] || "继续解释";
}

export function conciseClearanceText(analysis) {
  return String(analysis?.feedback || analysis?.teaching || "请再用自己的话解释一次。").slice(0, 96);
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
