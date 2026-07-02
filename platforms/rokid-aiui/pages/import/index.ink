<script def>
{
  "navigationBarTitleText": "AI 转学习卡",
  "description": "Convert user-provided notes, work results, or study material into concise active-recall cards.",
  "schema": {
    "data": {
      "type": "object",
      "properties": {
        "material": {
          "type": "string",
          "description": "The exact source material supplied by the user."
        },
        "projectId": {
          "type": "string",
          "description": "Optional project or subject name."
        },
        "api": {
          "type": "string",
          "description": "Optional Learn Coach backend base URL."
        }
      },
      "required": ["material"]
    }
  }
}
</script>

<script setup>
import { DEMO_CARD } from "../../config.js";
import {
  getRuntimeConfig,
  importMaterial,
  saveCurrentCard
} from "../../utils/api.js";

export default {
  data: {
    state: "AI 编译中",
    countText: "",
    card: DEMO_CARD,
    fallback: false,
    message: "正在寻找真正可复用的概念。"
  },

  async onLoad(query = {}) {
    const config = getRuntimeConfig(query);
    const material = String(query.material || "").trim();
    if (!material) {
      this.setData({ state: "没有材料", message: "请先说出或提供要学习的内容。" });
      return;
    }
    try {
      const payload = await importMaterial(config, material, query.projectId || "rokid-import");
      const cards = payload.cards || [];
      if (!cards.length) {
        this.setData({ state: "没有新卡", message: "这段内容没有提取出适合主动回忆的新概念。" });
        return;
      }
      saveCurrentCard(cards[0]);
      this.setData({
        state: payload.fallback ? "本地降级" : "AI 已生成",
        countText: `${cards.length} 张卡`,
        card: cards[0],
        fallback: Boolean(payload.fallback),
        message: payload.fallback
          ? `AI 暂不可用：${payload.error || "已使用本地解析"}`
          : "第一张卡已经进入学习会话。"
      });
    } catch (error) {
      this.setData({
        state: "连接失败",
        fallback: true,
        message: String(error.message || error)
      });
    }
  }
}
</script>

<page>
  <view class="import-result">
    <view class="meta">
      <text class="state">{{ state }}</text>
      <text class="count">{{ countText }}</text>
    </view>
    <text class="concept">{{ card.front }}</text>
    <text class="question">{{ card.prompt }}</text>
    <text class="message">{{ message }}</text>
    <text class="hint">说“开始学习”进入主动回忆</text>
  </view>
</page>

<style>
.import-result {
  width: 100%;
  min-height: 100vh;
  padding: 34rpx 38rpx;
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
  padding-bottom: 12rpx;
  border-bottom: 1rpx solid #3e4744;
}

.state,
.count,
.message,
.hint {
  font-size: 20rpx;
  color: #aab5b0;
}

.state {
  color: #b8f0dc;
  font-weight: 700;
}

.concept {
  margin-top: 28rpx;
  font-size: 64rpx;
  line-height: 72rpx;
  font-weight: 700;
}

.question {
  margin-top: 24rpx;
  font-size: 30rpx;
  line-height: 42rpx;
}

.message {
  margin-top: 24rpx;
  line-height: 30rpx;
}

.hint {
  margin-top: 18rpx;
  color: #ffffff;
}
</style>
