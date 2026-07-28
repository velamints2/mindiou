/**
 * 训练系统核心类型定义
 *
 * 将现有 MVP-1 清偿会话扩展为完整的训练记录体系，
 * 支持多阶段训练、分级提示、掌握度追踪和复训调度。
 */

// ─── 训练阶段 ───

export type TrainingStage =
  | "initial_compensation"    // 首次补偿训练
  | "delayed_recall"           // 延迟无提示回忆
  | "misconception_check"      // 概念边界与误区识别
  | "scenario_transfer"        // 新场景迁移
  | "error_detection"          // 错误识别
  | "real_work_validation";    // 真实工作验证

// ─── 任务类型 ───

export type TaskType =
  | "feynman_explanation"      // 费曼解释
  | "short_recall"             // 快速回忆
  | "concept_comparison"       // 概念对比
  | "scenario_judgment"        // 场景判断
  | "error_detection"          // 错误识别
  | "micro_practice";          // 微型练习

// ─── 提示类型 ───

export type HintType =
  | "direction"               // L1: 方向提醒
  | "question"                // L2: 追问提示
  | "keyword"                 // L3: 关键词提示
  | "partial_structure"       // L4: 结构提示
  | "example"                 // L5: 部分答案或示例
  | "direct_explanation";     // L6: 直接补偿解释

// ─── 理解水平 ───

export type UnderstandingLevel =
  | "not_understood"           // 未理解
  | "prompt_supported"         // 在提示支持下完成
  | "initially_understood"     // 初步理解
  | "independently_explainable" // 能够独立解释
  | "transferable"             // 能够迁移使用
  | "stable_mastery";          // 已形成稳定掌握

// ─── 认知欠条状态 ───

export type CognitiveDebtStatus =
  | "new"                       // 新识别
  | "initial_training"          // 正在首次训练
  | "initially_understood"      // 首次训练完成
  | "review_scheduled"          // 已安排复训
  | "review_due"                // 复训到期
  | "independently_explainable"  // 独立解释通过
  | "transfer_training"         // 迁移训练中
  | "mastered"                  // 已掌握
  | "relapsed"                  // 复发
  | "ignored";                  // 已忽略

// ─── 提示事件 ───

export interface HintEvent {
  id: string;

  /** 提示级别 1-6 */
  level: number;

  /** 提示类型 */
  hintType: HintType;

  /** 提示内容 */
  content: string;

  /** 请求提示的时间 */
  requestedAt: string;

  /** 提示前的用户回答 */
  answerBeforeHint?: string;

  /** 提示后的用户回答 */
  answerAfterHint?: string;

  /** 提示暴露的知识点（用于评估提示依赖） */
  exposedKnowledgePoints: string[];
}

// ─── 训练评估 ───

export interface TrainingEvaluation {
  /** 总分 0-100 */
  overallScore: number;

  /** 是否通过本次训练 */
  passed: boolean;

  /** 概念准确性 0-100 */
  conceptualAccuracy: number;

  /** 完整性 0-100 */
  completeness: number;

  /** 独立回忆能力 0-100 */
  independentRecall: number;

  /** 提示依赖度 0-100（越高越依赖） */
  hintDependency: number;

  /** 迁移能力 0-100 */
  transferAbility: number;

  /** 延迟保持强度 0-100 */
  retentionStrength?: number;

  /** 理解水平 */
  understandingLevel: UnderstandingLevel;

  /** 做得好的部分 */
  strengths: string[];

  /** 仍然缺失的部分 */
  missingPoints: string[];

  /** 误解 */
  misconceptions: string[];

  /** 下一次训练目标 */
  nextTrainingGoal: string;

  /** 推荐的下一个训练阶段 */
  recommendedNextStage: TrainingStage;

  /** 给用户的反馈文本 */
  userFeedback: string;
}

// ─── 训练记录 ───

export interface TrainingAttempt {
  id: string;

  userId: string;
  cardId: string;
  cognitiveDebtId: string;
  capabilityId?: string;

  /** 训练阶段 */
  trainingStage: TrainingStage;

  /** 任务类型 */
  taskType: TaskType;

  /** 原始问题 */
  originalPrompt: string;

  /** 初始独立回答（提示前） */
  initialAnswer?: string;

  /** 最终回答 */
  finalAnswer: string;

  /** 提示事件记录 */
  hintEvents: HintEvent[];

  /** 训练评估 */
  evaluation: TrainingEvaluation;

  /** 开始时间 */
  startedAt: string;

  /** 完成时间 */
  completedAt: string;

  /** 训练时长（秒） */
  durationSeconds?: number;

  /** 关联的 MVP-1 清偿会话 ID（兼容字段） */
  clearanceSessionId?: string;
}

// ─── 掌握度画像 ───

export interface MasteryProfile {
  cognitiveDebtId: string;
  capabilityId?: string;

  /** 概念理解 0-100 */
  conceptualUnderstanding: number;

  /** 独立回忆 0-100 */
  independentRecall: number;

  /** 提示独立性 0-100（越高越独立） */
  hintIndependence: number;

  /** 误区抵抗力 0-100 */
  misconceptionResistance: number;

  /** 迁移能力 0-100 */
  transferAbility: number;

  /** 延迟保持 0-100 */
  retentionStrength: number;

  /** 综合掌握度 0-100 */
  overallMastery: number;

  /** 当前训练阶段（1-5） */
  currentStage: number;

  /** 上次训练时间 */
  lastAttemptAt?: string;

  /** 下次复训时间 */
  nextReviewAt?: string;

  /** 成功次数 */
  successfulAttempts: number;

  /** 失败次数 */
  failedAttempts: number;

  /** 复发次数 */
  relapseCount: number;
}

// ─── 复训任务 ───

export interface ReviewTask {
  id: string;
  userId: string;
  cognitiveDebtId: string;
  cardId: string;

  /** 复训阶段 */
  trainingStage: TrainingStage;

  /** 任务类型 */
  taskType: TaskType;

  /** 复训问题 */
  prompt: string;

  /** 是否允许提示 */
  hintsAllowed: boolean;

  /** 最大提示次数 */
  maxHints: number;

  /** 创建时间 */
  createdAt: string;

  /** 到期时间 */
  dueAt: string;

  /** 状态 */
  status: "pending" | "in_progress" | "completed" | "skipped";

  /** 关联的训练记录 ID（完成后填充） */
  attemptId?: string;
}

// ─── 能力节点 ───

export interface CapabilityNode {
  id: string;
  name: string;
  parentId?: string;

  /** 关联的认知欠条 ID 列表 */
  cognitiveDebtIds: string[];

  /** 综合掌握度 0-100 */
  overallMastery: number;

  /** 创建时间 */
  createdAt: string;
}

// ─── 掌握度权重配置 ───

export const MASTERY_WEIGHTS = {
  conceptualUnderstanding: 0.25,
  independentRecall: 0.20,
  hintIndependence: 0.15,
  misconceptionResistance: 0.10,
  transferAbility: 0.20,
  retentionStrength: 0.10
} as const;

// ─── 复训间隔配置（毫秒） ───

export const REVIEW_INTERVALS = {
  // 首次训练高质量完成且无提示
  initialHighQuality: 3 * 24 * 60 * 60 * 1000,  // 3天
  // 首次训练完成但使用少量提示
  initialWithHints: 1 * 24 * 60 * 60 * 1000,     // 1天
  // 首次训练高度依赖提示
  initialHighDependency: 6 * 60 * 60 * 1000,      // 6小时
  // 延迟回忆通过
  delayedRecallPassed: 7 * 24 * 60 * 60 * 1000,  // 7天
  // 迁移训练通过
  transferPassed: 14 * 24 * 60 * 60 * 1000,      // 14天
  // 连续稳定通过
  stableMastery: 30 * 24 * 60 * 60 * 1000,        // 30天
  // 复训失败
  reviewFailed: 12 * 60 * 60 * 1000,               // 12小时
} as const;

// ─── 训练阶段映射 ───

export const STAGE_NUMBER: Record<TrainingStage, number> = {
  initial_compensation: 1,
  delayed_recall: 2,
  misconception_check: 3,
  scenario_transfer: 4,
  error_detection: 4,
  real_work_validation: 5
};

// ─── 状态流转规则 ───

export const STATUS_TRANSITIONS: Record<CognitiveDebtStatus, CognitiveDebtStatus[]> = {
  new: ["initial_training", "ignored"],
  initial_training: ["initially_understood", "ignored"],
  initially_understood: ["review_scheduled", "relapsed", "ignored"],
  review_scheduled: ["review_due", "ignored"],
  review_due: ["independently_explainable", "initially_understood", "relapsed", "ignored"],
  independently_explainable: ["transfer_training", "review_scheduled", "relapsed"],
  transfer_training: ["mastered", "independently_explainable", "relapsed"],
  mastered: ["relapsed", "review_scheduled"],
  relapsed: ["initial_training", "delayed_recall" as CognitiveDebtStatus, "ignored"],
  ignored: ["new"]
};
