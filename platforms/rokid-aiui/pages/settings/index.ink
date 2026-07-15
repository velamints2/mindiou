<script def>
{
  "navigationBarTitleText": "Learn Coach 设置"
}
</script>

<script setup>
import {
  checkConnection,
  getRuntimeConfig,
  saveRuntimeConfig
} from "../../utils/api.js";

export default {
  data: {
    apiBaseUrl: "",
    state: "尚未测试",
    detail: "Rokid 真机需要可访问的 HTTPS 或同局域网 API。",
    healthy: false
  },

  onLoad(query = {}) {
    this.config = getRuntimeConfig(query);
    this.setData({ apiBaseUrl: this.config.apiBaseUrl });
  },

  handleApiInput(event) {
    this.setData({ apiBaseUrl: event.detail.value });
  },

  async saveAndTest() {
    const apiBaseUrl = saveRuntimeConfig(this.data.apiBaseUrl, this.config.apiToken);
    this.config.apiBaseUrl = apiBaseUrl;
    this.setData({ state: "正在连接", detail: apiBaseUrl, healthy: false });
    try {
      const payload = await checkConnection(this.config);
      const reachable = Boolean(payload.ai && payload.providerStatus?.reachable);
      this.setData({
        state: reachable ? "AI 可用" : "API 可用，AI 不可用",
        detail: reachable
          ? `${payload.provider || "compatible"} · ${payload.model} · HTTP ${payload.providerStatus.status || 200}`
          : payload.providerStatus?.error || "检查 AI_API_KEY 和模型服务网络",
        healthy: reachable
      });
    } catch (error) {
      this.setData({
        state: "连接失败",
        detail: String(error.message || error),
        healthy: false
      });
    }
  }
}
</script>

<page>
  <view class="settings">
    <text class="eyebrow">RUNTIME</text>
    <text class="title">学习 API</text>
    <input
      class="api-input"
      value="{{ apiBaseUrl }}"
      bindinput="handleApiInput"
      placeholder="https://your-learn-coach-api"
    />
    <button class="test-button" bindtap="saveAndTest">保存并测试</button>
    <view class="result">
      <text class="state">{{ state }}</text>
      <text class="detail">{{ detail }}</text>
    </view>
    <text class="privacy">API Key 只保存在服务端，不进入眼镜应用。</text>
  </view>
</page>

<style>
.settings {
  width: 100%;
  min-height: 100vh;
  padding: 36rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #000000;
  color: #ffffff;
}

.eyebrow,
.privacy {
  font-size: 18rpx;
  color: #aab5b0;
}

.title {
  margin-top: 10rpx;
  font-size: 52rpx;
  font-weight: 700;
}

.api-input {
  width: 100%;
  height: 64rpx;
  margin-top: 24rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
  border: 1rpx solid #69736f;
  background: #101512;
  color: #ffffff;
  font-size: 22rpx;
}

.test-button {
  width: 100%;
  height: 62rpx;
  margin-top: 14rpx;
  border: 1rpx solid #ffffff;
  background: #ffffff;
  color: #000000;
  font-size: 22rpx;
  font-weight: 700;
}

.result {
  margin-top: 20rpx;
  padding: 16rpx;
  border-left: 4rpx solid #b8f0dc;
  background: #111815;
}

.state,
.detail {
  display: block;
}

.state {
  font-size: 26rpx;
  font-weight: 700;
}

.detail {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #c8d2ce;
}

.privacy {
  margin-top: 20rpx;
}
</style>
