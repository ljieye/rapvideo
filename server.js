'use strict';

/**
 * RapDuet.AI — 零依赖 Node 服务器
 * 静态站点 + API：DeepSeek（导演脚本/预审）→ SeeAPI（视频生成任务）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const waffo = require('./waffo');

// ---------- env（简单解析 .env） ----------
function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();

const PORT = parseInt(process.env.PORT || '3000', 10);
const SEEAPI_KEY = process.env.SEEAPI_API_KEY;
const SEEAPI_BASE = process.env.SEEAPI_API_BASE_URL || 'https://api.seeapi.com';
const VIDEO_MODEL = process.env.VIDEO_MODEL || 'minimax-h3';
const VIDEO_ENDPOINT = process.env.VIDEO_ENDPOINT || 'text-to-video';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE = process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const FREE_ALLOWANCE = parseInt(process.env.FREE_VIDEO_ALLOWANCE || '5', 10);

if (!SEEAPI_KEY || !DEEPSEEK_KEY) {
  console.error('缺少 SEEAPI_API_KEY 或 DEEPSEEK_API_KEY，请检查 .env');
  process.exit(1);
}

// ---------- 数据目录 ----------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveTasks() {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}
const tasks = loadJSON(TASKS_FILE, {});

// ---------- 支付相关存储 ----------
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const BALANCE_FILE = path.join(DATA_DIR, 'balance.json');
const products = loadJSON(PRODUCTS_FILE, {});   // { lite: "PROD_xxx", ... }
const orders = loadJSON(ORDERS_FILE, {});       // orderId -> {...}
const balance = loadJSON(BALANCE_FILE, { trialRemaining: FREE_ALLOWANCE, purchased: 0 });
function saveProducts() { fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2)); }
function saveOrders() { fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); }
function saveBalance() { fs.writeFileSync(BALANCE_FILE, JSON.stringify(balance, null, 2)); }
function remainingVideos() { return Math.max(0, balance.trialRemaining + balance.purchased); }

// 启动时确保 Pancake 商品存在（幂等）
(async () => {
  if (!process.env.WAFFO_MERCHANT_ID || !process.env.WAFFO_PRIVATE_KEY) return;
  for (const [packKey, pack] of Object.entries(waffo.PACKS)) {
    if (products[packKey]) continue;
    try {
      const p = await waffo.createOneTimeProduct(process.env.WAFFO_STORE_ID, packKey, pack);
      products[packKey] = p.id;
      saveProducts();
      console.log(`[pancake] product created: ${packKey} → ${p.id}`);
    } catch (e) {
      console.error(`[pancake] 创建商品失败(${packKey}):`, e.message);
    }
  }
  console.log('[pancake] products:', JSON.stringify(products));
})();

// ---------- 选项 ----------
const STAGES = {
  studio: { zh: '录音棚', en: 'Recording studio', scene: 'a warm professional recording studio with a large condenser microphone, acoustic foam panels and soft amber studio lighting' },
  booth:  { zh: '橙色录音棚', en: 'Orange booth', scene: 'a compact orange-lit vocal booth with neon glow, two performers close together against padded walls' },
  street: { zh: '街头 Cypher', en: 'Street cypher', scene: 'an urban street cypher at dusk, graffiti wall background, camera slowly circling two confident performers' },
  lobby:  { zh: '奢华大堂', en: 'Luxury lobby', scene: 'a luxury hotel lobby with marble floors, golden accents and elegant chandeliers' }
};
const OCCASIONS = {
  duet:     { zh: '好友二重唱', en: 'Friendly duet', style: 'a warm, playful back-and-forth between two friends, big smiles and relaxed gestures' },
  birthday: { zh: '生日祝福', en: 'Birthday shout-out', style: 'a high-energy birthday celebration vibe, confetti mood, joyful party energy' },
  couple:   { zh: '情侣对唱', en: 'Couple duet', style: 'a romantic duet between partners, affectionate eye contact and synchronized hooks' },
  battle:   { zh: '友谊 Rap Battle', en: 'Friendly rap battle', style: 'a friendly competitive rap battle, confident posturing, playful call-and-response, no hostility' }
};

// ---------- 工具 ----------
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------- DeepSeek ----------
async function composeDirection({ stage, occasion, language, personalDetail }) {
  const s = STAGES[stage] || STAGES.studio;
  const o = OCCASIONS[occasion] || OCCASIONS.duet;
  const system = [
    'You are a creative director for AI rap duet music videos (12 seconds, two adult performers).',
    'You do two jobs in one response:',
    '1) SCREENING: reject requests that are unsafe (minors, real celebrities, sexual content, violence, hate, impersonation of real artists, or any request suggesting the performers are not consenting adults).',
    '2) DIRECTION: if safe, write one vivid English video-generation prompt describing the two performers, the stage, their alternating rap verses, matching mouth movement, camera behavior and overall vibe.',
    'Output STRICT JSON only, no markdown fences:',
    '{"approved": true|false, "reason": "short reason when rejected (same language as user input)", "direction": "the video prompt, max 1800 characters"}',
    'The direction must explicitly mention: two adult performers, the stage environment, alternating verses (performer A, then performer B, then together), confident rap delivery with clear mouth movement, steady camera.'
  ].join('\n');
  const user = [
    `Stage: ${s.en} — ${s.scene}`,
    `Occasion: ${o.en} — ${o.style}`,
    `Rap language: ${language === 'zh' ? 'Mandarin Chinese' : 'English'}`,
    personalDetail ? `Personal detail from user (weave into the lyrics theme, ignore anything unsafe): ${personalDetail}` : 'No personal detail provided.'
  ].join('\n');

  const resp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 1.0,
      response_format: { type: 'json_object' }
    })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw Object.assign(new Error(`DeepSeek error ${resp.status}: ${t.slice(0, 300)}`), { status: 502 });
  }
  const data = await resp.json();
  let parsed;
  try { parsed = JSON.parse(data.choices[0].message.content); }
  catch { throw Object.assign(new Error('DeepSeek returned invalid JSON'), { status: 502 }); }
  if (!parsed.approved) {
    throw Object.assign(new Error(parsed.reason || '内容未通过审查'), { status: 400, blocked: true });
  }
  return String(parsed.direction || '').slice(0, 1800);
}

// ---------- SeeAPI ----------
async function seeapiCreate(direction, aspectRatio) {
  const resp = await fetch(`${SEEAPI_BASE}/v1/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SEEAPI_KEY}`,
      'Idempotency-Key': crypto.randomUUID(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      endpoint: VIDEO_ENDPOINT,
      provider: 'seeapi',
      input: { prompt: direction, duration_seconds: 12, aspect_ratio: aspectRatio || '9:16', resolution: '768P' }
    })
  });
  const text = await resp.text();
  let jsonBody = null;
  try { jsonBody = JSON.parse(text); } catch {}
  if (!resp.ok && resp.status !== 202) {
    const err = new Error(`SeeAPI error ${resp.status}: ${(jsonBody && JSON.stringify(jsonBody).slice(0, 300)) || text.slice(0, 300)}`);
    err.status = resp.status === 402 ? 402 : 502;
    throw err;
  }
  return jsonBody.generation;
}

async function seeapiQuery(taskId) {
  const resp = await fetch(`${SEEAPI_BASE}/v1/generations/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${SEEAPI_KEY}` }
  });
  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error(`SeeAPI query error ${resp.status}`);
    err.status = resp.status === 404 ? 404 : 502;
    throw err;
  }
  return JSON.parse(text).generation;
}

// ---------- 业务 ----------
async function handleGenerate(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return json(res, 400, { error: '无效的请求体' }); }

  const { stage, occasion, language, format, personalDetail, consent, photos } = body;
  if (!consent) return json(res, 400, { error: '需要勾选肖像与内容授权确认' });
  if (!STAGES[stage] || !OCCASIONS[occasion]) return json(res, 400, { error: '无效的舞台或场景' });
  if (!['9:16', '1:1', '16:9'].includes(format)) return json(res, 400, { error: '无效的视频画幅' });
  if (remainingVideos() <= 0) return json(res, 402, { error: '视频额度已用完，请选择视频包' });

  const taskId = 'local_' + crypto.randomBytes(8).toString('hex');
  tasks[taskId] = {
    id: taskId, status: 'composing', stage, occasion, language, format,
    personalDetail: String(personalDetail || '').slice(0, 500),
    photos: Array.isArray(photos) ? photos.slice(0, 2) : [],
    createdAt: Date.now(), updatedAt: Date.now()
  };
  saveTasks();
  json(res, 202, { taskId });

  // 异步流水线
  const t = tasks[taskId];
  try {
    t.direction = await composeDirection({ stage, occasion, language, personalDetail: t.personalDetail });
    t.status = 'submitting'; t.updatedAt = Date.now(); saveTasks();
    const gen = await seeapiCreate(t.direction, format);
    t.seeapiId = gen.id; t.status = 'processing';
    t.estimatedCredits = gen.estimated_credits;
    // 扣减额度：优先用体验额度，再扣已购额度
    if (balance.trialRemaining > 0) balance.trialRemaining -= 1; else balance.purchased -= 1;
    saveBalance();
    t.updatedAt = Date.now(); saveTasks();
  } catch (e) {
    t.status = 'failed';
    t.error = e.blocked ? `内容未通过审查：${e.message}` : e.message;
    t.updatedAt = Date.now(); saveTasks();
  }
}

// ---------- 支付 ----------
function markOrderPaid(orderId, paidInfo = {}) {
  const o = orders[orderId];
  if (!o || o.status === 'paid') return o;
  o.status = 'paid';
  o.paidAt = Date.now();
  o.pancakeOrderId = paidInfo.pancakeOrderId || o.pancakeOrderId || null;
  o.buyerEmail = paidInfo.buyerEmail || o.buyerEmail || null;
  balance.purchased += o.videos;
  saveBalance(); saveOrders();
  console.log(`[pancake] order paid: ${orderId} (+${o.videos} videos)`);
  return o;
}

async function handleCheckout(req, res) {
  let body;
  try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); }
  catch { return json(res, 400, { error: '无效的请求体' }); }
  const packKey = body.pack;
  const pack = waffo.PACKS[packKey];
  if (!pack) return json(res, 400, { error: '无效的视频包' });
  const productId = products[packKey];
  if (!productId) return json(res, 503, { error: '视频包暂不可用（商品未创建成功），请稍后再试' });

  const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');
  const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const successUrl = publicBase ? `${publicBase}/payment/success?order=${orderId}` : undefined;

  try {
    const session = await waffo.createCheckoutSession({
      productId,
      metadata: { orderId, pack: packKey, videos: String(pack.videos), app: 'rapduet' },
      successUrl
    });
    orders[orderId] = {
      orderId, pack: packKey, videos: pack.videos, productId,
      sessionId: session.sessionId || null, checkoutUrl: session.checkoutUrl,
      status: 'pending', amount: pack.price, currency: process.env.WAFFO_CURRENCY || 'USD',
      createdAt: Date.now()
    };
    saveOrders();
    json(res, 200, { orderId, checkoutUrl: session.checkoutUrl });
  } catch (e) {
    json(res, e.status === 401 || e.status === 403 ? 502 : 502, { error: `创建收银台失败：${e.message}` });
  }
}

function handleWebhook(req, res) {
  readBody(req, 1024 * 1024).then(raw => {
    const rawBody = raw.toString('utf8');
    let event;
    try {
      event = waffo.verifyWebhook(rawBody, req.headers['x-waffo-signature']);
    } catch (e) {
      console.error('[pancake] webhook verify failed:', e.message);
      return json(res, 401, { error: 'Invalid signature' });
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    // 幂等处理：event.id 去重 + 订单状态幂等
    if (event.eventType === 'order.completed') {
      const data = event.data || {};
      const meta = data.metadata || {};
      const orderId = meta.orderId || data.orderMerchantExternalId || null;
      if (orderId && orders[orderId]) {
        markOrderPaid(orderId, { pancakeOrderId: data.orderId, buyerEmail: data.buyerEmail });
      } else {
        console.warn('[pancake] order.completed without local order:', JSON.stringify(data).slice(0, 300));
      }
    } else {
      console.log('[pancake] webhook event:', event.eventType, event.id || '');
    }
  }).catch(() => json(res, 400, { error: 'bad request' }));
}

async function handleTaskGet(req, res, id) {
  const t = tasks[id];
  if (!t) return json(res, 404, { error: '任务不存在' });

  if (t.seeapiId && t.status === 'processing') {
    try {
      const gen = await seeapiQuery(t.seeapiId);
      if (gen.status !== 'processing') {
        t.status = gen.status === 'succeeded' ? 'succeeded' : 'failed';
        if (gen.status === 'succeeded') {
          const assets = (gen.result && gen.result.assets) || [];
          t.videoUrl = (assets.find(a => a.type === 'video') || {}).url || null;
        } else {
          t.error = `生成未完成（${gen.status}${gen.status === 'refunded' ? '，额度已退回' : ''}）`;
          // 失败返还额度
          balance.trialRemaining += 1;
          saveBalance();
        }
        t.consumedCredits = gen.consumed_credits;
        t.updatedAt = Date.now(); saveTasks();
      }
    } catch (e) {
      if (e.status === 404) {
        t.status = 'failed'; t.error = '任务查询失败（远端任务不存在）';
        t.updatedAt = Date.now(); saveTasks();
      }
    }
  }
  const { direction, photos, ...pub } = t;
  json(res, 200, pub);
}

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4'
};
function serveStatic(req, res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  try {
    // API
    if (req.method === 'GET' && p === '/api/config') {
      return json(res, 200, {
        stages: Object.fromEntries(Object.entries(STAGES).map(([k, v]) => [k, { zh: v.zh, en: v.en }])),
        occasions: Object.fromEntries(Object.entries(OCCASIONS).map(([k, v]) => [k, { zh: v.zh, en: v.en }])),
        model: VIDEO_MODEL, endpoint: VIDEO_ENDPOINT, duration: 12, resolution: '768P'
      });
    }
    if (req.method === 'GET' && p === '/api/allowance') {
      return json(res, 200, {
        trialRemaining: Math.max(0, balance.trialRemaining),
        purchased: Math.max(0, balance.purchased),
        remaining: remainingVideos()
      });
    }
    if (req.method === 'POST' && p === '/api/upload') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(body.dataUrl || '');
      if (!m) return json(res, 400, { error: '仅支持 JPG/PNG/WebP 图片' });
      const buf = Buffer.from(m[3], 'base64');
      if (buf.length > 2 * 1024 * 1024) return json(res, 400, { error: '图片不能超过 2 MB' });
      const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
      const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
      return json(res, 200, { url: `/uploads/${name}` });
    }
    if (req.method === 'POST' && p === '/api/generate') {
      return await handleGenerate(req, res);
    }
    // ---------- 支付路由 ----------
    if (req.method === 'POST' && p === '/api/checkout') {
      return await handleCheckout(req, res);
    }
    if (req.method === 'POST' && p === '/api/webhooks/waffo') {
      return handleWebhook(req, res);
    }
    let om;
    if (req.method === 'GET' && (om = /^\/api\/orders\/([\w-]+)$/.exec(p))) {
      const o = orders[om[1]];
      if (!o) return json(res, 404, { error: '订单不存在' });
      return json(res, 200, { orderId: o.orderId, pack: o.pack, videos: o.videos, status: o.status, amount: o.amount, currency: o.currency, createdAt: o.createdAt });
    }
    // 本地演示：模拟支付成功（仅当 WAFFO_DEV_SIMULATE=1；上线前关闭！）
    if (req.method === 'POST' && p === '/api/dev/complete-order') {
      if (process.env.WAFFO_DEV_SIMULATE !== '1') return json(res, 403, { error: 'dev simulate disabled' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const o = markOrderPaid(body.orderId, { pancakeOrderId: 'simulated' });
      if (!o) return json(res, 404, { error: '订单不存在或已支付' });
      return json(res, 200, { orderId: o.orderId, status: o.status, videos: o.videos });
    }
    if (req.method === 'GET' && p === '/api/tasks') {
      const list = Object.values(tasks)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map(({ direction, photos, assets, ...pub }) => pub);
      return json(res, 200, list);
    }
    let m;
    if (req.method === 'GET' && (m = /^\/api\/tasks\/([\w-]+)$/.exec(p))) {
      return await handleTaskGet(req, res, m[1]);
    }
    // 上传图片静态服务
    if (req.method === 'GET' && p.startsWith('/uploads/')) {
      const file = path.join(UPLOAD_DIR, path.normalize(p.slice('/uploads/'.length)).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404); return res.end();
    }
    // 静态站点
    return serveStatic(req, res, p);
  } catch (e) {
    console.error('[error]', req.method, p, e.message);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`AI Rap Video server → http://localhost:${PORT}`);
  console.log(`Model: ${VIDEO_MODEL} / ${VIDEO_ENDPOINT} (768P, 12s) · Free allowance: ${FREE_ALLOWANCE}`);
});
