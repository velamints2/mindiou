# MindIOU Remote MCP 评委体验指南

## 入口

远程 MCP 使用 Streamable HTTP：

```text
https://demo.mindiou.top/mindiou-mcp
```

在 TRAE 或其他支持 Streamable HTTP 的 Agent 客户端中添加：

```text
Transport: Streamable HTTP
URL: https://demo.mindiou.top/mindiou-mcp
Authorization: Bearer <评委专用 Hook Token>
```

请使用无尾斜杠的 `https://demo.mindiou.top/mindiou-mcp`。带尾斜杠的地址会被 Web
入口重定向，不能作为 Streamable HTTP MCP 地址。

评委 Token 必须是单独签发的项目级 Token，绑定到“评委体验”项目。不要
使用开发者个人 Token，也不要把 Token 放进公开仓库、截图或视频。

## 三步验收

先让 Agent 调用：

```text
get_learning_context
```

预期：返回“评委体验”项目的能力上下文，不会返回其他项目的欠条。

再让 Agent 调用：

```text
recommend_assistance_mode
```

任务可以使用：

```text
修改支付回调，避免同一订单重复发放权益
```

风险等级使用 `high`。预期模式是 `ask_before_decision`，并给出并发竞态、
条件更新、事务或唯一约束相关的前置判断。

最后让 Agent 调用：

```text
capture_project_session
```

传入真实任务、Agent 工作总结、修改文件、测试命令、关键决策和一个欠条
候选。之后调用 `accept_debt_candidate`，再调用 `get_learning_context`，
确认正式欠条已经绑定到评委体验项目。

如果项目已有报告，`get_learning_context` 还会返回 `repaymentGaps` 和
`capabilityProfiles`。报告中的危险缺口会在读取时幂等同步，不需要再手动导入；
只有已关联到当前项目的报告缺口才会被项目级 Token 暴露。

远程 MCP 不启用本地工作区监听器。这样评委不会因为打开自己的仓库而把
文件路径自动写入演示项目；需要捕捉什么内容时，明确调用
`capture_project_session` 即可。

## 故障判断

| 现象 | 判断 |
|---|---|
| 401 | 缺少或无效 Hook Token |
| 403 | 正在复用属于其他 Token 的 MCP 会话 |
| 404 | URL 不是 `/mindiou-mcp`，或 MCP 会话已过期 |
| 503 | 远程 MCP 当前会话数达到上限 |
| `get_learning_context` 返回空 | 评委体验项目尚未创建项目记录，不代表 MCP 失败 |
