# RapVideo 网站（已端到端跑通，带账号系统）

## 架构
单进程 Node.js（express），无数据库依赖（JSON 文件存储），可部署到任何
能跑 Node 18+ 的平台（Railway / Render / Fly.io / VPS）。

```
rapvideo-site/
  server.js            主入口：账号 + 支付 + 4 个接口 + 任务队列 + 7 天清理
  lib/pipeline.js      流水线：DeepSeek 写词 → SeeAPI 音乐 → SeeAPI 对口型
  lib/store.js         JSON 订单库（原子写、去重、审计日志）
  lib/users.js         用户 + 会话库（scrypt 密码哈希，只存 token 的 sha256）
  lib/auth.js          Cookie 会话、Google OAuth 授权码流程
  lib/admin.js         后台鉴权（一把 ADMIN_TOKEN + 签名 Cookie，12 小时）
  lib/adminApi.js      后台接口：订单/用户/成本/重跑/补单/封禁
  lib/packs.js         价格表（前台收银台与后台统计共用一份）
  public/index.html    首页（制作器 + 案例区 + 登录态导航）
  public/auth.html     注册 / 登录页（邮箱密码 + Google）
  public/my-videos.html 当前用户的视频列表
  public/success.html  支付后进度页（轮询 /api/order/:id）
  public/admin.html    管理后台（单页，访问 /admin）
  public/legal/        Terms / Privacy / Refunds（页脚可直达）
  public/examples/     首页案例 MP4
  data/                uploads/ 照片、videos/ 成品、orders.json、users.json
  .env                 全部密钥（勿提交 git）
```

## 账号系统
- **注册/登录**：`POST /api/auth/register`、`/api/auth/login`、`/api/auth/logout`、`GET /api/auth/me`
- 密码用 `scrypt`（Node 内置）加盐哈希；会话 token 只在数据库存 sha256，30 天有效
- Cookie：`rv_session`，`HttpOnly` + `SameSite=Lax`（生产环境自动加 `Secure`）
- **下单必须登录**：`/api/draft` 返回 401，订单绑定 `userId`
- **订单隔离**：`/api/order/:id` 非本人返回 403（老订单无 userId 仍可访问）
- 首页导航显示头像/首字母 + My videos + Sign out；未登录点付款会跳 `/auth.html?next=/`

### 开启 Google 登录（3 步）
1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → 创建项目
2. `OAuth consent screen` 填应用名 + 支持邮箱 → 追加 scope `email`、`profile`
3. `Create credentials → OAuth client ID → Web application`
   - Authorized redirect URI：`http://localhost:3000/auth/google/callback`
     （上线换成 `https://<域名>/auth/google/callback`）
   - 把 Client ID / Client Secret 填进 `.env` 的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

填好重启即生效；未填时按钮仍在，但会提示"未配置"，邮箱密码登录不受影响。

## 流程（先收款后生产，永不垫 API 费）
1. 首页选照片/主题/风格 → 免费歌词预览（IP 限流 10 次/时）
2. 点付款 → `POST /api/draft` → 订单落库 + Waffo 收银台链接
3. 用户在 Waffo 支付
4. Waffo webhook → `POST /api/webhooks/waffo`（RSA 验签 + event.id 幂等）
5. `order.completed` → 订单标 paid → 队列逐单跑流水线（单并发保护余额）
6. 进度页轮询 → 完成展示/下载 MP4（496×864、15s、约 6.5 分钟）

## 实测记录（2026-10-25）
- 歌词接口：真实 DeepSeek，押韵 6 行 ✓
- draft：真实 Waffo test 收银台链接 ✓
- webhook：伪造签名 401 ✓
- 全流程：6m37s、406 credits（≈$1.50）出片 ✓
- 视频经 /videos/*.mp4 HTTP 交付 ✓

## 部署清单
1. 服务器起 `node server.js`，`BASE_URL` 设为正式域名
2. Waffo 后台 webhook URL 填 `https://<域名>/api/webhooks/waffo`
3. 上线前：Waffo 建 prod key → `onetimeProducts.publish` 把 test 产品推生产
4. 换掉 uguu.se 临时图床 → R2/S3 签名 URL（lib/pipeline.js 的 uploadPublic）
5. 自动退款：目前 failed 只落库+报错，接 Waffo refunds API（Refund Policy 承诺）
6. 域名 DNS → Cloudflare，HTTPS 由平台或 CF 提供
7. 轮换所有 key（聊天中暴露过 6 个）

## 本地体验
```
node server.js          # http://localhost:3000
node test-run-order.mjs <orderId>   # 模拟 webhook 触发生成（测试用）
```

## 2026-10-27 视觉改版（参考 rapvideo.app）
设计语言：近黑舞台 `#0b0b10` + 单一荧光黄 `#f5c542`，Anton 压缩大写标题，
Archivo 正文，JetBrains Mono 做 01/CH 01 这类小标签，圆角压到 2–4px。

- `public/ui.css` — 共享设计系统（tokens / nav / 按钮 / 表单 / 页脚）
- `public/index.html` — 重排为：Hero → 话题跑马灯 → CH 编号案例轮播 → 编号表单(01 rapper / 02 bars / 03 beat / 04 scene) → 三步骤 → 价格带 → FAQ
- `public/fonts/` + `public/fonts.css` — 字体自托管（12 个 woff2，204KB），不依赖 Google Fonts
- auth / my-videos / success 只加了两行 link，靠 CSS 变量继承暗色，结构未改
- 定价仍用真实产品价 $9.99 / $19.99 / $29.99（与 Waffo 一致）

## 2026-10-26 更新
- 全站纯英文（public/ 下 0 行中文）
- 首页新增 Examples 案例区：真实生成的 MP4 自动静音循环 + Sound on 切换
- 新增注册登录（邮箱密码 + Google OAuth）、My videos 页、订单归属隔离
- 页脚接上 /legal/terms|privacy|refund（上线前需填 [YOUR FULL LEGAL NAME] 与地址占位符）

## 管理后台（/admin）
一个人用的操作面板，不是 CMS。口令登录，Cookie 签名 12 小时。

- 入口：`http://localhost:3000/admin`，口令 = `.env` 的 `ADMIN_TOKEN`
  （未设置时首次启动会随机生成到 `data/.admin-token` 并打印在控制台）
- **KPI**：营收 / API 成本 / 毛利率 / 订单数 / 账号数，队列实时状态（running · queued）
- **订单**：按状态筛选（In flight / Failed / Done / Unpaid / Refunded）、按邮箱·订单号·主题搜索
  - 每单显示 credits、折算美元成本、售价、是否免费单
  - 点开抽屉：失败原因、台词、客户照片、成品视频、Waffo 订单号、重试次数
  - `Re-run`：仅 failed 单，或 10 分钟没动静的 paid 单（防止误点排队中的单）；照片已被 7 天清理则禁用
  - `Mark refunded`：只改本地记录，**真退款仍需在 Waffo 后台操作**
- **用户**：注册方式、加入时间、最近登录、订单数、累计消费、剩余免费券
  - `Comp`：补 N 张免费券 → 该用户下次下单直接跳过收银台（`/api/draft` 返回 `free:true`）
  - `Suspend`：踢下线 + 禁止登录（403）；`Delete`：需键入邮箱确认，订单保留作财务记录

### 后台接口（全部要求登录，未登录 401）
```
POST /api/admin/login | /logout        GET  /api/admin/me
GET  /api/admin/data?status=&q=        GET  /api/admin/order/:id
GET  /api/admin/photo/:id/:n           POST /api/admin/order/:id/retry | /status
POST /api/admin/user/:id/grant | /ban | /delete
```
安全边界：客户照片走 `/api/admin/photo/*` 鉴权后才发；登录失败 10 分钟 6 次即锁 IP。
