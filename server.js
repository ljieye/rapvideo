/**
 * RapVideo — single Node server. No framework magic beyond express.
 *
 *   npm install && node server.js      →  http://localhost:3000
 *
 * Flow (payment FIRST, generation second — the business never fronts API cost):
 *   1. POST /api/lyrics          free preview, rate-limited by IP
 *   2. POST /api/draft           photo + topic → order + Waffo checkoutUrl
 *   3. buyer pays on Waffo
 *   4. POST /api/webhooks/waffo  signature-verified → marks paid → queues job
 *   5. worker runs the pipeline  lyrics → music → lip-sync → mp4
 *   6. GET  /api/order/:id       progress page polls this
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WaffoPancake, verifyWebhook, WebhookEventType } from '@waffo/pancake-ts';

import * as store from './lib/store.js';
import * as users from './lib/users.js';
import { PACK_META } from './lib/packs.js';
import { adminRouter } from './lib/adminApi.js';
import { adminToken, adminHint } from './lib/admin.js';
import {
  attachUser, requireUser, login, logout, parseCookies,
  hashPassword, verifyPassword,
  googleEnabled, googleAuthUrl, exchangeGoogleCode, googleProfile, upsertGoogleUser,
  makeState, verifyState,
} from './lib/auth.js';
import { runOrder, writeLyrics, refreshCfg } from './lib/pipeline.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const VIDEOS = path.join(DATA, 'videos');
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

// load .env (no dependency) — .env wins over inherited shell vars
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

for (const d of [DATA, UPLOADS, VIDEOS]) fs.mkdirSync(d, { recursive: true });
store.init();
users.init();
users.pruneSessions();
refreshCfg();

/* ---------------- Waffo client ---------------- */
let WAFFO_KEY = process.env.WAFFO_PRIVATE_KEY || '';
if (WAFFO_KEY && !WAFFO_KEY.includes('-----BEGIN')) {
  const body = WAFFO_KEY.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n').trim();
  WAFFO_KEY = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}
const waffo = new WaffoPancake({ merchantId: process.env.WAFFO_MERCHANT_ID, privateKey: WAFFO_KEY });

const PRODUCTS = {
  single: process.env.WAFFO_PRODUCT_SINGLE,
  '3pack': process.env.WAFFO_PRODUCT_3PACK,
  '5pack': process.env.WAFFO_PRODUCT_5PACK,
};

/* ---------------- app ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public')));
app.use('/videos', express.static(VIDEOS, { maxAge: '7d' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(f.mimetype)),
});

/* ---------------- accounts ---------------- */
app.use(attachUser);

/* ---------------- admin panel (token-gated, separate from customer accounts) ---------------- */
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.use('/api/admin', adminRouter({
  queueJob,
  getQueue: () => ({ running, queued: queue.length }),
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

app.get('/api/auth/me', (req, res) => {
  res.json({
    ok: true,
    user: users.publicUser(req.user),
    googleEnabled: googleEnabled(BASE_URL),
  });
});

app.post('/api/auth/register', express.json(), (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 60);

    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
    if (users.findByEmail(email)) return res.status(409).json({ ok: false, error: 'That email already has an account. Sign in instead.' });

    const user = users.createUser({ email, name, provider: 'password', passwordHash: hashPassword(password) });
    login(res, user);
    res.json({ ok: true, user: users.publicUser(user) });
  } catch (e) {
    console.error('register failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not create your account. Try again.' });
  }
});

app.post('/api/auth/login', express.json(), (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    const user = users.findByEmail(email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'Wrong email or password.' });
    }
    if (user.banned) return res.status(403).json({ ok: false, error: 'This account is suspended.' });
    login(res, user);
    res.json({ ok: true, user: users.publicUser(user) });
  } catch (e) {
    console.error('login failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not sign you in. Try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  logout(req, res);
  res.json({ ok: true });
});

/* ---- Google OAuth (authorization code flow) ---- */
app.get('/auth/google', (req, res) => {
  if (!googleEnabled(BASE_URL)) {
    return res.redirect('/auth.html?error=google_not_configured');
  }
  const state = makeState();
  // state lives in a short-lived cookie so the callback can prove it started here
  res.append('Set-Cookie', `rv_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
  res.redirect(googleAuthUrl(BASE_URL, state));
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/auth.html?error=' + encodeURIComponent(String(error)));
    if (!code) return res.redirect('/auth.html?error=missing_code');

    const cookieState = parseCookies(req).rv_oauth_state;
    if (!state || !cookieState || state !== cookieState || !verifyState(String(state))) {
      return res.redirect('/auth.html?error=bad_state');
    }
    res.append('Set-Cookie', 'rv_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

    const accessToken = await exchangeGoogleCode(BASE_URL, String(code));
    const profile = await googleProfile(accessToken);
    const user = upsertGoogleUser(profile);
    if (user.banned) return res.redirect('/auth.html?error=suspended');
    login(res, user);
    res.redirect('/?welcome=1');
  } catch (e) {
    console.error('google auth failed:', e.message);
    res.redirect('/auth.html?error=google_failed');
  }
});

/* ---- the signed-in user's own videos ---- */
app.get('/api/my/orders', requireUser, (req, res) => {
  const mine = store.ordersForUser(req.user.id);
  res.json({ ok: true, orders: mine });
});

/* ---- 1. free lyric preview (rate-limited, cheap: ~$0.001/call) ---- */
const lyricHits = new Map();   // ip → timestamps
app.use('/api/lyrics', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const hits = (lyricHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (hits.length >= 10) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  hits.push(now);
  lyricHits.set(ip, hits);
  next();
});
app.post('/api/lyrics', express.json(), async (req, res) => {
  try {
    const topic = String(req.body?.topic || '').trim().slice(0, 300);
    if (topic.length < 3) return res.status(400).json({ ok: false, error: 'topic too short' });
    const lines = await writeLyrics(topic, req.body?.mode === 'duo' ? 'duo' : 'solo');
    res.json({ ok: true, lines });
  } catch (e) {
    console.error('lyrics failed:', e.message);
    res.status(502).json({ ok: false, error: 'lyrics engine unavailable' });
  }
});

/* ---- 2. draft + checkout ---- */
app.post('/api/draft', requireUser, upload.fields([{ name: 'photos', maxCount: 2 }]), async (req, res) => {
  try {
    const topic = String(req.body.topic || '').trim().slice(0, 300);
    const pack = String(req.body.pack || 'single');
    const mode = String(req.body.mode || 'solo') === 'duo' ? 'duo' : 'solo';
    const beat = ['bounce', 'boombap', 'trap'].includes(req.body.beat) ? req.body.beat : 'bounce';
    const productId = PRODUCTS[pack];

    if (topic.length < 3) return res.status(400).json({ ok: false, error: 'Tell us what the rap is about.' });
    if (!productId) return res.status(400).json({ ok: false, error: 'Unknown pack.' });
    const files = req.files?.photos || [];
    if (!files.length) return res.status(400).json({ ok: false, error: 'A performer photo is required.' });

    const order = store.createOrder({
      topic, mode, beat, pack,
      offset: Number(req.body.offset || 4),
      userId: req.user.id,
      userEmail: req.user.email,
      priceUsd: PACK_META[pack]?.amount ?? 0,
    });
    const dir = path.join(UPLOADS, order.id);
    fs.mkdirSync(dir, { recursive: true });
    const photoPaths = [];
    for (const [i, f] of files.entries()) {
      const ext = f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const p = path.join(dir, `photo${i}.${ext}`);
      fs.writeFileSync(p, f.buffer);
      photoPaths.push(p);
    }
    store.updateOrder(order.id, { photos: photoPaths });

    // A free credit (admin comp, failure make-good) skips Waffo entirely.
    if (users.consumeCredit(req.user.id, pack)) {
      store.updateOrder(order.id, { status: 'paid', free: true, priceUsd: 0, buyerEmail: req.user.email });
      queueJob(order.id);
      return res.json({ ok: true, orderId: order.id, checkoutUrl: null, free: true });
    }

    const session = await waffo.checkout.createSession({
      productId,
      productType: 'onetime',
      currency: 'USD',
      metadata: { orderId: order.id },
      successUrl: `${BASE_URL}/success.html?o=${order.id}`,
    });
    store.updateOrder(order.id, { sessionId: session.sessionId });

    res.json({ ok: true, orderId: order.id, checkoutUrl: session.checkoutUrl });
  } catch (e) {
    console.error('draft failed:', e.message);
    res.status(500).json({ ok: false, error: 'Could not start checkout. Try again.' });
  }
});

/* ---- 4. webhook: the ONLY place an order becomes payable ---- */
app.post('/api/webhooks/waffo', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8');
  const sig = req.headers['x-waffo-signature'] || '';
  let event;
  try {
    event = verifyWebhook(raw, sig);
  } catch {
    return res.status(401).send('Invalid signature');
  }
  if (store.hasEvent(event.id)) return res.status(200).send('OK (duplicate)');
  store.logEvent(event);
  console.log('webhook:', event.eventType);

  if (event.eventType === WebhookEventType.OrderCompleted) {
    const orderId = event.data?.metadata?.orderId;
    const order = orderId && store.getOrder(orderId);
    if (!order) {
      console.error('webhook: order not found for', orderId);
      return res.status(200).send('OK (unknown order)');
    }
    store.updateOrder(order.id, { status: 'paid', waffoOrderId: event.data.orderId, buyerEmail: event.data.buyerEmail ?? null });
    queueJob(order.id);
  } else if (event.eventType === WebhookEventType.RefundSucceeded) {
    console.log('refund settled:', JSON.stringify(event.data));
  }
  res.status(200).send('OK');
});

/* ---- 6. progress polling ---- */
app.get('/api/order/:id', (req, res) => {
  const o = store.getOrder(req.params.id);
  if (!o) return res.status(404).json({ ok: false });
  // orders created after accounts shipped belong to exactly one user
  if (o.userId && (!req.user || req.user.id !== o.userId)) {
    return res.status(403).json({ ok: false, error: 'This order belongs to another account.' });
  }
  res.json({ ok: true, ...store.publicView(o) });
});

/* ---------------- job queue (one at a time — protects the credit balance) ---------------- */
const queue = [];
let running = false;

function queueJob(orderId) {
  queue.push(orderId);
  pump();
}

async function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  running = true;
  const order = store.getOrder(id);
  if (!order || !['paid'].includes(order.status)) { running = false; return pump(); }

  console.log(`job ${id}: start`);
  store.updateOrder(id, { status: 'running', step: 'lyrics' });
  try {
    const result = await runOrder(order, (step) => store.updateOrder(id, { step }));
    const file = path.basename(result.videoPath);
    // name it by order id so /videos/ URLs are stable
    const finalPath = path.join(VIDEOS, `${id}.mp4`);
    fs.renameSync(result.videoPath, finalPath);
    store.updateOrder(id, { status: 'done', step: null, videoFile: `${id}.mp4`, credits: result.credits, lyrics: result.lyrics });
    console.log(`job ${id}: done  (${result.credits} credits)`);
  } catch (e) {
    console.error(`job ${id}: FAILED —`, e.message);
    store.updateOrder(id, { status: 'failed', error: 'Generation failed — we will refund you automatically.', failedAt: new Date().toISOString() });
    // Refund policy (legal-pages/refund.html) promises automatic refunds on failure.
    // MVP: log loudly; wire waffo refunds API here before real traffic.
  }
  running = false;
  pump();
}

/* ---------------- 7-day retention sweep (Privacy Policy commitment) ---------------- */
const SEVEN_DAYS = 7 * 24 * 3600 * 1000;
async function sweep() {
  const cutoff = Date.now() - SEVEN_DAYS;
  for (const dir of [UPLOADS, VIDEOS]) {
    let entries = [];
    try { entries = await fsp.readdir(dir); } catch { continue; }
    for (const name of entries) {
      const p = path.join(dir, name);
      const st = await fsp.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) {
        await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
        console.log('swept (7d):', p);
      }
    }
  }
}
sweep();
setInterval(sweep, 24 * 3600 * 1000);
setInterval(() => users.pruneSessions(), 24 * 3600 * 1000);

app.listen(PORT, () => {
  console.log(`RapVideo on ${BASE_URL}`);
  console.log(`webhook endpoint for Waffo dashboard: ${BASE_URL}/api/webhooks/waffo`);
  console.log(`environment: ${process.env.WAFFO_ENV || 'test'}`);
  console.log(`admin panel: ${BASE_URL}/admin   (key from ${adminHint().source}, ends ····${adminHint().tail})`);
  if (!process.env.ADMIN_TOKEN) console.log(`admin key: ${adminToken()}   ← set ADMIN_TOKEN in .env to choose your own`);
});
