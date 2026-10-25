# RapDuet.AI — AI 说唱二重唱视频生成站

功能对齐 airapvideo.org 的同类站点（原创 UI 与文案，中英双语）：
上传两张人像或一张合影 → 选舞台/场合/语言/画幅 → DeepSeek 生成说唱导演脚本并预审 → SeeAPI 提交 MiniMax H3 生成 12 秒 768P 二重唱视频 → 在「我的作品」试听下载。

## 运行

本地：

```bash
node server.js
# 打开 http://localhost:3100
```

## 部署到 Vercel

代码已按 Serverless 改造：`api/index.js` 导出函数处理器，`vercel.json` 把所有非静态请求重写到该函数，`public/` 静态文件由 Vercel 直接托管。

1. 推送仓库到 GitHub，Vercel → Import Project（或 `vercel --prod`）。
2. **必须**在 Vercel Dashboard → Settings → Environment Variables 配置（缺一个 API 路由就会 500）：
   - `SEEAPI_API_KEY`、`DEEPSEEK_API_KEY`
   - `WAFFO_MERCHANT_ID`、`WAFFO_STORE_ID`、`WAFFO_PRIVATE_KEY`（单行 Base64）
   - `PUBLIC_BASE_URL=https://rapvideo.vercel.app`
   - `WAFFO_DEV_SIMULATE=0`（生产环境务必为 0）
   - 可选：`WAFFO_PRODUCT_LITE/PRO/ULTRA`（默认已内置当前店铺商品 ID）
3. 重新部署后，在 Pancake Dashboard 把 Webhook URL 设为 `https://rapvideo.vercel.app/api/webhooks/waffo`。
4. 注意：Vercel 函数的文件系统是临时的（数据写入 `/tmp/rapvideo-data`），**额度、订单、任务记录在实例重启/冷启动后会重置**。要持久化请接 Vercel KV/Blob 或数据库（当前版本未接）。

### 本地 / 线上行为差异

| 事项 | 本地 `node server.js` | Vercel |
|---|---|---|
| 数据存储 | 项目 `data/`（持久） | `/tmp`（临时，会丢失） |
| 商品自动创建 | 缺失时自动创建 | 跳过（使用内置 ID） |
| 模拟支付接口 | 由 `WAFFO_DEV_SIMULATE` 控制 | 同左，生产必须 0 |


## 配置（.env）

- `SEEAPI_API_KEY` — SeeAPI 密钥（视频生成）
- `DEEPSEEK_API_KEY` — DeepSeek 密钥（歌词方向 + 内容预审）
- `VIDEO_MODEL` / `VIDEO_ENDPOINT` — 默认 `minimax-h3` / `text-to-video`（与原站同模型；注意该端点为纯文生视频，不接受照片输入）。如需"照片→视频"，可切换为支持图片输入的模型，例如 `vidu-q4` / `image-to-video`
- `FREE_VIDEO_ALLOWANCE` — 演示环境的免费生成次数（默认 5）

## 支付

套餐页展示 $4.90 / $8.90 / $19.90 视频包，当前未接入支付，使用服务器端体验额度记账。

## 已知限制

- MiniMax H3 文生视频端点不接收图片，照片目前仅用于站内展示与授权记录；生成画面由导演脚本文字驱动。
- 展示区为 CSS 渐变占位卡（无真实示例视频素材）。
- 任务与额度存储为本地 JSON（`data/tasks.json`），重启不丢失，但不适合多实例部署。
