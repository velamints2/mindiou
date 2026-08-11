/**
 * 自适应代劳策略（纯函数，无网络依赖）。
 *
 * 根据 任务风险 × 用户证据等级 推荐 AI Agent 的代劳程度，
 * 对应产品文档中的六种协助模式。
 */

export const ASSISTANCE_MODES = [
  "auto_execute",
  "execute_then_explain",
  "ask_before_decision",
  "scaffold_only",
  "user_first",
  "verify_only"
];

export const RISK_LEVELS = ["low", "medium", "high"];

// understandingLevel（mastery.js）→ 证据等级回退映射
const UNDERSTANDING_TO_EVIDENCE = {
  not_understood: "E0",
  initial_training: "E1",
  initially_understood: "E2",
  independently_explainable: "E3",
  transfer_training: "E4",
  mastered: "E5"
};

const MODE_TABLE = {
  high: {
    E0: "ask_before_decision",
    E1: "ask_before_decision",
    E2: "ask_before_decision",
    E3: "scaffold_only",
    E4: "execute_then_explain",
    E5: "execute_then_explain"
  },
  medium: {
    E0: "execute_then_explain",
    E1: "execute_then_explain",
    E2: "execute_then_explain",
    E3: "scaffold_only",
    E4: "verify_only",
    E5: "auto_execute"
  },
  low: {
    E0: "execute_then_explain",
    E1: "execute_then_explain",
    E2: "execute_then_explain",
    E3: "scaffold_only",
    E4: "auto_execute",
    E5: "auto_execute"
  }
};

const MODE_REASONS = {
  auto_execute: "用户在该领域已有充分掌握证据，且任务风险可接受，AI 可直接完成",
  execute_then_explain: "用户理解证据有限，AI 完成后必须解释关键决策",
  ask_before_decision: "任务风险高且用户尚未通过相关验证，关键选择前必须先让用户判断",
  scaffold_only: "用户已有一定理解，AI 只搭框架，关键部分由用户完成以建立迁移能力",
  user_first: "需要验证用户的独立能力，用户先给方案，AI 再反馈",
  verify_only: "用户接近真正掌握，由其独立完成，AI 只负责验收"
};

export function normalizeEvidenceLevel(value, understandingLevel) {
  if (typeof value === "string" && /^E[0-5]$/.test(value)) return value;
  return UNDERSTANDING_TO_EVIDENCE[understandingLevel] || "E0";
}

export function normalizeRiskLevel(value) {
  return RISK_LEVELS.includes(value) ? value : "medium";
}

/**
 * @param {object} input
 * @param {string} [input.evidenceLevel] E0-E5
 * @param {string} [input.understandingLevel] 掌握度等级（无证据等级时回退使用）
 * @param {string} [input.riskLevel] low/medium/high
 * @param {string} [input.userPreference] 用户主动选择的模式（优先级最高）
 */
export function recommendAssistanceMode(input = {}) {
  if (ASSISTANCE_MODES.includes(input.userPreference)) {
    return {
      mode: input.userPreference,
      evidenceLevel: normalizeEvidenceLevel(input.evidenceLevel, input.understandingLevel),
      riskLevel: normalizeRiskLevel(input.riskLevel),
      source: "user_preference",
      reason: "用户主动选择该协助模式"
    };
  }
  const evidenceLevel = normalizeEvidenceLevel(input.evidenceLevel, input.understandingLevel);
  const riskLevel = normalizeRiskLevel(input.riskLevel);
  const mode = MODE_TABLE[riskLevel][evidenceLevel];
  return {
    mode,
    evidenceLevel,
    riskLevel,
    source: "evidence_risk_table",
    reason: `${MODE_REASONS[mode]}（证据等级 ${evidenceLevel}，风险 ${riskLevel}）`
  };
}
