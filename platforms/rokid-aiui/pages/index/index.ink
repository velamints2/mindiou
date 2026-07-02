<script def>
{
  "navigationBarTitleText": "Learn Coach"
}
</script>

<script setup>
import { DEMO_CARD } from "../../config.js";
import {
  fetchSession,
  getRuntimeConfig,
  saveCurrentCard,
  sendReview,
  sendTutorAction
} from "../../utils/api.js";
import { conciseFeedback } from "../../utils/learning.js";

export default {
  data: {
    loading: true,
    offline: false,
    status: "同步学习队列",
    card: DEMO_CARD,
    cardIndex: 0,
    cardCount: 1,
    feedback: "",
    sessionDuration: 60,
    progressText: "1 / 1",
    priorityText: "DEMO",
    questionVisible: true,
    conceptClass: "concept"
  },

  async onLoad(query = {}) {
    this.config = getRuntimeConfig(query);
    this.cards = [];
    await this.loadSession(query.demo === "1");
  },

  async loadSession(demo = false) {
    this.setData({ loading: true, status: "同步学习队列", feedback: "" });
    try {
      const payload = await fetchSession(this.config, this.config.duration, demo);
      this.cards = payload.session.cards || [];
      if (!this.cards.length) {
        this.cards = [DEMO_CARD];
        this.setData({
          offline: false,
          status: "今日已完成",
          feedback: "没有到期卡片。演示卡可继续练习。"
        });
      }
      this.showCard(0);
      this.setData({
        loading: false,
        sessionDuration: payload.session.duration,
        status: payload.session.cards?.length ? "请先回答，再看答案" : "演示模式"
      });
    } catch (error) {
      this.cards = [DEMO_CARD];
      this.showCard(0);
      this.setData({
        loading: false,
        offline: true,
        status: "离线演示",
        feedback: "后端暂不可达，当前使用内置演示卡。"
      });
    }
  },

  showCard(index) {
    if (!this.cards?.length) return;
    const cardIndex = Math.max(0, Math.min(index, this.cards.length - 1));
    const card = this.cards[cardIndex];
    saveCurrentCard(card);
    this.setData({
      card,
      cardIndex,
      cardCount: this.cards.length,
      progressText: `${cardIndex + 1} / ${this.cards.length}`,
      priorityText: card.debtScore ? `DEBT ${Math.round(card.debtScore)}` : "ACTIVE RECALL",
      questionVisible: true,
      conceptClass: card.front.length > 24
        ? "concept concept-compact"
        : card.front.length > 14
          ? "concept concept-long"
          : "concept",
      feedback: ""
    });
  },

  previousCard() {
    this.showCard(this.data.cardIndex - 1);
  },

  nextCard() {
    if (this.data.cardIndex < this.cards.length - 1) {
      this.showCard(this.data.cardIndex + 1);
      return;
    }
    this.setData({ status: "本轮完成", feedback: "已到本次学习队列末尾。" });
  },

  async askCoach() {
    this.setData({ status: "AI 正在提问" });
    try {
      const payload = await sendTutorAction(
        this.config,
        this.data.card,
        "ask",
        "",
        { index: this.data.cardIndex, total: this.data.cardCount }
      );
      this.setData({
        status: "请用自己的话回答",
        feedback: payload.tutor?.nextQuestion || payload.tutor?.message || this.data.card.prompt
      });
    } catch (error) {
      this.setData({ status: "请回答", feedback: this.data.card.prompt });
    }
  },

  revealHint() {
    this.setData({
      questionVisible: false,
      status: "提示",
      feedback: this.data.card.back
    });
  },

  async markKnown() {
    if (this.data.card.id.startsWith("demo-")) {
      this.setData({ status: "已掌握", feedback: "演示卡已完成。" });
      this.nextCard();
      return;
    }
    this.setData({ status: "保存复习结果" });
    try {
      await sendReview(this.config, this.data.card.id, "mastered");
      this.setData({ status: "已清偿", feedback: "这笔学习债务已标记为掌握。" });
      this.nextCard();
    } catch (error) {
      this.setData({ status: "保存失败", feedback: String(error.message || error) });
    }
  }
}
</script>

<page>
  <view class="screen">
    <view class="topline">
      <text class="brand">LEARN COACH</text>
      <text class="progress">{{ progressText }}</text>
    </view>

    <view class="priority-row">
      <text class="priority">{{ priorityText }}</text>
      <text class="status">{{ status }}</text>
    </view>

    <view class="concept-area">
      <text class="{{ conceptClass }}">{{ card.front }}</text>
      <text class="question" ink:if="{{ questionVisible }}">{{ card.prompt }}</text>
      <text class="answer" ink:else>{{ card.back }}</text>
    </view>

    <view class="feedback-area" ink:if="{{ feedback }}">
      <text class="feedback">{{ feedback }}</text>
    </view>

    <view class="actions">
      <button class="quiet" bindtap="revealHint">提示</button>
      <button class="quiet" bindtap="markKnown">会了</button>
      <button class="primary" bindtap="nextCard">下一题</button>
    </view>

    <text class="voice-hint">直接说出解释，或说“下一题 / 会了 / 提问”</text>
  </view>
</page>

<style>
.screen {
  width: 100%;
  min-height: 100vh;
  padding: 28rpx 34rpx 24rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: #000000;
  color: #ffffff;
}

.topline,
.priority-row,
.actions {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.topline,
.priority-row {
  justify-content: space-between;
}

.brand,
.progress,
.priority,
.status,
.voice-hint {
  font-size: 18rpx;
  line-height: 26rpx;
}

.brand,
.priority {
  font-weight: 700;
  color: #ffffff;
}

.progress,
.status,
.voice-hint {
  color: #a8b2ad;
}

.priority-row {
  margin-top: 12rpx;
  padding-top: 10rpx;
  border-top: 1rpx solid #39423f;
}

.concept-area {
  flex: 1;
  min-height: 240rpx;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 22rpx 0;
}

.concept {
  width: 100%;
  font-size: 64rpx;
  line-height: 72rpx;
  font-weight: 700;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.concept-long {
  font-size: 48rpx;
  line-height: 56rpx;
}

.concept-compact {
  font-size: 38rpx;
  line-height: 46rpx;
}

.question,
.answer {
  display: block;
  margin-top: 24rpx;
  width: 92%;
  font-size: 30rpx;
  line-height: 42rpx;
  color: #e8eeeb;
  max-height: 126rpx;
  overflow: hidden;
}

.answer {
  color: #b8f0dc;
}

.feedback-area {
  margin-bottom: 14rpx;
  padding: 14rpx 16rpx;
  border-left: 4rpx solid #8ee8c7;
  background: #111916;
}

.feedback {
  font-size: 24rpx;
  line-height: 34rpx;
  color: #d9f7ec;
}

.actions {
  gap: 8rpx;
  width: 100%;
}

.actions button {
  flex: 1;
  min-width: 0;
  height: 58rpx;
  padding: 0 6rpx;
  font-size: 20rpx;
  line-height: 56rpx;
  text-align: center;
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
  margin-top: 14rpx;
  text-align: center;
}
</style>
