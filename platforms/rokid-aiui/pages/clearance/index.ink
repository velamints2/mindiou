<script def>
{
  "navigationBarTitleText": "MindIOU"
}
</script>

<script setup>
import {
  endClearance,
  fetchClearanceEntry,
  getRuntimeConfig,
  loadClearanceSession,
  saveClearanceSession,
  startClearance,
  submitClearanceAnswer
} from "../../utils/api.js";
import {
  conciseAnswerText,
  clearanceStatusLabel,
  conciseClearanceText,
  conciseQuestion,
  conciseRuntimeError,
  hardwareControlFromKey,
  transcriptFromSpeechEvent
} from "../../utils/learning.js";

export default {
  data: {
    loading: true,
    ready: false,
    state: "读取认知欠条",
    target: "准备清偿",
    question: "正在寻找最近一次 AI 实践留下的理解缺口。",
    questionClass: "question",
    sourceText: "",
    sourceHint: "回答前不显示答案",
    progressText: "— / —",
    resultText: "",
    resultClass: "feedback-text",
    canEnd: false,
    ended: false,
    phase: "question",
    pendingQuestion: "",
    working: false,
    listening: false,
    selectedAction: 0,
    actionPrimary: "解释",
    actionSecondary: "重试",
    actionTertiary: "结束"
  },

  async onLoad(query = {}) {
    this.config = getRuntimeConfig(query);
    await this.begin();
  },

  onKeyDown(event = {}) {
    const key = String(event.code || event.key || event.detail?.code || event.detail?.key || "");
    const control = hardwareControlFromKey(key);
    if (control && control !== "exit" && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (control === "up") {
      this.moveSelection(-1);
      return;
    }
    if (control === "down") {
      this.moveSelection(1);
      return;
    }
    if (control === "confirm") {
      this.activateSelectedAction();
      return;
    }
    if (control === "exit") {
      this.exitView();
    }
  },

  moveSelection(delta) {
    const labels = this.actionLabels();
    const selectedAction = (this.data.selectedAction + delta + labels.length) % labels.length;
    this.setData({ selectedAction });
  },

  activateSelectedAction() {
    if (this.data.selectedAction === 0) {
      this.handlePrimary();
      return;
    }
    if (this.data.selectedAction === 1) {
      void this.retry();
      return;
    }
    this.handleTertiary();
  },

  actionLabels() {
    if (this.data.phase === "feedback" && !this.data.ended) return ["继续", "重试", "结束"];
    return this.data.ended ? ["回顾", "重学", "下一张"] : ["解释", "重试", "结束"];
  },

  handlePrimary() {
    if (this.data.ended) {
      this.showResultSummary();
      return;
    }
    if (this.data.phase === "feedback") {
      this.showFollowupQuestion();
      return;
    }
    this.startListening();
  },

  handleTertiary() {
    if (this.data.ended) void this.nextCard();
    else void this.finish();
  },

  async onVoiceWakeup() {
    if (this.data.ended) this.showResultSummary();
    else if (this.data.phase === "feedback") this.showFollowupQuestion();
    else this.startListening();
  },

  startListening() {
    if (this.data.working || this.data.listening) return;
    const Recognition = globalThis.SpeechRecognition;
    if (typeof Recognition !== "function") {
      this.setData({
        state: "语音不可用",
        resultText: "当前宿主没有开放语音识别。",
        resultClass: "feedback-text feedback-warning"
      });
      return;
    }

    this.stopRecognition();
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      this.setData({
        listening: true,
        state: "正在聆听",
        resultText: "请用自己的话解释当前问题。",
        resultClass: "feedback-text"
      });
    };
    recognition.onresult = event => {
      const transcript = transcriptFromSpeechEvent(event);
      if (!transcript) {
        console.warn("MindIOU ASR result had no readable transcript");
        return;
      }
      if (this.processingAnswer) return;
      console.log(`MindIOU received final ASR transcript (${transcript.length} chars)`);
      this.processingAnswer = true;
      this.stopRecognition(false);
      void this.submitSpokenAnswer(transcript);
    };
    recognition.onerror = event => {
      this.recognition = null;
      this.setData({
        listening: false,
        state: "没有听清",
        resultText: conciseQuestion(event?.message || "请点击解释后再说一次。", 32),
        resultClass: "feedback-text feedback-warning"
      });
    };
    recognition.onend = () => {
      this.recognition = null;
      if (!this.processingAnswer && this.data.listening) {
        this.setData({ listening: false, state: "请直接口述回答" });
      }
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      this.recognition = null;
      this.setData({
        listening: false,
        state: "语音启动失败",
        resultText: conciseRuntimeError(error),
        resultClass: "feedback-text feedback-warning"
      });
    }
  },

  stopRecognition(abort = true) {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    try {
      if (abort && typeof recognition.abort === "function") recognition.abort();
      else if (typeof recognition.stop === "function") recognition.stop();
    } catch {}
  },

  async submitSpokenAnswer(transcript) {
    const session = this.currentSession || this.sessionFromStorage();
    if (!session?.id) {
      this.processingAnswer = false;
      this.setData({
        listening: false,
        state: "会话已失效",
        resultText: "请重试当前卡片。",
        resultClass: "feedback-text feedback-warning"
      });
      return;
    }
    this.setData({
      listening: false,
      working: true,
      state: "AI 正在分析",
      resultText: `已收到：${conciseQuestion(transcript, 24)}`,
      resultClass: "feedback-text"
    });
    try {
      console.log(`MindIOU submitting answer for session ${session.id}`);
      const payload = await submitClearanceAnswer(this.config, session.id, transcript);
      this.currentSession = payload.session;
      saveClearanceSession(payload.session);
      const analysis = payload.attempt.analysis;
      const feedbackText = conciseQuestion(conciseClearanceText(analysis), 72);
      const nextQuestion = conciseQuestion(
        analysis.nextQuestion || analysis.teaching || "请再补充一个例子。",
        48
      );
      this.setData({
        working: false,
        phase: "feedback",
        pendingQuestion: nextQuestion,
        selectedAction: 0,
        actionPrimary: "继续",
        actionSecondary: "重试",
        actionTertiary: "结束",
        state: "AI 已给出反馈",
        target: clearanceStatusLabel(analysis.status),
        question: feedbackText,
        questionClass: "question feedback-question",
        resultText: "",
        sourceHint: analysis.recommendation === "end"
          ? "可结束，也可继续"
          : "继续查看追问",
        resultClass: analysis.status === "provisionally_cleared"
          ? "feedback-text feedback-good"
          : "feedback-text feedback-warning"
      });
    } catch (error) {
      this.setData({
        working: false,
        state: "分析失败",
        resultText: conciseRuntimeError(error),
        resultClass: "feedback-text feedback-warning"
      });
    } finally {
      this.processingAnswer = false;
    }
  },

  exitView() {
    const runtimeWx = globalThis.wx;
    if (runtimeWx?.navigateBack) runtimeWx.navigateBack({ delta: 1 });
  },

  async begin(cardId = this.config.cardId) {
    this.stopRecognition();
    this.processingAnswer = false;
    this.setData({
      loading: true,
      ready: false,
      ended: false,
      phase: "question",
      pendingQuestion: "",
      working: false,
      listening: false,
      canEnd: false,
      selectedAction: 0,
      actionPrimary: "解释",
      actionSecondary: "重试",
      actionTertiary: "结束",
      state: "读取认知欠条",
      sourceText: "",
      sourceHint: "回答前不显示答案",
      resultText: "",
      resultClass: "feedback-text",
      question: "",
      questionClass: "question"
    });
    try {
      const payload = await fetchClearanceEntry(this.config, cardId);
      const entry = payload.entry;
      if (!entry) {
        saveClearanceSession(null);
        this.setData({
          loading: false,
          state: "暂无认知欠条",
          target: "先在电脑端生成报告",
          question: "导入一段 AI 对话并生成认知欠条报告后，再回到眼镜开始清偿。",
          questionClass: "question",
          progressText: "0 / 0"
        });
        return;
      }

      this.currentEntry = entry;
      this.config.cardId = entry.cardId;

      this.setData({
        state: "检索外部证据",
        target: entry.target,
        question: conciseQuestion(entry.prompt),
        questionClass: "question",
        progressText: `${entry.cardNumber} / ${entry.cardCount}`
      });
      const started = await startClearance(this.config, entry.reportId, entry.cardId);
      this.currentSession = started.session;
      saveClearanceSession(started.session);
      this.setData({
        loading: false,
        ready: true,
        canEnd: true,
        phase: "question",
        state: "请直接口述回答",
        question: conciseQuestion(started.session.clearanceQuestion),
        questionClass: "question",
        sourceText: `${started.session.sources?.length || 0} 个来源已核对`
      });
    } catch (error) {
      saveClearanceSession(null);
      this.setData({
        loading: false,
        ready: false,
        state: "暂时无法开始",
        target: "连接或 AI 研究失败",
        question: conciseRuntimeError(error),
        questionClass: "question",
        resultText: "检查网络和后端状态后重试；文本 AI 与研究服务是独立配置。",
        resultClass: "feedback-text feedback-warning"
      });
    }
  },

  async finish() {
    const session = this.data.canEnd
      ? this.currentSession || this.sessionFromStorage()
      : null;
    if (!session?.id) {
      this.setData({ state: "会话已失效", resultText: "请点击重试，重新开始本轮清偿。" });
      return;
    }
    this.setData({
      working: true,
      state: "正在结算",
      resultText: "操作已收到，请稍候。"
    });
    try {
      const payload = await endClearance(this.config, session.id);
      this.currentSession = payload.session;
      saveClearanceSession(payload.session);
      const answerText = conciseAnswerText(payload.session, payload.result);
      this.setData({
        state: "参考答案",
        ready: false,
        canEnd: false,
        ended: true,
        phase: "ended",
        pendingQuestion: "",
        working: false,
        selectedAction: 2,
        actionPrimary: "回顾",
        actionSecondary: "重学",
        actionTertiary: "下一张",
        target: clearanceStatusLabel(payload.result.status),
        question: answerText,
        questionClass: "question answer-question",
        sourceHint: "参考答案已显示",
        resultText: payload.result.sourceReviewRequired
          ? "普通网页来源参与了关键判断，需回到桌面端查证。"
          : conciseQuestion(payload.result.nextRecommendation, 36),
        resultClass: payload.result.status === "provisionally_cleared"
          ? "feedback-text feedback-good"
          : "feedback-text feedback-warning"
      });
    } catch (error) {
      this.setData({
        working: false,
        state: "结算失败",
        resultText: conciseRuntimeError(error)
      });
    }
  },

  sessionFromStorage() {
    return loadClearanceSession();
  },

  async retry() {
    this.currentSession = null;
    saveClearanceSession(null);
    this.setData({ state: "正在重试", resultText: "操作已收到，正在重新连接。" });
    await this.begin(this.currentEntry?.cardId || this.config.cardId);
  },

  showResultSummary() {
    this.setData({
      state: "本轮结束",
      resultText: "结果是阶段性证据，不等于永久掌握。",
      resultClass: "feedback-text feedback-warning"
    });
  },

  showFollowupQuestion() {
    this.setData({
      phase: "question",
      selectedAction: 0,
      actionPrimary: "解释",
      actionSecondary: "重试",
      actionTertiary: "结束",
      state: "继续解释",
      question: this.data.pendingQuestion || "请再补充一个具体例子。",
      questionClass: "question",
      resultText: "",
      sourceHint: "回答前不显示答案"
    });
  },

  async nextCard() {
    const nextCardId = this.currentEntry?.nextCardId;
    if (!nextCardId) {
      this.setData({ state: "本组完成", resultText: "当前没有更多卡片。" });
      return;
    }
    this.setData({
      loading: true,
      working: true,
      state: "切换下一张",
      question: "",
      questionClass: "question",
      resultText: "",
      sourceText: "",
      sourceHint: "回答前不显示答案"
    });
    await this.begin(nextCardId);
  },

  onUnload() {
    this.stopRecognition();
  }
}
</script>

<page>
  <view class="screen">
    <view class="topline">
      <text class="brand">MINDIOU</text>
      <text class="progress">{{ progressText }}</text>
    </view>

    <view class="meta">
      <text class="target">{{ target }}</text>
      <text class="state">{{ state }}</text>
    </view>

    <view class="question-area">
      <text class="{{ questionClass }}" ink:if="{{ question }}">{{ question }}</text>
      <text class="{{ resultClass }}" ink:if="{{ resultText }}">{{ resultText }}</text>
    </view>

    <view class="source-row" ink:if="{{ sourceText && (ready || ended) }}">
      <text>{{ sourceText }}</text>
      <text>{{ sourceHint }}</text>
    </view>

    <view class="actions" ink:if="{{ !working && !listening && !loading }}">
      <button class="quiet {{ selectedAction === 0 ? 'selected' : '' }}" bindtap="handlePrimary">{{ actionPrimary }}</button>
      <button class="quiet {{ selectedAction === 1 ? 'selected' : '' }}" bindtap="retry">{{ actionSecondary }}</button>
      <button class="quiet {{ selectedAction === 2 ? 'selected' : '' }}" bindtap="handleTertiary" disabled="{{ !canEnd && !ended }}">{{ actionTertiary }}</button>
    </view>
  </view>
</page>

<style>
.screen {
  width: 100%;
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
  padding: 12rpx 28rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: #000000;
  color: #ffffff;
}

.topline,
.meta,
.source-row,
.actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.brand,
.progress,
.target,
.state,
.source-row,
.feedback-text {
  font-size: 18rpx;
  line-height: 26rpx;
}

.brand,
.target {
  font-weight: 700;
  color: #ffffff;
}

.progress,
.state,
.source-row,
.feedback-text {
  color: #a8b2ad;
}

.meta {
  margin-top: 2rpx;
  padding-top: 2rpx;
  border-top: 1rpx solid #39423f;
}

.target {
  max-width: 58%;
  overflow: hidden;
}

.question-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 6rpx 0;
}

.target {
  font-size: 20rpx;
  line-height: 24rpx;
  color: #b8f0dc;
}

.question {
  display: block;
  margin-top: 2rpx;
  max-height: 84rpx;
  overflow: hidden;
  font-size: 34rpx;
  line-height: 40rpx;
  font-weight: 700;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.feedback-question,
.answer-question {
  max-height: 116rpx;
  font-size: 23rpx;
  line-height: 29rpx;
  font-weight: 600;
}

.answer-question {
  color: #f4f7f5;
}

.source-row {
  padding: 3rpx 0;
  border-top: 1rpx solid #27302d;
}

.feedback-text {
  display: block;
  margin-top: 5rpx;
  max-height: 28rpx;
  overflow: hidden;
  color: #a8b2ad;
}

.feedback-good { color: #8ee8c7; }
.feedback-warning { color: #f2d479; }

.actions {
  gap: 8rpx;
}

.actions button {
  flex: 1;
  min-width: 0;
  height: 48rpx;
  padding: 0 6rpx;
  font-size: 19rpx;
  line-height: 46rpx;
  border: 1rpx solid #65716d;
  background: #000000;
  color: #ffffff;
}

.actions .selected {
  border-width: 3rpx;
  border-color: #ffffff;
  background: #f4f7f5;
  color: #000000;
  font-weight: 700;
}

</style>
