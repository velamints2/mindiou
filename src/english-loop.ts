export type SpeakingAbilityKey =
  | "product_intro"
  | "daily_conversation"
  | "facts"
  | "complex_opinion"
  | "causal_explanation"
  | "tradeoff"
  | "improvised_rebuttal";

export type SpeakingAbility = {
  key: SpeakingAbilityKey;
  label: string;
  signal: number;
};

export type SpeakingPatterns = {
  vocabularyRepetition: number;
  sentenceOrganization: number;
  translationDependence: number;
  abstractPauses: number;
  tenseControl: number;
  articleControl: number;
  businessExpression: number;
};

export type ExpressionDebt = {
  id: string;
  phrase: string;
  meaning: string;
  context: string;
  occurrences: number;
  status: "candidate" | "active" | "practicing" | "stable";
  firstSeenAt: string;
  lastSeenAt: string;
};

export type NextPractice = {
  type: "conversation" | "opinion_structure" | "tradeoff" | "expression_reuse";
  title: string;
  reason: string;
  task: string;
  durationMinutes: number;
  structure: string[];
};

export type LoopDecisionType = "update" | "debt" | "information" | "experiment" | "nothing";

export type EnglishLoopGoal = {
  statement: string;
  deadline: string;
  importance: "high" | "medium" | "low";
};

export type EnglishLoopLearnerState =
  | "in_progress"
  | "completed"
  | "stuck"
  | "off_topic"
  | "unclear_audio";

export type EnglishLoopActionType =
  | "continue"
  | "clarify"
  | "minimal_hint"
  | "recast"
  | "post_turn_feedback"
  | "end_task";

export type EnglishSuccessCriterion =
  | "relevant_response"
  | "gives_opinion"
  | "explains_cause"
  | "gives_example"
  | "discusses_tradeoff"
  | "conclusion"
  | "target_expression";

export type EnglishMasteryStatus =
  | "unknown"
  | "candidate"
  | "emerging"
  | "provisional"
  | "stable"
  | "needs_review";

export type EnglishSessionDifficulty =
  | "calibration"
  | "current"
  | "slightly_above_current"
  | "transfer"
  | "review";

export type EnglishMasteryRecord = {
  criterion: EnglishSuccessCriterion;
  status: EnglishMasteryStatus;
  evidenceCount: number;
  successfulSessionIds: string[];
  independentSessionIds: string[];
  promptedSuccesses: number;
  contradictionCount: number;
  topicKeys: string[];
  dateKeys: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  lastIndependentAt: string;
  nextReviewAt: string;
  confidence: number;
};

export type SessionPlan = {
  id: string;
  version: 1;
  topic: string;
  goal: string;
  taskType: NextPractice["type"];
  targetSkill: SpeakingAbilityKey | "general";
  targetExpression?: string;
  task: string;
  successCriteria: EnglishSuccessCriterion[];
  maxTurns: number;
  feedbackPolicy: "after_turn" | "on_request" | "minimal";
  difficulty: EnglishSessionDifficulty;
  reviewCriterion?: EnglishSuccessCriterion;
  createdAt: string;
};

export type TurnEvidence = {
  id: string;
  sessionId: string;
  observedAt: string;
  wordCount: number;
  signals: EnglishTurnSignals;
  state: EnglishLoopLearnerState;
  action: EnglishLoopActionType;
  criteriaMet: EnglishSuccessCriterion[];
  missingCriteria: EnglishSuccessCriterion[];
  observations: string[];
  evidenceType: "independent_success" | "partial" | "stuck" | "unclear_audio" | "not_observed";
  confidence: number;
  audioConfidence?: number;
  topicKey?: string;
};

export type ConversationAction = {
  state: EnglishLoopLearnerState;
  action: EnglishLoopActionType;
  reasonEvidence: string[];
  nextUserAction: string;
  shouldUpdateLongTermProfile: boolean;
};

export type SessionReflection = {
  sessionId: string;
  completed: boolean;
  turnCount: number;
  evidenceCount: number;
  criteriaCompleted: EnglishSuccessCriterion[];
  recurringGaps: EnglishSuccessCriterion[];
  wins: string[];
  candidateGaps: string[];
  nextExperiment: string;
  profileUpdateAllowed: boolean;
  confidence: number;
  completedAt: string;
};

export type EvidenceEvent = {
  id: string;
  sessionId: string;
  at: string;
  wordCount: number;
  signals: Pick<
    EnglishTurnSignals,
    "hasChinese" | "givesOpinion" | "explainsCause" | "givesExample" | "discussesTradeoff" | "rebuts"
  >;
  confidence: number;
  learnerState?: EnglishLoopLearnerState;
  action?: EnglishLoopActionType;
  criteriaMet?: EnglishSuccessCriterion[];
  missingCriteria?: EnglishSuccessCriterion[];
  evidenceType?: TurnEvidence["evidenceType"];
};

export type LoopDecision = {
  type: LoopDecisionType;
  id?: string;
  title: string;
  reason: string;
  evidenceCount: number;
  sessionCount: number;
  confidence: number;
  action?: string;
  hypothesis?: string;
  expectedOutcome?: string;
};

export type InterventionRecord = {
  id: string;
  type: LoopDecisionType;
  title: string;
  hypothesis: string;
  expectedOutcome: string;
  createdAt: string;
  status: "open" | "helpful" | "not_helpful" | "unverified";
  userNote: string;
};

export type EnglishLoopReply = {
  reply?: string;
  nextPrompt?: string;
  moveType?: SpeakingMoveType;
  state?: EnglishLoopLearnerState;
  action?: EnglishLoopActionType;
};

export type SpeakingProfile = {
  version: 1;
  sessions: number;
  turns: number;
  minutes: number;
  lastSessionAt: string;
  abilities: SpeakingAbility[];
  patterns: SpeakingPatterns;
  expressionDebts: ExpressionDebt[];
  recentTopics: string[];
  currentFocus: NextPractice["type"];
  nextPractice: NextPractice;
  goal: EnglishLoopGoal;
  evidenceEvents: EvidenceEvent[];
  lastDecision: LoopDecision;
  interventions: InterventionRecord[];
  masteryRecords: EnglishMasteryRecord[];
  sessionPlan?: SessionPlan;
  lastTurnEvidence?: TurnEvidence;
  lastSessionReflection?: SessionReflection;
};

export type EnglishTurnSignals = {
  wordCount: number;
  hasChinese: boolean;
  mentionsProduct: boolean;
  describesPast: boolean;
  givesOpinion: boolean;
  explainsCause: boolean;
  givesExample: boolean;
  discussesTradeoff: boolean;
  rebuts: boolean;
  repeatsSimpleWords: boolean;
  expressionCandidates: string[];
};

export type SpeakingMoveType =
  | "goal_link"
  | "cause"
  | "example"
  | "tradeoff"
  | "conclusion"
  | "q_and_a"
  | "free"
  | "opinion_structure"
  | "tradeoff_practice"
  | "expression_reuse";

const replyStopWords = new Set([
  "about", "because", "which", "there", "their", "would", "could", "should", "think", "really",
  "thing", "things", "something", "important", "matter", "matters", "today", "project", "product"
]);

type ExpressionCandidate = Omit<ExpressionDebt, "id" | "occurrences" | "status" | "firstSeenAt" | "lastSeenAt">;

const abilityDefinitions: Array<Pick<SpeakingAbility, "key" | "label">> = [
  { key: "product_intro", label: "介绍产品与项目" },
  { key: "daily_conversation", label: "日常交流" },
  { key: "facts", label: "描述事实" },
  { key: "complex_opinion", label: "表达复杂观点" },
  { key: "causal_explanation", label: "解释因果" },
  { key: "tradeoff", label: "讨论取舍" },
  { key: "improvised_rebuttal", label: "即兴回应与反驳" }
];

const expressionCandidates: Array<ExpressionCandidate & { triggers: RegExp }> = [
  {
    phrase: "short-term payoff",
    meaning: "短期收益",
    context: "表达一个方向短期能带来的回报",
    triggers: /short[- ]?term|payoff|immediate return|短期收益|短期回报/i
  },
  {
    phrase: "strategic value",
    meaning: "战略价值",
    context: "解释一个方向为什么具有长期战略意义",
    triggers: /strategic value|strategic importance|战略价值|战略意义/i
  },
  {
    phrase: "in the long run",
    meaning: "从长期来看",
    context: "把短期成本和长期结果放在一起比较",
    triggers: /in the long run|long[- ]term|从长期|长期来看/i
  },
  {
    phrase: "justify the investment",
    meaning: "证明这项投入是值得的",
    context: "解释为什么时间、预算或注意力投入合理",
    triggers: /justify (the )?investment|worth the investment|值得.*投入|投入.*合理/i
  },
  {
    phrase: "trade-off",
    meaning: "取舍关系",
    context: "同时说明一个选择带来的收益和代价",
    triggers: /trade[- ]?off|upside.*downside|benefit.*cost|取舍|权衡/i
  }
];

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isUsefulEnglishLoopResponse(
  response: EnglishLoopReply,
  transcript: string,
  previousPrompt = "",
  expectedMove?: SpeakingMoveType,
  expectedAction?: EnglishLoopActionType
): boolean {
  const reply = clean(response.reply || "");
  const nextPrompt = clean(response.nextPrompt || "");
  if (reply.length < 24 || nextPrompt.length < 12) return false;
  if (/^(that's interesting|interesting|tell me more|keep going|good job|well said)[.! ]*$/i.test(reply)) return false;
  if (/^(tell me more|keep going|go on|say more)[.!? ]*$/i.test(nextPrompt)) return false;
  if (previousPrompt && nextPrompt.toLowerCase() === previousPrompt.toLowerCase()) return false;
  const anchors = (transcript.toLowerCase().match(/[a-z]{5,}/g) || [])
    .filter(word => !replyStopWords.has(word));
  const responseText = `${reply} ${nextPrompt}`.toLowerCase();
  if (!anchors.some(anchor => responseText.includes(anchor))) return false;
  if (expectedAction && response.action !== expectedAction) return false;
  if (expectedAction === "clarify" && !/(repeat|again|catch|hear|one sentence|connect|current topic)/i.test(nextPrompt)) return false;
  if (expectedAction === "minimal_hint" && /here is the answer|the correct answer is|you should say exactly/i.test(reply)) return false;
  if (!expectedMove) return true;
  const movePatterns: Record<SpeakingMoveType, RegExp> = {
    goal_link: /goal|matter|relevant|important|useful for/i,
    cause: /why|reason|because|cause|lead to/i,
    example: /example|instance|specific|concrete|from your work/i,
    tradeoff: /trade[- ]?off|upside|downside|gain|give up|cost|benefit/i,
    conclusion: /conclusion|next|should|recommend|decision|action/i,
    q_and_a: /why|matter|now|stakeholder|30[- ]second/i,
    free: /why|next|do|think/i,
    opinion_structure: /point|reason|example|conclusion|30[- ]second/i,
    tradeoff_practice: /trade[- ]?off|upside|downside|gain|give up|cost|benefit/i,
    expression_reuse: /use|include|phrase|expression/i
  };
  return movePatterns[expectedMove].test(nextPrompt);
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function nowIso(now: number): string {
  return new Date(now).toISOString();
}

function defaultPractice(): NextPractice {
  return {
    type: "conversation",
    title: "Natural conversation",
    reason: "先通过真实对话建立你的个人 Speaking Profile。",
    task: "Talk for 10 minutes about something you genuinely care about.",
    durationMinutes: 10,
    structure: ["What happened?", "Why does it matter?", "What do you think?"]
  };
}

function defaultGoal(): EnglishLoopGoal {
  return {
    statement: "在真实工作和会议中更自然地表达复杂观点",
    deadline: "",
    importance: "high"
  };
}

function defaultDecision(): LoopDecision {
  return {
    type: "nothing",
    title: "继续观察",
    reason: "目前证据还不够形成稳定判断。先继续几次真实对话。",
    evidenceCount: 0,
    sessionCount: 0,
    confidence: 0.2
  };
}

export function createInitialSpeakingProfile(): SpeakingProfile {
  return {
    version: 1,
    sessions: 0,
    turns: 0,
    minutes: 0,
    lastSessionAt: "",
    abilities: abilityDefinitions.map((definition, index) => ({
      ...definition,
      signal: [48, 56, 52, 38, 36, 30, 28][index]
    })),
    patterns: {
      vocabularyRepetition: 0,
      sentenceOrganization: 36,
      translationDependence: 0,
      abstractPauses: 0,
      tenseControl: 45,
      articleControl: 0,
      businessExpression: 28
    },
    expressionDebts: [],
    recentTopics: [],
    currentFocus: "conversation",
    nextPractice: defaultPractice(),
    goal: defaultGoal(),
    evidenceEvents: [],
    lastDecision: defaultDecision(),
    interventions: [],
    masteryRecords: []
  };
}

function signal(profile: SpeakingProfile, key: SpeakingAbilityKey): number {
  return profile.abilities.find(item => item.key === key)?.signal || 0;
}

function setSignal(profile: SpeakingProfile, key: SpeakingAbilityKey, value: number): void {
  const item = profile.abilities.find(candidate => candidate.key === key);
  if (item) item.signal = round(clamp(value));
}

function detectSignals(transcript: string): EnglishTurnSignals {
  const text = clean(transcript);
  const words = text.toLowerCase().match(/[a-z]+(?:[-'][a-z]+)?/g) || [];
  const wordCount = words.length;
  const counts = new Map<string, number>();
  words.forEach(word => counts.set(word, (counts.get(word) || 0) + 1));
  const repeatedSimpleWordCount = ["very", "good", "important", "thing", "really", "nice", "big"]
    .reduce((total, word) => total + (counts.get(word) || 0), 0);

  return {
    wordCount,
    hasChinese: /[\u3400-\u9fff]/.test(text),
    mentionsProduct: /\b(product|project|customer|user|market|feature|startup|business|agent|ai)\b/i.test(text),
    describesPast: /\b(yesterday|last week|last month|earlier|previously|was|were|did|worked|went|built|made|learned)\b/i.test(text),
    givesOpinion: /\b(i think|i believe|in my view|personally|my point is|i would say|it seems to me)\b/i.test(text),
    explainsCause: /\b(because|since|therefore|so that|as a result|which means|that's why|due to)\b/i.test(text),
    givesExample: /\b(for example|for instance|such as|one example|take .+ as an example)\b/i.test(text),
    discussesTradeoff: /\b(trade[- ]?off|on the other hand|upside|downside|benefit|cost|whereas|however|at the expense of)\b/i.test(text),
    rebuts: /\b(i disagree|i don't think|i would challenge|that's not necessarily|however|although|but the problem is)\b/i.test(text),
    repeatsSimpleWords: wordCount >= 12 && repeatedSimpleWordCount >= 3 && new Set(words).size / Math.max(1, wordCount) < 0.58,
    expressionCandidates: expressionCandidates.filter(candidate => candidate.triggers.test(text)).map(candidate => candidate.phrase)
  };
}

function detectTopic(transcript: string): string | null {
  const text = transcript.toLowerCase();
  if (/\b(ai|agent|model|prompt|harness|context engineering)\b/.test(text)) return "AI";
  if (/\b(product|customer|user research|feature|roadmap)\b/.test(text)) return "产品";
  if (/\b(business|market|investment|revenue|startup|strategy)\b/.test(text)) return "商业";
  if (/\b(project|team|meeting|deadline|work)\b/.test(text)) return "工作";
  return null;
}

function topicFamily(value: string): string | null {
  const detected = detectTopic(value);
  const normalized = clean(value).toLowerCase();
  if (!normalized) return null;
  // A user-provided topic such as "AI, products, work, or everyday life"
  // is intentionally broad; it must not turn an ordinary topic change into
  // an off-topic failure.
  if (/[，,\/]|\bor\b|或/.test(normalized)) return null;
  if (detected) return detected;
  if (/ai|agent|model|prompt|harness|context/.test(normalized)) return "AI";
  if (/product|customer|user|feature|roadmap/.test(normalized)) return "产品";
  if (/business|market|investment|revenue|startup|strategy/.test(normalized)) return "商业";
  if (/project|team|meeting|deadline|work/.test(normalized)) return "工作";
  return null;
}

function uniqueCriteria(values: EnglishSuccessCriterion[]): EnglishSuccessCriterion[] {
  return [...new Set(values)];
}

const criterionLabels: Record<EnglishSuccessCriterion, string> = {
  relevant_response: "围绕问题作答",
  gives_opinion: "表达明确观点",
  explains_cause: "解释原因",
  gives_example: "给出具体例子",
  discusses_tradeoff: "讨论取舍",
  conclusion: "收束并给出结论",
  target_expression: "独立调用目标表达"
};

const masteryStatusLabels: Record<EnglishMasteryStatus, string> = {
  unknown: "待观察",
  candidate: "候选证据",
  emerging: "正在形成",
  provisional: "暂时可独立",
  stable: "跨情境稳定",
  needs_review: "需要复核"
};

export function englishMasteryStatusLabel(status: EnglishMasteryStatus): string {
  return masteryStatusLabels[status];
}

export function englishCriterionLabel(criterion: EnglishSuccessCriterion): string {
  return criterionLabels[criterion];
}

function masteryRecordFor(
  profile: SpeakingProfile,
  criterion: EnglishSuccessCriterion
): EnglishMasteryRecord | undefined {
  return profile.masteryRecords.find(item => item.criterion === criterion);
}

function masteryDifficulty(status: EnglishMasteryStatus): EnglishSessionDifficulty {
  if (status === "needs_review") return "review";
  if (status === "stable") return "transfer";
  if (status === "provisional") return "slightly_above_current";
  if (status === "emerging") return "current";
  return "calibration";
}

export function refreshEnglishMasteryReviewStates(
  input: SpeakingProfile,
  now = Date.now()
): SpeakingProfile {
  const profile = JSON.parse(JSON.stringify(input)) as SpeakingProfile;
  profile.masteryRecords = (profile.masteryRecords || []).map(record => {
    const reviewAt = Date.parse(record.nextReviewAt);
    if (
      (record.status === "provisional" || record.status === "stable")
      && Number.isFinite(reviewAt)
      && reviewAt <= now
    ) {
      return { ...record, status: "needs_review" as const };
    }
    return record;
  });
  const due = profile.masteryRecords.find(record => record.status === "needs_review");
  if (due) {
    profile.nextPractice = practiceForMasteryTarget(profile, due.criterion, due.status);
    profile.currentFocus = profile.nextPractice.type;
  }
  return profile;
}

export function createEnglishLoopSessionPlan(
  profile: SpeakingProfile,
  topic = "",
  now = Date.now()
): SessionPlan {
  const practice = profile.nextPractice || defaultPractice();
  const targetDebt = practice.type === "expression_reuse"
    ? profile.expressionDebts.find(item => item.status !== "stable")
    : undefined;
  const criteriaByType: Record<NextPractice["type"], EnglishSuccessCriterion[]> = {
    conversation: ["relevant_response", "gives_opinion"],
    opinion_structure: ["gives_opinion", "explains_cause", "gives_example", "conclusion"],
    tradeoff: ["discusses_tradeoff", "conclusion"],
    expression_reuse: ["target_expression", "gives_example"]
  };
  const skillByType: Record<NextPractice["type"], SpeakingAbilityKey | "general"> = {
    conversation: "daily_conversation",
    opinion_structure: "complex_opinion",
    tradeoff: "tradeoff",
    expression_reuse: "general"
  };
  const targetRecord = criteriaByType[practice.type]
    .map(criterion => masteryRecordFor(profile, criterion))
    .filter((record): record is EnglishMasteryRecord => Boolean(record))
    .sort((left, right) => {
      const priority: Record<EnglishMasteryStatus, number> = {
        needs_review: 0,
        candidate: 1,
        emerging: 2,
        provisional: 3,
        unknown: 4,
        stable: 5
      };
      return priority[left.status] - priority[right.status];
    })[0];
  return {
    id: `plan-${Math.max(1, profile.sessions)}-${now}`,
    version: 1,
    topic: clean(topic).slice(0, 120),
    goal: clean(profile.goal.statement || "Speak more clearly in real situations").slice(0, 240),
    taskType: practice.type,
    targetSkill: skillByType[practice.type],
    ...(targetDebt ? { targetExpression: targetDebt.phrase } : {}),
    task: clean(practice.task || practice.title).slice(0, 500),
    successCriteria: criteriaByType[practice.type],
    maxTurns: practice.type === "conversation" ? 8 : 6,
    feedbackPolicy: "minimal",
    difficulty: masteryDifficulty(targetRecord?.status || "unknown"),
    ...(targetRecord ? { reviewCriterion: targetRecord.criterion } : {}),
    createdAt: nowIso(now)
  };
}

function criterionMet(
  criterion: EnglishSuccessCriterion,
  signals: EnglishTurnSignals,
  transcript: string,
  plan: SessionPlan
): boolean {
  switch (criterion) {
    case "relevant_response":
      return signals.wordCount >= 6;
    case "gives_opinion":
      return signals.givesOpinion;
    case "explains_cause":
      return signals.explainsCause;
    case "gives_example":
      return signals.givesExample;
    case "discusses_tradeoff":
      return signals.discussesTradeoff;
    case "conclusion":
      return /\b(so|therefore|overall|in conclusion|my recommendation|i would choose|the next step|we should|i would go with)\b/i.test(transcript);
    case "target_expression":
      return Boolean(plan.targetExpression && transcript.toLowerCase().includes(plan.targetExpression.toLowerCase()));
  }
}

function learnerIsStuck(transcript: string): boolean {
  return /\b(i don't know|i am not sure|i'm not sure|i can't explain|how can i say|what is the word|i forgot|i have no idea)\b/i.test(transcript)
    || /我不知道|不知道怎么说|想不起来|不会表达/.test(transcript);
}

function classifyEnglishLoopState(
  transcript: string,
  plan: SessionPlan,
  signals: EnglishTurnSignals,
  audioConfidence?: number
): EnglishLoopLearnerState {
  if (audioConfidence !== undefined && audioConfidence < 0.55) return "unclear_audio";
  if (learnerIsStuck(transcript)) return "stuck";
  const planTopic = topicFamily(plan.topic);
  const turnTopic = topicFamily(transcript);
  if (plan.taskType !== "conversation" && planTopic && turnTopic && planTopic !== turnTopic) {
    return "off_topic";
  }
  const criteriaMet = plan.successCriteria.filter(criterion => criterionMet(criterion, signals, transcript, plan));
  return criteriaMet.length === plan.successCriteria.length ? "completed" : "in_progress";
}

export function chooseEnglishLoopAction(
  state: EnglishLoopLearnerState,
  plan: SessionPlan,
  criteriaMet: EnglishSuccessCriterion[] = []
): ConversationAction {
  if (state === "unclear_audio") {
    return {
      state,
      action: "clarify",
      reasonEvidence: ["音频置信度不足，不能把当前转写当成可靠语言证据。"],
      nextUserAction: "请再说一遍，用一句话表达刚才的意思。",
      shouldUpdateLongTermProfile: false
    };
  }
  if (state === "stuck") {
    return {
      state,
      action: "minimal_hint",
      reasonEvidence: ["用户明确表示暂时无法完成表达。"],
      nextUserAction: plan.taskType === "opinion_structure"
        ? "先只说你的观点，不需要马上解释全部原因。"
        : "先用最简单的一句话表达核心意思。",
      shouldUpdateLongTermProfile: false
    };
  }
  if (state === "off_topic") {
    return {
      state,
      action: "clarify",
      reasonEvidence: ["回答出现了与当前练习主题不同的主题信号。"],
      nextUserAction: `把刚才的内容和“${plan.topic || "当前话题"}”连接起来。`,
      shouldUpdateLongTermProfile: false
    };
  }
  if (state === "completed") {
    return {
      state,
      action: "post_turn_feedback",
      reasonEvidence: [`本轮完成了 ${criteriaMet.length}/${plan.successCriteria.length} 个目标。`],
      nextUserAction: "继续自然交流，下一轮尝试把这个能力迁移到新的例子。",
      shouldUpdateLongTermProfile: true
    };
  }
  return {
    state,
    action: "continue",
    reasonEvidence: ["用户仍在完成当前任务，暂时不抢答或展开长反馈。"],
    nextUserAction: plan.taskType === "opinion_structure"
      ? "继续完成观点、原因、例子或结论中的下一部分。"
      : "继续表达，不需要一次说得完美。",
    shouldUpdateLongTermProfile: criteriaMet.length > 0
  };
}

export function extractEnglishTurnEvidence(input: {
  profile: SpeakingProfile;
  plan: SessionPlan;
  transcript: string;
  sessionId?: string;
  now?: number;
  audioConfidence?: number;
  signals?: EnglishTurnSignals;
}): TurnEvidence {
  const transcript = clean(input.transcript);
  const signals = input.signals || detectSignals(transcript);
  const criteriaMet = uniqueCriteria(input.plan.successCriteria.filter(criterion =>
    criterionMet(criterion, signals, transcript, input.plan)
  ));
  const missingCriteria = input.plan.successCriteria.filter(criterion => !criteriaMet.includes(criterion));
  const state = classifyEnglishLoopState(transcript, input.plan, signals, input.audioConfidence);
  const action = chooseEnglishLoopAction(state, input.plan, criteriaMet);
  const observations: string[] = [];
  if (signals.givesOpinion) observations.push("用户表达了明确观点");
  if (signals.explainsCause) observations.push("用户提供了因果解释");
  if (signals.givesExample) observations.push("用户提供了具体例子");
  if (signals.discussesTradeoff) observations.push("用户提到了收益和代价之间的取舍");
  if (signals.hasChinese) observations.push("本轮出现中英文混用");
  if (state === "stuck") observations.push("用户明确表示暂时卡住");
  if (state === "unclear_audio") observations.push("音频证据不足，暂不更新长期状态");
  const confidence = input.audioConfidence === undefined
    ? Math.min(0.9, 0.55 + Math.min(0.3, signals.wordCount / 100))
    : Math.min(0.9, Math.max(0.1, input.audioConfidence));
  return {
    id: `turn-evidence-${input.now || Date.now()}-${Math.max(1, input.profile.turns + 1)}`,
    sessionId: input.sessionId || `session-${Math.max(1, input.profile.sessions)}`,
    observedAt: nowIso(input.now || Date.now()),
    wordCount: signals.wordCount,
    signals,
    state,
    action: action.action,
    criteriaMet,
    missingCriteria,
    observations,
    evidenceType: state === "completed"
      ? "independent_success"
      : state === "stuck"
        ? "stuck"
        : state === "unclear_audio"
          ? "unclear_audio"
          : state === "in_progress" && signals.wordCount >= 6
            ? "partial"
            : "not_observed",
    confidence,
    ...(input.audioConfidence === undefined ? {} : { audioConfidence: input.audioConfidence }),
    topicKey: detectTopic(transcript) || topicFamily(input.plan.topic) || "general"
  };
}

export function attachEnglishTurnEvidence(
  input: SpeakingProfile,
  evidence: TurnEvidence
): SpeakingProfile {
  const profile = JSON.parse(JSON.stringify(input)) as SpeakingProfile;
  profile.lastTurnEvidence = evidence;
  const latest = profile.evidenceEvents[0];
  if (latest && latest.sessionId === evidence.sessionId && latest.at === evidence.observedAt) {
    latest.learnerState = evidence.state;
    latest.action = evidence.action;
    latest.criteriaMet = evidence.criteriaMet;
    latest.missingCriteria = evidence.missingCriteria;
    latest.evidenceType = evidence.evidenceType;
  }
  return profile;
}

export function reflectEnglishLoopSession(
  profile: SpeakingProfile,
  plan: SessionPlan,
  evidence: TurnEvidence[],
  now = Date.now()
): SessionReflection {
  const currentEvidence = evidence.slice(-100);
  const criteriaCompleted = uniqueCriteria(currentEvidence.flatMap(item => item.criteriaMet));
  const missingCounts = new Map<EnglishSuccessCriterion, number>();
  currentEvidence.forEach(item => item.missingCriteria.forEach(criterion => {
    missingCounts.set(criterion, (missingCounts.get(criterion) || 0) + 1);
  }));
  const recurringGaps = [...missingCounts.entries()]
    .filter(([, count]) => count >= Math.max(2, Math.ceil(currentEvidence.length / 3)))
    .sort((left, right) => right[1] - left[1])
    .map(([criterion]) => criterion);
  const wins = criteriaCompleted.map(criterion => `已出现证据：${criterion}`);
  const candidateGaps = recurringGaps.map(criterion => `下一轮继续验证：${criterion}`);
  const nextExperiment = recurringGaps[0]
    ? `下一次围绕 ${recurringGaps[0]} 设计一次短任务，不增加新的训练目标。`
    : plan.taskType === "conversation"
      ? "下一次换一个真实话题，验证本轮表达能力能否迁移。"
      : `下一次重复“${plan.task}”，但更换一个具体例子。`;
  return {
    sessionId: currentEvidence[0]?.sessionId || plan.id,
    completed: currentEvidence.some(item => item.state === "completed"),
    turnCount: currentEvidence.length,
    evidenceCount: currentEvidence.filter(item => item.evidenceType !== "unclear_audio").length,
    criteriaCompleted,
    recurringGaps,
    wins,
    candidateGaps,
    nextExperiment,
    profileUpdateAllowed: currentEvidence.some(item =>
      item.evidenceType === "independent_success" || item.evidenceType === "partial"
    ),
    confidence: Math.min(0.9, 0.25 + currentEvidence.length * 0.08 + (criteriaCompleted.length ? 0.12 : 0)),
    completedAt: nowIso(now)
  };
}

function boundedUnique(values: string[], limit = 12): string[] {
  return [...new Set(values.filter(Boolean))].slice(-limit);
}

function addDaysIso(now: number, days: number): string {
  return nowIso(now + days * 24 * 60 * 60 * 1000);
}

function deriveEnglishMasteryStatus(
  record: EnglishMasteryRecord,
  conflict: boolean,
  independentSuccess: boolean
): EnglishMasteryStatus {
  if (conflict && (record.status === "provisional" || record.status === "stable" || record.status === "needs_review")) {
    return "needs_review";
  }
  if (record.status === "needs_review" && !independentSuccess) return "needs_review";
  if (
    record.independentSessionIds.length >= 3
    && record.dateKeys.length >= 2
    && record.topicKeys.length >= 2
  ) return "stable";
  // Cold start stays conservative: one successful conversation is never
  // enough to claim independent ability, even when it looked fluent.
  if (record.independentSessionIds.length >= 1 && record.successfulSessionIds.length >= 2) {
    return "provisional";
  }
  if (
    record.successfulSessionIds.length >= 2
    && (record.topicKeys.length >= 2 || record.dateKeys.length >= 2)
  ) return "emerging";
  return record.evidenceCount > 0 ? "candidate" : "unknown";
}

function nextReviewForStatus(status: EnglishMasteryStatus, now: number): string {
  if (status === "needs_review") return addDaysIso(now, 1);
  if (status === "candidate") return addDaysIso(now, 2);
  if (status === "emerging") return addDaysIso(now, 3);
  if (status === "provisional") return addDaysIso(now, 7);
  if (status === "stable") return addDaysIso(now, 14);
  return addDaysIso(now, 1);
}

function practiceForMasteryTarget(
  profile: SpeakingProfile,
  criterion: EnglishSuccessCriterion,
  status: EnglishMasteryStatus
): NextPractice {
  const label = englishCriterionLabel(criterion);
  const state = englishMasteryStatusLabel(status);
  if (criterion === "target_expression") {
    const debt = profile.expressionDebts.find(item => item.status !== "stable");
    if (debt) {
      return {
        type: "expression_reuse",
        title: "换一个语境主动调用",
        reason: `“${debt.meaning}”目前是${state}，下一轮先回忆，不提前展示答案。`,
        task: `Use “${debt.phrase}” naturally in a new 30-second answer.`,
        durationMinutes: 5,
        structure: ["Recall without seeing the answer", `Use ${debt.phrase}`, "Give a different example"]
      };
    }
  }
  if (criterion === "discusses_tradeoff") {
    return {
      type: "tradeoff",
      title: "换场景验证取舍表达",
      reason: `${label}目前是${state}，需要在不同话题中再次独立出现。`,
      task: "Compare two options in a new situation and explain the upside, downside, and your choice.",
      durationMinutes: 8,
      structure: ["Option A", "Option B", "Trade-off", "Your choice"]
    };
  }
  if (criterion === "relevant_response") {
    return {
      type: "conversation",
      title: "真实话题短对话",
      reason: `${label}目前是${state}，下一轮用新的真实话题继续观察。`,
      task: "Talk about a different real situation and answer one follow-up question directly.",
      durationMinutes: 8,
      structure: ["Situation", "Direct answer", "One reason"]
    };
  }
  return {
    type: "opinion_structure",
    title: `继续验证：${label}`,
    reason: `${label}目前是${state}，下一轮只验证这一项，不增加新的训练目标。`,
    task: criterion === "gives_example"
      ? "Give a clear opinion and support it with one new concrete example."
      : criterion === "explains_cause"
        ? "State your opinion and explain one cause in a new situation."
        : criterion === "conclusion"
          ? "Explain your view briefly and finish with one clear conclusion."
          : "Give a 30-second answer: point, reason, example, conclusion.",
    durationMinutes: 5,
    structure: ["Point", "Reason", "Example", "Conclusion"]
  };
}

export function updateEnglishMasteryFromSession(
  input: SpeakingProfile,
  plan: SessionPlan,
  evidence: TurnEvidence[],
  reflection: SessionReflection,
  now = Date.now()
): SpeakingProfile {
  const profile = JSON.parse(JSON.stringify(input)) as SpeakingProfile;
  profile.masteryRecords = Array.isArray(profile.masteryRecords) ? profile.masteryRecords : [];
  if (!reflection.profileUpdateAllowed) return profile;

  const usableEvidence = evidence.filter(item =>
    item.state !== "unclear_audio"
    && item.state !== "off_topic"
    && item.evidenceType !== "not_observed"
  );
  if (!usableEvidence.length) return profile;

  plan.successCriteria.forEach(criterion => {
    const successfulIndexes = usableEvidence
      .map((item, index) => item.criteriaMet.includes(criterion) ? index : -1)
      .filter(index => index >= 0);
    const successful = successfulIndexes.length > 0;
    const independentSuccess = successfulIndexes.some(index => {
      const item = usableEvidence[index];
      const priorSupport = usableEvidence.slice(0, index).some(previous =>
        previous.action === "minimal_hint" || previous.action === "recast"
      );
      return item.evidenceType === "independent_success" && !priorSupport;
    });
    const attempted = usableEvidence.filter(item => item.wordCount >= 6 || item.state === "stuck");
    const previous = masteryRecordFor(profile, criterion);
    const conflict = Boolean(previous && !successful && attempted.length >= 2);
    if (!successful && !conflict) return;

    const observedAt = usableEvidence.at(-1)?.observedAt || nowIso(now);
    const sessionId = usableEvidence[0]?.sessionId || reflection.sessionId;
    const topicKey = usableEvidence.find(item => item.criteriaMet.includes(criterion))?.topicKey
      || topicFamily(plan.topic)
      || "general";
    const dateKey = observedAt.slice(0, 10);
    const record: EnglishMasteryRecord = previous
      ? JSON.parse(JSON.stringify(previous)) as EnglishMasteryRecord
      : {
          criterion,
          status: "unknown",
          evidenceCount: 0,
          successfulSessionIds: [],
          independentSessionIds: [],
          promptedSuccesses: 0,
          contradictionCount: 0,
          topicKeys: [],
          dateKeys: [],
          firstObservedAt: observedAt,
          lastObservedAt: observedAt,
          lastIndependentAt: "",
          nextReviewAt: "",
          confidence: 0
        };

    record.evidenceCount += 1;
    record.lastObservedAt = observedAt;
    if (successful) {
      record.successfulSessionIds = boundedUnique([...record.successfulSessionIds, sessionId]);
      record.topicKeys = boundedUnique([...record.topicKeys, topicKey]);
      record.dateKeys = boundedUnique([...record.dateKeys, dateKey]);
      if (independentSuccess) {
        record.independentSessionIds = boundedUnique([...record.independentSessionIds, sessionId]);
        record.lastIndependentAt = observedAt;
      } else {
        record.promptedSuccesses += 1;
      }
    }
    if (conflict) record.contradictionCount += 1;
    record.status = deriveEnglishMasteryStatus(record, conflict, independentSuccess);
    record.nextReviewAt = nextReviewForStatus(record.status, now);
    record.confidence = round(Math.min(0.95,
      0.18
      + record.successfulSessionIds.length * 0.12
      + record.independentSessionIds.length * 0.12
      + Math.min(2, record.topicKeys.length) * 0.06
      + Math.min(2, record.dateKeys.length) * 0.06
      - record.contradictionCount * 0.08
    ), 2);

    const index = profile.masteryRecords.findIndex(item => item.criterion === criterion);
    if (index >= 0) profile.masteryRecords[index] = record;
    else profile.masteryRecords.push(record);
  });

  profile.masteryRecords = profile.masteryRecords.slice(0, successCriteria.length);
  const expressionMastery = masteryRecordFor(profile, "target_expression");
  if (plan.targetExpression && expressionMastery) {
    const debt = profile.expressionDebts.find(item => item.phrase === plan.targetExpression);
    if (debt) {
      debt.status = expressionMastery.status === "stable"
        ? "stable"
        : expressionMastery.status === "provisional" || expressionMastery.status === "emerging"
          ? "practicing"
          : expressionMastery.status === "needs_review"
            ? "practicing"
            : "active";
    }
  }
  const targetCriterion = reflection.recurringGaps[0]
    || profile.masteryRecords
      .filter(item => item.status !== "stable")
      .sort((left, right) => {
        const priority: Record<EnglishMasteryStatus, number> = {
          needs_review: 0,
          candidate: 1,
          emerging: 2,
          provisional: 3,
          unknown: 4,
          stable: 5
        };
        return priority[left.status] - priority[right.status]
          || Date.parse(left.nextReviewAt) - Date.parse(right.nextReviewAt);
      })[0]?.criterion;
  if (targetCriterion) {
    const record = masteryRecordFor(profile, targetCriterion);
    profile.nextPractice = practiceForMasteryTarget(profile, targetCriterion, record?.status || "candidate");
    profile.currentFocus = profile.nextPractice.type;
  }
  return profile;
}

function upsertExpressionDebt(profile: SpeakingProfile, phrase: string, iso: string): void {
  const candidate = expressionCandidates.find(item => item.phrase === phrase);
  if (!candidate) return;
  const existing = profile.expressionDebts.find(item => item.phrase === phrase);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeenAt = iso;
    if (existing.status === "candidate" && existing.occurrences >= 2) existing.status = "active";
    return;
  }
  profile.expressionDebts.unshift({
    id: `expression-${phrase.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "")}`,
    phrase: candidate.phrase,
    meaning: candidate.meaning,
    context: `${candidate.context}。来自真实口语表达中的结构化信号。`,
    occurrences: 1,
    status: "candidate",
    firstSeenAt: iso,
    lastSeenAt: iso
  });
  profile.expressionDebts = profile.expressionDebts.slice(0, 12);
}

function chooseNextPractice(profile: SpeakingProfile): NextPractice {
  const sessionCount = new Set(profile.evidenceEvents.map(event => event.sessionId)).size;
  const evidenceConfidence = decisionConfidence(profile.evidenceEvents.length, sessionCount);
  const activeDebt = profile.evidenceEvents.length >= 5 && sessionCount >= 3 && evidenceConfidence >= 0.75
    ? profile.expressionDebts.find(item => item.occurrences >= 2 && item.status !== "stable")
    : undefined;
  if (activeDebt) {
    return {
      type: "expression_reuse",
      title: "Reuse one useful expression",
      reason: `你最近反复需要表达“${activeDebt.meaning}”，先把它放回真实对话里。`,
      task: `Use “${activeDebt.phrase}” naturally in a 30-second answer.`,
      durationMinutes: 5,
      structure: ["Make your point", `Use ${activeDebt.phrase}`, "Give one concrete example"]
    };
  }

  if (profile.turns >= 3 && signal(profile, "complex_opinion") < 55) {
    return {
      type: "opinion_structure",
      title: "30-second opinion",
      reason: "你已经有足够词汇进行对话，下一步更值得练习的是把复杂观点组织成一段完整表达。",
      task: "Give a 30-second answer: point, reason, example, conclusion.",
      durationMinutes: 5,
      structure: ["Point", "Reason", "Example", "Conclusion"]
    };
  }

  if (profile.turns >= 2 && signal(profile, "tradeoff") < 48) {
    return {
      type: "tradeoff",
      title: "Explain a trade-off",
      reason: "你正在讨论真实工作和产品问题，下一步可以练习同时说清收益、代价和选择条件。",
      task: "Compare two options and explain the upside, downside, and your choice.",
      durationMinutes: 8,
      structure: ["Option A", "Option B", "Trade-off", "Your choice"]
    };
  }

  return defaultPractice();
}

function decisionConfidence(evidenceCount: number, sessionCount: number): number {
  return round(Math.min(0.95, 0.25 + evidenceCount * 0.08 + sessionCount * 0.12), 2);
}

function chooseLoopDecision(profile: SpeakingProfile): LoopDecision {
  const evidenceCount = profile.evidenceEvents.length;
  const sessionCount = new Set(profile.evidenceEvents.map(event => event.sessionId)).size;
  const confidence = decisionConfidence(evidenceCount, sessionCount);
  const activeDebt = profile.expressionDebts.find(item => item.occurrences >= 2 && item.status !== "stable");

  if (activeDebt && evidenceCount >= 5 && sessionCount >= 3 && confidence >= 0.75) {
    return {
      type: "debt",
      id: `debt-${activeDebt.id}`,
      title: "一个表达缺口已经重复出现",
      reason: `“${activeDebt.meaning}”已经在真实对话中出现 ${activeDebt.occurrences} 次。`,
      evidenceCount,
      sessionCount,
      confidence,
      action: `下一次对话主动使用 ${activeDebt.phrase}`,
      hypothesis: `在真实语境中主动使用 ${activeDebt.phrase}，比单独背词更可能让它稳定进入口语。`,
      expectedOutcome: `下次至少自然使用一次 ${activeDebt.phrase}`
    };
  }

  if (evidenceCount >= 5 && sessionCount >= 3 && confidence >= 0.75 && profile.nextPractice.type === "opinion_structure") {
    return {
      type: "experiment",
      id: "experiment-opinion-structure",
      title: "本周做一次 30 秒观点实验",
      reason: "跨多次对话都能表达观点，但完整组织“观点—原因—例子—结论”的证据仍然不足。",
      evidenceCount,
      sessionCount,
      confidence,
      action: "连续 3 次回答使用 Point → Reason → Example → Conclusion",
      hypothesis: "短时结构化观点练习比继续扩充词汇更能改善复杂观点表达。",
      expectedOutcome: "连续三次回答都包含观点、原因、例子和结论"
    };
  }

  if (evidenceCount >= 3 && profile.abilities.find(item => item.key === "complex_opinion")?.signal) {
    return {
      type: "update",
      id: "update-speaking-profile",
      title: "Speaking Profile 已更新",
      reason: "最近的真实表达已经为你的个人模型增加了新的证据。",
      evidenceCount,
      sessionCount,
      confidence
    };
  }

  return {
    type: "nothing",
    id: `observe-${evidenceCount}`,
    title: "暂不打扰",
    reason: `目前只有 ${evidenceCount} 条结构化证据，继续观察，避免过早给你下结论。`,
    evidenceCount,
    sessionCount,
    confidence
  };
}

export type NextSpeakingMove = {
  type: SpeakingMoveType;
  prompt: string;
  reason: string;
};

export function chooseNextSpeakingMove(
  profile: SpeakingProfile,
  signals: EnglishTurnSignals
): NextSpeakingMove {
  const goal = profile.goal.statement || "your current goal";
  if (profile.turns <= 1) {
    return {
      type: "goal_link",
      prompt: `What part of this matters most for your goal: ${goal}?`,
      reason: "先把真实话题和当前目标连接起来。"
    };
  }
  if (signals.givesOpinion && !signals.explainsCause) {
    return {
      type: "cause",
      prompt: "Why do you think that? Give the reason in one clear sentence.",
      reason: "你已经表达了观点，下一步补上可理解的因果。"
    };
  }
  if (signals.explainsCause && !signals.givesExample) {
    return {
      type: "example",
      prompt: "Give one concrete example from your own work.",
      reason: "你已经解释了原因，下一步把抽象观点落到真实情境。"
    };
  }
  if (signals.discussesTradeoff) {
    return {
      type: "tradeoff",
      prompt: "What do you gain, what do you give up, and which option would you choose?",
      reason: "你提到了取舍，下一步练习把收益、代价和选择说完整。"
    };
  }
  if (signals.givesExample || signals.wordCount >= 20) {
    return {
      type: "conclusion",
      prompt: "Finish with your conclusion: what should happen next?",
      reason: "你已经提供了足够上下文，下一步练习收束观点。"
    };
  }
  if (/meeting|q&a|question|会议|问答/i.test(goal)) {
    return {
      type: "q_and_a",
      prompt: "A stakeholder asks: Why does this matter now? Answer in 30 seconds.",
      reason: "当前目标包含真实问答，提前练习一个高概率问题。"
    };
  }
  return {
    type: "free",
    prompt: "What would you do next, and why?",
    reason: "继续围绕真实工作推进，而不是切换到泛化课程。"
  };
}

export function observeEnglishTurn(
  input: SpeakingProfile,
  transcript: string,
  options: {
    durationMs?: number;
    now?: number;
    sessionId?: string;
    topic?: string;
    plan?: SessionPlan;
    audioConfidence?: number;
  } = {}
): { profile: SpeakingProfile; signals: EnglishTurnSignals } {
  const profile: SpeakingProfile = JSON.parse(JSON.stringify(input));
  const text = clean(transcript);
  const now = options.now || Date.now();
  const iso = nowIso(now);
  const signals = detectSignals(text);
  const minutes = Math.max(0.1, (options.durationMs || 6000) / 60000);

  profile.turns += 1;
  profile.minutes = round(profile.minutes + minutes, 1);
  profile.lastSessionAt = iso;
  profile.expressionDebts = profile.expressionDebts.map(debt => ({ ...debt }));

  const state = options.plan
    ? classifyEnglishLoopState(text, options.plan, signals, options.audioConfidence)
    : "in_progress";
  const canUpdateLongTerm = state !== "stuck" && state !== "off_topic" && state !== "unclear_audio";
  if (!canUpdateLongTerm) return { profile, signals };

  const step = (key: SpeakingAbilityKey, amount: number): void => setSignal(profile, key, signal(profile, key) + amount);
  step("daily_conversation", signals.wordCount >= 8 ? 1.4 : 0.4);
  step("facts", signals.describesPast ? 2 : 0.3);
  step("product_intro", signals.mentionsProduct ? 2 : 0);
  step("complex_opinion", signals.givesOpinion && signals.wordCount >= 12 ? 2.4 : 0.2);
  step("causal_explanation", signals.explainsCause ? 2.5 : 0.2);
  step("tradeoff", signals.discussesTradeoff ? 2.8 : 0.15);
  step("improvised_rebuttal", signals.rebuts ? 2.8 : 0.1);

  profile.patterns.vocabularyRepetition = round(clamp(
    profile.patterns.vocabularyRepetition + (signals.repeatsSimpleWords ? 2 : -0.2)
  ));
  profile.patterns.sentenceOrganization = round(clamp(
    profile.patterns.sentenceOrganization + (signals.wordCount >= 20 && (signals.explainsCause || signals.givesExample) ? 2.2 : 0.2)
  ));
  profile.patterns.translationDependence = round(clamp(
    profile.patterns.translationDependence + (signals.hasChinese ? 2 : -0.1)
  ));
  profile.patterns.businessExpression = round(clamp(
    profile.patterns.businessExpression + (signals.mentionsProduct && signals.wordCount >= 12 ? 1.8 : 0.1)
  ));

  signals.expressionCandidates.forEach(phrase => upsertExpressionDebt(profile, phrase, iso));
  profile.evidenceEvents.unshift({
    id: `speaking-${now}-${profile.turns}`,
    sessionId: options.sessionId || `session-${profile.sessions || 1}`,
    at: iso,
    wordCount: signals.wordCount,
    signals: {
      hasChinese: signals.hasChinese,
      givesOpinion: signals.givesOpinion,
      explainsCause: signals.explainsCause,
      givesExample: signals.givesExample,
      discussesTradeoff: signals.discussesTradeoff,
      rebuts: signals.rebuts
    },
    confidence: signals.wordCount >= 8 ? 0.82 : 0.62
  });
  profile.evidenceEvents = profile.evidenceEvents.slice(0, 100);
  const topic = detectTopic(text) || clean(options.topic || "").slice(0, 48) || null;
  if (topic) profile.recentTopics = [topic, ...profile.recentTopics.filter(item => item !== topic)].slice(0, 6);
  profile.currentFocus = chooseNextPractice(profile).type;
  profile.nextPractice = chooseNextPractice(profile);
  profile.lastDecision = chooseLoopDecision(profile);
  const decision = profile.lastDecision;
  if (decision.type !== "nothing" && decision.id && !profile.interventions.some(item => item.id === decision.id)) {
    profile.interventions.unshift({
      id: decision.id,
      type: decision.type,
      title: decision.title,
      hypothesis: decision.hypothesis || decision.reason,
      expectedOutcome: decision.expectedOutcome || decision.action || "继续观察下一次真实对话是否发生变化",
      createdAt: iso,
      status: "open",
      userNote: ""
    });
    profile.interventions = profile.interventions.slice(0, 20);
  }
  return { profile, signals };
}

export function recordInterventionFeedback(
  input: SpeakingProfile,
  id: string,
  status: Exclude<InterventionRecord["status"], "open">,
  userNote = ""
): SpeakingProfile {
  const profile: SpeakingProfile = JSON.parse(JSON.stringify(input));
  const item = profile.interventions.find(candidate => candidate.id === id);
  if (item) {
    item.status = status;
    item.userNote = clean(userNote).slice(0, 240);
  }
  return profile;
}

export function markEnglishLoopSessionStarted(input: SpeakingProfile, now = Date.now()): SpeakingProfile {
  const profile: SpeakingProfile = JSON.parse(JSON.stringify(input));
  profile.sessions += 1;
  profile.lastSessionAt = nowIso(now);
  return profile;
}

export function localEnglishLoopReply(
  profile: SpeakingProfile,
  transcript: string,
  control?: ConversationAction
): {
  reply: string;
  feedback: string;
  nextPrompt: string;
  g2Text: string;
  outputType: LoopDecisionType;
  decision: LoopDecision;
  moveType: SpeakingMoveType;
  state: EnglishLoopLearnerState;
  action: EnglishLoopActionType;
} {
  const text = clean(transcript);
  const practice = profile.nextPractice;
  const lastEvidence = profile.evidenceEvents[0];
  const fallbackSignals: EnglishTurnSignals = {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    hasChinese: /[\u3400-\u9fff]/.test(text),
    mentionsProduct: false,
    describesPast: false,
    givesOpinion: /\b(i think|i believe|in my view)\b/i.test(text),
    explainsCause: /\b(because|therefore|as a result|which means)\b/i.test(text),
    givesExample: /\b(for example|for instance)\b/i.test(text),
    discussesTradeoff: /\b(trade[- ]?off|upside|downside|however)\b/i.test(text),
    rebuts: /\b(i disagree|however|although)\b/i.test(text),
    repeatsSimpleWords: false,
    expressionCandidates: []
  };
  const move = chooseNextSpeakingMove(profile, lastEvidence ? {
    ...fallbackSignals,
    ...lastEvidence.signals
  } : fallbackSignals);
  const state = control?.state || profile.lastTurnEvidence?.state || "in_progress";
  const action = control?.action || profile.lastTurnEvidence?.action || "continue";
  const feedback = state === "unclear_audio"
    ? "I could not confirm the audio clearly, so I am not treating this as a language mistake."
    : state === "stuck"
      ? "Start with the simplest version of your idea. We can make it more natural after that."
      : profile.lastDecision.type === "nothing"
    ? "No stable conclusion yet. I am keeping this as evidence, not a diagnosis."
    : profile.lastDecision.reason;
  const nextPrompt = state === "unclear_audio"
    ? "Please say that again in one clear sentence."
    : action === "minimal_hint"
      ? control?.nextUserAction || "Start with one simple sentence. What is your main point?"
      : action === "clarify"
        ? control?.nextUserAction || "Connect that back to the current topic in one sentence."
        : practice.type === "opinion_structure"
    ? practice.task
    : practice.type === "tradeoff"
      ? practice.task
      : practice.type === "expression_reuse"
        ? practice.task
        : move.prompt || practice.task;
  const moveType: SpeakingMoveType = practice.type === "opinion_structure"
    ? "opinion_structure"
    : practice.type === "tradeoff"
      ? "tradeoff_practice"
      : practice.type === "expression_reuse"
        ? "expression_reuse"
        : move.type;
  const anchor = text.length > 96 ? `${text.slice(0, 95)}…` : text;
  return {
    reply: state === "unclear_audio"
      ? "I want to make sure I heard your idea correctly."
      : `You mentioned “${anchor}”. ${move.reason} Let's make that concrete for ${profile.goal.statement || "your current goal"}.`,
    feedback,
    nextPrompt,
    g2Text: practice.title,
    outputType: profile.lastDecision.type,
    decision: profile.lastDecision,
    moveType,
    state,
    action
  };
}

const successCriteria: EnglishSuccessCriterion[] = [
  "relevant_response",
  "gives_opinion",
  "explains_cause",
  "gives_example",
  "discusses_tradeoff",
  "conclusion",
  "target_expression"
];

const learnerStates: EnglishLoopLearnerState[] = [
  "in_progress",
  "completed",
  "stuck",
  "off_topic",
  "unclear_audio"
];

const actionTypes: EnglishLoopActionType[] = [
  "continue",
  "clarify",
  "minimal_hint",
  "recast",
  "post_turn_feedback",
  "end_task"
];

const masteryStatuses: EnglishMasteryStatus[] = [
  "unknown",
  "candidate",
  "emerging",
  "provisional",
  "stable",
  "needs_review"
];

const sessionDifficulties: EnglishSessionDifficulty[] = [
  "calibration",
  "current",
  "slightly_above_current",
  "transfer",
  "review"
];

function normalizeSessionPlan(input: unknown): SessionPlan | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<SessionPlan>;
  const taskTypes: NextPractice["type"][] = ["conversation", "opinion_structure", "tradeoff", "expression_reuse"];
  const taskType = taskTypes.includes(value.taskType as NextPractice["type"])
    ? value.taskType as NextPractice["type"]
    : "conversation";
  const criteria = Array.isArray(value.successCriteria)
    ? value.successCriteria.filter(item => successCriteria.includes(item as EnglishSuccessCriterion)) as EnglishSuccessCriterion[]
    : [];
  return {
    id: clean(value.id) || `plan-${Date.now()}`,
    version: 1,
    topic: clean(value.topic),
    goal: clean(value.goal),
    taskType,
    targetSkill: value.targetSkill || "general",
    ...(value.targetExpression ? { targetExpression: clean(value.targetExpression) } : {}),
    task: clean(value.task),
    successCriteria: criteria.length ? uniqueCriteria(criteria) : ["relevant_response"],
    maxTurns: Math.max(1, Math.min(20, Math.round(Number(value.maxTurns) || 6))),
    feedbackPolicy: value.feedbackPolicy === "after_turn" || value.feedbackPolicy === "on_request"
      ? value.feedbackPolicy
      : "minimal",
    difficulty: sessionDifficulties.includes(value.difficulty as EnglishSessionDifficulty)
      ? value.difficulty as EnglishSessionDifficulty
      : "calibration",
    ...(successCriteria.includes(value.reviewCriterion as EnglishSuccessCriterion)
      ? { reviewCriterion: value.reviewCriterion as EnglishSuccessCriterion }
      : {}),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(Date.now())
  };
}

function normalizeTurnEvidence(input: unknown): TurnEvidence | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<TurnEvidence>;
  const state = learnerStates.includes(value.state as EnglishLoopLearnerState)
    ? value.state as EnglishLoopLearnerState
    : "in_progress";
  const action = actionTypes.includes(value.action as EnglishLoopActionType)
    ? value.action as EnglishLoopActionType
    : "continue";
  const normalizedSignals = value.signals && typeof value.signals === "object"
    ? value.signals as EnglishTurnSignals
    : detectSignals("");
  return {
    id: clean(value.id) || `turn-evidence-${Date.now()}`,
    sessionId: clean(value.sessionId),
    observedAt: typeof value.observedAt === "string" ? value.observedAt : nowIso(Date.now()),
    wordCount: Math.max(0, Math.min(2000, Math.round(Number(value.wordCount) || 0))),
    signals: normalizedSignals,
    state,
    action,
    criteriaMet: Array.isArray(value.criteriaMet)
      ? value.criteriaMet.filter(item => successCriteria.includes(item as EnglishSuccessCriterion)) as EnglishSuccessCriterion[]
      : [],
    missingCriteria: Array.isArray(value.missingCriteria)
      ? value.missingCriteria.filter(item => successCriteria.includes(item as EnglishSuccessCriterion)) as EnglishSuccessCriterion[]
      : [],
    observations: Array.isArray(value.observations) ? value.observations.map(String).slice(0, 8) : [],
    evidenceType: value.evidenceType === "independent_success"
      || value.evidenceType === "partial"
      || value.evidenceType === "stuck"
      || value.evidenceType === "unclear_audio"
      ? value.evidenceType
      : "not_observed",
    confidence: clamp(Number(value.confidence) || 0),
    ...(value.audioConfidence == null ? {} : { audioConfidence: clamp(Number(value.audioConfidence) || 0) }),
    ...(value.topicKey ? { topicKey: clean(value.topicKey).slice(0, 80) } : {})
  };
}

function normalizeMasteryRecord(input: unknown): EnglishMasteryRecord | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<EnglishMasteryRecord>;
  if (!successCriteria.includes(value.criterion as EnglishSuccessCriterion)) return undefined;
  const status = masteryStatuses.includes(value.status as EnglishMasteryStatus)
    ? value.status as EnglishMasteryStatus
    : "unknown";
  const safeStrings = (items: unknown, limit = 12): string[] => Array.isArray(items)
    ? boundedUnique(items.map(String).map(clean), limit)
    : [];
  return {
    criterion: value.criterion as EnglishSuccessCriterion,
    status,
    evidenceCount: Math.max(0, Math.min(10000, Math.round(Number(value.evidenceCount) || 0))),
    successfulSessionIds: safeStrings(value.successfulSessionIds),
    independentSessionIds: safeStrings(value.independentSessionIds),
    promptedSuccesses: Math.max(0, Math.min(10000, Math.round(Number(value.promptedSuccesses) || 0))),
    contradictionCount: Math.max(0, Math.min(10000, Math.round(Number(value.contradictionCount) || 0))),
    topicKeys: safeStrings(value.topicKeys),
    dateKeys: safeStrings(value.dateKeys),
    firstObservedAt: typeof value.firstObservedAt === "string" ? value.firstObservedAt : "",
    lastObservedAt: typeof value.lastObservedAt === "string" ? value.lastObservedAt : "",
    lastIndependentAt: typeof value.lastIndependentAt === "string" ? value.lastIndependentAt : "",
    nextReviewAt: typeof value.nextReviewAt === "string" ? value.nextReviewAt : "",
    confidence: clamp(Number(value.confidence) || 0, 0, 1)
  };
}

function normalizeSessionReflection(input: unknown): SessionReflection | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<SessionReflection>;
  return {
    sessionId: clean(value.sessionId),
    completed: Boolean(value.completed),
    turnCount: Math.max(0, Math.min(1000, Math.round(Number(value.turnCount) || 0))),
    evidenceCount: Math.max(0, Math.min(1000, Math.round(Number(value.evidenceCount) || 0))),
    criteriaCompleted: Array.isArray(value.criteriaCompleted)
      ? value.criteriaCompleted.filter(item => successCriteria.includes(item as EnglishSuccessCriterion)) as EnglishSuccessCriterion[]
      : [],
    recurringGaps: Array.isArray(value.recurringGaps)
      ? value.recurringGaps.filter(item => successCriteria.includes(item as EnglishSuccessCriterion)) as EnglishSuccessCriterion[]
      : [],
    wins: Array.isArray(value.wins) ? value.wins.map(String).slice(0, 8) : [],
    candidateGaps: Array.isArray(value.candidateGaps) ? value.candidateGaps.map(String).slice(0, 8) : [],
    nextExperiment: clean(value.nextExperiment),
    profileUpdateAllowed: Boolean(value.profileUpdateAllowed),
    confidence: clamp(Number(value.confidence) || 0),
    completedAt: typeof value.completedAt === "string" ? value.completedAt : nowIso(Date.now())
  };
}

export function normalizeSpeakingProfile(input: unknown): SpeakingProfile {
  const fallback = createInitialSpeakingProfile();
  if (!input || typeof input !== "object") return fallback;
  const value = input as Partial<SpeakingProfile>;
  const abilities = Array.isArray(value.abilities)
    ? abilityDefinitions.map((definition, index) => {
      const existing = value.abilities?.find(item => item?.key === definition.key);
      return {
        ...definition,
        signal: clamp(Number(existing?.signal ?? fallback.abilities[index].signal))
      };
    })
    : fallback.abilities;
  const sessionPlan = normalizeSessionPlan(value.sessionPlan);
  const lastTurnEvidence = normalizeTurnEvidence(value.lastTurnEvidence);
  const lastSessionReflection = normalizeSessionReflection(value.lastSessionReflection);
  const masteryRecords = Array.isArray(value.masteryRecords)
    ? value.masteryRecords.map(normalizeMasteryRecord).filter((item): item is EnglishMasteryRecord => Boolean(item))
    : [];
  return {
    ...fallback,
    sessions: Math.max(0, Number(value.sessions) || 0),
    turns: Math.max(0, Number(value.turns) || 0),
    minutes: Math.max(0, round(Number(value.minutes) || 0, 1)),
    lastSessionAt: typeof value.lastSessionAt === "string" ? value.lastSessionAt : "",
    abilities,
    patterns: {
      ...fallback.patterns,
      ...(value.patterns || {})
    },
    expressionDebts: Array.isArray(value.expressionDebts) ? value.expressionDebts.slice(0, 12) as ExpressionDebt[] : [],
    recentTopics: Array.isArray(value.recentTopics) ? value.recentTopics.map(String).slice(0, 6) : [],
    currentFocus: value.currentFocus || fallback.currentFocus,
    nextPractice: value.nextPractice || fallback.nextPractice,
    goal: {
      ...fallback.goal,
      ...(value.goal || {})
    },
    evidenceEvents: Array.isArray(value.evidenceEvents) ? value.evidenceEvents.slice(0, 100) as EvidenceEvent[] : [],
    lastDecision: value.lastDecision || fallback.lastDecision,
    interventions: Array.isArray(value.interventions) ? value.interventions.slice(0, 20) as InterventionRecord[] : [],
    masteryRecords,
    ...(sessionPlan ? { sessionPlan } : {}),
    ...(lastTurnEvidence ? { lastTurnEvidence } : {}),
    ...(lastSessionReflection ? { lastSessionReflection } : {})
  };
}
