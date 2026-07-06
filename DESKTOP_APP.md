# Desktop App

## 如何启动

开发模式：

```bash
npm run dev:desktop
```

或者分别启动：

```bash
npm run dev
```

再启动桌面窗口。

## 页面区域

### Sources

- 粘贴文本
- 导入 `.txt` / `.md` 文件
- 显示原始内容字数
- 显示切块数量
- 点击 `Generate Local Cards`

### Cards

每张卡显示：

- `type`
- `front`
- `back`
- `glassesText`
- `prompt`
- `hint`
- `sourceExcerpt`
- `qualityScore`
- `qualityWarnings`

支持：

- 编辑 `front` / `back` / `glassesText` / `prompt` / `hint`
- 删除卡片
- 保留卡片
- 按质量排序
- 按类型筛选
- 保存为 Deck
- 导出 JSON
- 导出 Markdown

### Session

最小版本支持：

- 当前卡片 `front`
- 用户复述 `prompt`
- 参考答案 `back`
- 眼镜短文本 `glassesText`
- 上一张 / 下一张

## 测试

```bash
npm run test:cards
npm run test:desktop
```

## 当前限制

- 还没有复杂语音流程
- 还没有 AI 评分
- 还没有云同步
- 还没有数据库
- 还没有真正的眼镜推送

## 不做的事

- 不打包新的 `.ehpk`
- 不修改 Even G2 BLE 传输逻辑
- 不修改眼镜端手势
- 不继续优化图片推送
- 不接入新的外部 AI API
- 不依赖 OpenAI API
- 不做用户登录
- 不做云同步
- 不做复杂数据库
