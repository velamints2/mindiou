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
  startClearance
} from "../../utils/api.js";
import {
  clearanceStatusLabel,
  conciseQuestion,
  conciseRuntimeError
} from "../../utils/learning.js";

export default {
  data: {
    loading: true,
    ready: false,
    state: "读取认知欠条",
    domain: "MINDIOU",
    target: "准备清偿",
    question: "正在寻找最近一次 AI 实践留下的理解缺口。",
    sourceText: "",
    progressText: "— / —",
    resultText: "",
    resultClass: "result",
    canEnd: false
  },

  async onLoad(query = {}) {
    this.config = getRuntimeConfig(query);
    await this.begin();
  },

  async begin() {
    this.setData({
      loading: true,
      ready: false,
      state: "读取认知欠条",
      resultText: "",
      question: "正在寻找最近一次 AI 实践留下的理解缺口。"
    });
    try {
      const payload = await fetchClearanceEntry(this.config);
      const entry = payload.entry;
      if (!entry) {
        saveClearanceSession(null);
        this.setData({
          loading: false,
          state: "暂无认知欠条",
          domain: "MINDIOU",
          target: "先在电脑端生成报告",
          question: "导入一段 AI 对话并生成认知欠条报告后，再回到眼镜开始清偿。",
          progressText: "0 / 0"
        });
        return;
      }

      this.setData({
        state: "检索外部证据",
        domain: entry.domain || "认知债务",
        target: entry.target,
        question: conciseQuestion(entry.prompt),
        progressText: `${entry.cardNumber} / ${entry.cardCount}`
      });
      const started = await startClearance(this.config, entry.reportId, entry.cardId);
      saveClearanceSession(started.session);
      this.setData({
        loading: false,
        ready: true,
        canEnd: true,
        state: "请直接口述回答",
        question: conciseQuestion(started.session.clearanceQuestion),
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
        resultText: "检查网络和后端状态后重试；文本 AI 与研究服务是独立配置。",
        resultClass: "result result-warning"
      });
    }
  },

  async finish() {
    const session = this.data.canEnd ? this.sessionFromStorage() : null;
    if (!session?.id) return;
    this.setData({ state: "正在结算" });
    try {
      const payload = await endClearance(this.config, session.id);
      saveClearanceSession(payload.session);
      this.setData({
        state: "本轮结束",
        ready: false,
        canEnd: false,
        target: clearanceStatusLabel(payload.result.status),
        question: payload.result.nextRecommendation,
        resultText: payload.result.sourceReviewRequired
          ? "普通网页来源参与了关键判断，需回到桌面端查证。"
          : "结果已保留为谨慎判断，不等于永久掌握。",
        resultClass: payload.result.status === "provisionally_cleared" ? "result result-good" : "result result-warning"
      });
    } catch (error) {
      this.setData({ state: "结算失败", resultText: String(error.message || error) });
    }
  },

  sessionFromStorage() {
    return loadClearanceSession();
  },

  openReview() {
    const runtimeWx = globalThis.wx;
    if (runtimeWx?.navigateTo) {
      runtimeWx.navigateTo({ url: "/pages/index/index" });
    }
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
      <text class="domain">{{ domain }}</text>
      <text class="state">{{ state }}</text>
    </view>

    <view class="question-area">
      <text class="target">{{ target }}</text>
      <text class="question">{{ question }}</text>
    </view>

    <view class="source-row" ink:if="{{ sourceText }}">
      <text>{{ sourceText }}</text>
      <text>回答前不显示答案</text>
    </view>

    <view class="{{ resultClass }}" ink:if="{{ resultText }}">
      <text>{{ resultText }}</text>
    </view>

    <view class="actions">
      <button class="quiet" bindtap="openReview">复习</button>
      <button class="quiet" bindtap="begin">重试</button>
      <button class="primary" bindtap="finish" disabled="{{ !canEnd }}">结束</button>
    </view>

    <text class="voice-hint" ink:if="{{ ready }}">直接解释；完成时说“结束清偿”</text>
  </view>
</page>

<style>
.screen {
  width: 100%;
  min-height: 100vh;
  padding: 26rpx 34rpx 22rpx;
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
.domain,
.state,
.source-row,
.voice-hint {
  font-size: 18rpx;
  line-height: 26rpx;
}

.brand,
.domain {
  font-weight: 700;
  color: #ffffff;
}

.progress,
.state,
.source-row,
.voice-hint {
  color: #a8b2ad;
}

.meta {
  margin-top: 12rpx;
  padding-top: 10rpx;
  border-top: 1rpx solid #39423f;
}

.domain {
  max-width: 58%;
  overflow: hidden;
}

.question-area {
  flex: 1;
  min-height: 260rpx;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 18rpx 0;
}

.target {
  font-size: 27rpx;
  line-height: 36rpx;
  color: #b8f0dc;
}

.question {
  display: block;
  margin-top: 16rpx;
  max-height: 210rpx;
  overflow: hidden;
  font-size: 44rpx;
  line-height: 54rpx;
  font-weight: 700;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.source-row {
  padding: 10rpx 0;
  border-top: 1rpx solid #27302d;
}

.result {
  margin: 10rpx 0;
  padding: 12rpx 15rpx;
  border-left: 4rpx solid #ffffff;
  background: #111916;
  font-size: 22rpx;
  line-height: 31rpx;
}

.result-good { border-left-color: #8ee8c7; }
.result-warning { border-left-color: #f2d479; }

.actions {
  gap: 8rpx;
}

.actions button {
  flex: 1;
  min-width: 0;
  height: 58rpx;
  padding: 0 6rpx;
  font-size: 20rpx;
  line-height: 56rpx;
  border: 1rpx solid #65716d;
  background: #000000;
  color: #ffffff;
}

.actions .primary {
  border-color: #ffffff;
  background: #ffffff;
  color: #000000;
  font-weight: 700;
}

.voice-hint {
  display: block;
  margin-top: 12rpx;
  text-align: center;
}
</style>
