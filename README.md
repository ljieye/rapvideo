# RapDuet.AI — AI 说唱二重唱视频生成站

功能对齐 airapvideo.org 的同类站点（原创 UI 与文案，中英双语）：
上传两张人像或一张合影 → 选舞台/场合/语言/画幅 → DeepSeek 生成说唱导演脚本并预审 → SeeAPI 提交 MiniMax H3 生成 12 秒 768P 二重唱视频 → 在「我的作品」试听下载。

## 运行

```bash
NODE_PATH=/Users/dandan/.workbuddy/binaries/node/workspace/node_modules \
  /Users/dandan/.workbuddy/binaries/node/versions/22.22.2-6/bin/node server.js
# 打开 http://localhost:3000
```

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
