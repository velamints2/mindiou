# MindIOU Web 前端包

这是已经构建完成、可连接真实 MindIOU 后端的前端交付包。

## 运行要求

- Node.js 20 或更高版本
- MindIOU 后端已经运行并可访问

## 本地启动

默认连接 `http://127.0.0.1:8793`：

```bash
npm start
```

打开：

```text
http://localhost:8080
```

如果后端在其他地址：

```bash
MINDIOU_API_ORIGIN=https://your-api.example.com npm start
```

如需修改前端端口：

```bash
PORT=8090 npm start
```

## 连接方式

`start.mjs` 同时提供静态前端和同源 API 代理：

- `/health` -> 后端 `/health`
- `/api/*` -> 后端 `/api/*`
- `/mindiou-api/*` -> 后端对应路径

这可以避免把 API Key 写进前端，也避免直接用 `file://` 打开构建文件时出现跨域或相对路径错误。

Web 邀请码会提交到后端 `/api/access/login`。后端通过签名的 HttpOnly Cookie 建立会话；前端不会保存邀请码。设备端使用的 Bearer Token 不属于本前端包。

## 目录

- `public/`：构建后的前端文件
- `start.mjs`：零依赖静态服务与 API 代理
- `package.json`：启动入口

## 健康检查

启动后执行：

```bash
curl http://localhost:8080/health
```

只有返回 `"ok": true` 才代表前端代理已经连接到后端。AI 是否真实可达，应继续检查后端的 `/health?live=1`，不能只看页面能否打开。
