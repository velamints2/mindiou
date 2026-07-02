<script def>
{
  "navigationBarTitleText": "Learn Coach",
  "description": "Handle a spoken Learn Coach command or evaluate the learner's spoken explanation.",
  "schema": {
    "data": {
      "type": "object",
      "properties": {
        "utterance": {
          "type": "string",
          "description": "The user's exact spoken command or learning answer."
        },
        "action": {
          "type": "string",
          "enum": ["auto", "answer", "next", "previous", "repeat", "ask", "known", "skip"],
          "description": "Use auto unless the command intent is already certain."
        },
        "api": {
          "type": "string",
          "description": "Optional Learn Coach backend base URL."
        }
      },
      "required": ["utterance"]
    }
  }
}
</script>

<script setup>
import { DEMO_CARD } from "../../config.js";
import {
  getRuntimeConfig,
  loadCurrentCard,
  sendReview,
  sendTutorAction
} from "../../utils/api.js";
import {
  assessmentToReview,
  commandFromUtterance,
  conciseFeedback
} from "../../utils/learning.js";

export default {
  data: {
    state: "识别完成",
    concept: "Learn Coach",
    utterance: "",
    feedback: "正在处理你的回答。",
    followUp: "",
    assessment: "unknown",
    resultLabel: "ACTIVE RECALL"
  },

  async onLoad(query = {}) {
    const config = getRuntimeConfig(query);
    const card = loadCurrentCard() || DEMO_CARD;
    const utterance = String(query.utterance || "").trim();
    const action = query.action && query.action !== "auto"
      ? query.action
      : commandFromUtterance(utterance);
    this.setData({ concept: card.front, utterance, state: "AI 评估中" });

    if (["known", "skip"].includes(action) && !card.id.startsWith("demo-")) {
      try {
        await sendReview(config, card.id, action === "known" ? "mastered" : "skip", utterance);
        this.setData({
          state: action === "known" ? "已掌握" : "已跳过",
          assessment: action === "known" ? "correct" : "unknown",
          resultLabel: action === "known" ? "DEBT CLEARED" : "SCHEDULED",
          feedback: action === "known" ? "这笔学习债务已清偿。" : "稍后会再次出现。",
          followUp: "返回 Learn Coach 继续下一题。"
        });
        return;
      } catch (error) {
        this.setData({ state: "保存失败", feedback: String(error.message || error) });
        return;
      }
    }

    if (["next", "previous"].includes(action)) {
      this.setData({
        state: "导航命令",
        resultLabel: action.toUpperCase(),
        feedback: action === "next" ? "返回主会话并进入下一题。" : "返回主会话并进入上一题。",
        followUp: ""
      });
      return;
    }

    try {
      const tutorAction = action === "repeat" || action === "ask" ? action : "answer";
      const payload = await sendTutorAction(config, card, tutorAction, utterance, { index: 0, total: 1 });
      const tutor = payload.tutor || {};
      this.setData({
        state: tutor.shouldFollowUp ? "继续解释" : "本题完成",
        assessment: tutor.assessment || "unknown",
        resultLabel: String(tutor.assessment || "active recall").toUpperCase(),
        feedback: conciseFeedback(payload),
        followUp: tutor.nextQuestion || tutor.summary || ""
      });
      if (tutorAction === "answer" && !card.id.startsWith("demo-")) {
        await sendReview(config, card.id, assessmentToReview(tutor.assessment), utterance);
      }
    } catch (error) {
      this.setData({
        state: "暂时离线",
        resultLabel: "LOCAL",
        feedback: "回答已收到。请补一个具体例子，说明你真的理解了这个概念。",
        followUp: "这个概念在你的工作中何时会用到？"
      });
    }
  }
}
</script>

<page>
  <view class="result">
    <view class="meta">
      <text class="label">{{ resultLabel }}</text>
      <text class="state">{{ state }}</text>
    </view>
    <text class="concept">{{ concept }}</text>
    <text class="utterance" ink:if="{{ utterance }}">“{{ utterance }}”</text>
    <text class="feedback">{{ feedback }}</text>
    <view class="follow-up" ink:if="{{ followUp }}">
      <text>{{ followUp }}</text>
    </view>
    <text class="return-hint">说“继续学习”返回主会话</text>
  </view>
</page>

<style>
.result {
  width: 100%;
  min-height: 100vh;
  padding: 30rpx 36rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #000000;
  color: #ffffff;
}

.meta {
  display: flex;
  justify-content: space-between;
  border-bottom: 1rpx solid #3f4945;
  padding-bottom: 12rpx;
}

.label,
.state,
.return-hint {
  font-size: 18rpx;
  color: #aab5b0;
}

.label {
  color: #b8f0dc;
  font-weight: 700;
}

.concept {
  margin-top: 24rpx;
  font-size: 54rpx;
  line-height: 62rpx;
  font-weight: 700;
}

.utterance {
  margin-top: 18rpx;
  font-size: 22rpx;
  line-height: 32rpx;
  color: #aab5b0;
}

.feedback {
  margin-top: 22rpx;
  font-size: 30rpx;
  line-height: 42rpx;
}

.follow-up {
  margin-top: 24rpx;
  padding: 16rpx 18rpx;
  border-left: 4rpx solid #ffffff;
  background: #121916;
  font-size: 25rpx;
  line-height: 36rpx;
}

.return-hint {
  margin-top: 24rpx;
}
</style>
