/**
 * Admin API — everything the single-page panel needs, nothing more.
 *
 *   POST /login  /logout
 *   GET  /data            stats + orders + users (one round trip per filter change)
 *   GET  /order/:id       full order: lyrics, photo URLs, error
 *   GET  /photo/:id/:n    the uploaded performer photo (private files)
 *   POST /order/:id/retry re-queue a failed or stuck-paid order
 *   POST /order/:id/status mark refunded / failed by hand
 *   POST /user/:id/grant  give N free videos of a pack
 *   POST /user/:id/ban    suspend / unsuspend
 *   POST /user/:id/delete remove the account (orders are kept as financial records)
 *
 * queueJob is injected so this file never imports server.js.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import * as users from './users.js';
import { PACK_META, creditUsd } from './packs.js';
import { requireAdmin, isAdmin, checkToken, setAdminCookie, clearAdminCookie, adminHint } from './admin.js';

const UPLOADS = path.join(import.meta.dirname, '..', 'data', 'uploads');
const PAID = ['paid', 'running', 'done'];

function priceOf(o) {
  if (o.free) return 0;
  if (typeof o.priceUsd === 'number') return o.priceUsd;
  return PACK_META[o.pack]?.amount ?? 0;
}

function adminOrderView(o) {
  const credits = Number(o.credits || 0);
  return {
    id: o.id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt ?? null,
    status: o.status,
    step: o.step ?? null,
    error: o.error ?? null,
    userId: o.userId ?? null,
    email: o.userEmail ?? o.buyerEmail ?? null,
    topic: o.topic ?? null,
    mode: o.mode ?? null,
    beat: o.beat ?? null,
    pack: o.pack ?? null,
    priceUsd: priceOf(o),
    free: !!o.free,
    credits: o.credits ?? null,
    costUsd: credits ? Number((credits * creditUsd()).toFixed(2)) : null,
    videoUrl: o.videoFile ? '/videos/' + o.videoFile : null,
    photoCount: Array.isArray(o.photos) ? o.photos.length : 0,
    photosAlive: Array.isArray(o.photos) && o.photos.length > 0 && o.photos.every((p) => fs.existsSync(p)),
    waffoOrderId: o.waffoOrderId ?? null,
    retries: o.retries ?? 0,
  };
}

export function adminRouter({ queueJob, getQueue }) {
  const r = express.Router();
  const json = express.json({ limit: '32kb' });

  /* ---------------- gate ---------------- */

  const attempts = new Map();   // ip -> [ts]

  r.post('/login', json, (req, res) => {
    const ip = req.ip;
    const now = Date.now();
    const hits = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (hits.length >= 6) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Wait 10 minutes.' });
    }
    const submitted = String(req.body?.token || '').trim();
    if (!submitted || !checkToken(submitted)) {
      hits.push(now);
      attempts.set(ip, hits);
      return res.status(401).json({ ok: false, error: 'Wrong admin key.' });
    }
    attempts.delete(ip);
    setAdminCookie(res);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    clearAdminCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!isAdmin(req)) return res.json({ ok: true, admin: false });
    res.json({ ok: true, admin: true, key: adminHint(), env: process.env.WAFFO_ENV || 'test' });
  });

  /* ---------------- the one big read ---------------- */

  r.get('/data', requireAdmin, (req, res) => {
    const status = String(req.query.status || 'all');
    const q = String(req.query.q || '').trim().toLowerCase();
    const all = store.allOrders();

    const byStatus = {};
    let gross = 0;
    let cost = 0;
    let credits = 0;
    for (const o of all) {
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      if (PAID.includes(o.status)) gross += priceOf(o);
      if (o.credits) { credits += Number(o.credits); cost += Number(o.credits) * creditUsd(); }
    }

    const perUser = new Map();
    for (const o of all) {
      if (!o.userId) continue;
      const a = perUser.get(o.userId) || { orders: 0, spend: 0, last: null };
      a.orders += 1;
      if (PAID.includes(o.status)) a.spend += priceOf(o);
      if (!a.last || String(o.createdAt) > String(a.last)) a.last = o.createdAt;
      perUser.set(o.userId, a);
    }

    const userRows = users.listUsers().map((u) => {
      const a = perUser.get(u.id) || { orders: 0, spend: 0, last: null };
      const c = u.credits || {};
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        avatar: u.avatar ?? null,
        provider: u.provider ?? 'password',
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt ?? null,
        banned: !!u.banned,
        orders: a.orders,
        spend: Number(a.spend.toFixed(2)),
        lastOrderAt: a.last,
        credits: { single: c.single || 0, '3pack': c['3pack'] || 0, '5pack': c['5pack'] || 0 },
      };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    let rows = all;
    if (status === 'active') rows = rows.filter((o) => o.status === 'paid' || o.status === 'running');
    else if (status === 'problem') rows = rows.filter((o) => o.status === 'failed');
    else if (status !== 'all') rows = rows.filter((o) => o.status === status);

    if (q) {
      rows = rows.filter((o) =>
        String(o.id).toLowerCase().includes(q) ||
        String(o.userEmail ?? '').toLowerCase().includes(q) ||
        String(o.buyerEmail ?? '').toLowerCase().includes(q) ||
        String(o.topic ?? '').toLowerCase().includes(q));
    }

    rows = rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const today = new Date().toISOString().slice(0, 10);

    res.json({
      ok: true,
      stats: {
        orders: { total: all.length, byStatus },
        revenue: Number(gross.toFixed(2)),
        cost: Number(cost.toFixed(2)),
        credits,
        margin: Number((gross - cost).toFixed(2)),
        marginPct: gross > 0 ? Math.round(((gross - cost) / gross) * 100) : 0,
        users: {
          total: userRows.length,
          buyers: userRows.filter((u) => u.orders > 0).length,
          banned: userRows.filter((u) => u.banned).length,
          newToday: userRows.filter((u) => String(u.createdAt).startsWith(today)).length,
        },
        queue: getQueue ? getQueue() : null,
      },
      orders: rows.slice(0, 400).map(adminOrderView),
      truncated: rows.length > 400,
      shown: Math.min(rows.length, 400),
      matched: rows.length,
      users: userRows,
    });
  });

  /* ---------------- one order, in full ---------------- */

  r.get('/order/:id', requireAdmin, (req, res) => {
    const o = store.getOrder(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Order not found.' });
    res.json({
      ok: true,
      order: {
        ...adminOrderView(o),
        lyrics: Array.isArray(o.lyrics) ? o.lyrics : null,
        photoUrls: (o.photos || []).map((_, i) => `/api/admin/photo/${o.id}/${i}`),
        offset: o.offset ?? null,
        sessionId: o.sessionId ?? null,
        failedAt: o.failedAt ?? null,
        retriedAt: o.retriedAt ?? null,
      },
    });
  });

  r.get('/photo/:id/:n', requireAdmin, (req, res) => {
    const o = store.getOrder(req.params.id);
    const p = o?.photos?.[Number(req.params.n)];
    if (!p || !fs.existsSync(p)) return res.status(404).end();
    if (!path.resolve(p).startsWith(path.resolve(UPLOADS))) return res.status(403).end();
    res.sendFile(path.resolve(p));
  });

  /* ---------------- order actions ---------------- */

  r.post('/order/:id/retry', requireAdmin, (req, res) => {
    const o = store.getOrder(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Order not found.' });
    if (!['failed', 'paid'].includes(o.status)) {
      return res.status(400).json({ ok: false, error: `A ${o.status} order cannot be re-run.` });
    }
    const photos = Array.isArray(o.photos) ? o.photos : [];
    if (!photos.length || !photos.every((p) => fs.existsSync(p))) {
      return res.status(400).json({ ok: false, error: 'The performer photo was cleaned up after 7 days. Ask the customer to submit again.' });
    }
    store.updateOrder(o.id, {
      status: 'paid', error: null, step: null,
      retriedAt: new Date().toISOString(),
      retries: Number(o.retries || 0) + 1,
    });
    queueJob(o.id);
    res.json({ ok: true, queued: true });
  });

  r.post('/order/:id/status', requireAdmin, json, (req, res) => {
    const next = String(req.body?.status || '');
    if (!['refunded', 'failed'].includes(next)) {
      return res.status(400).json({ ok: false, error: 'Only refunded or failed can be set by hand.' });
    }
    const o = store.getOrder(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Order not found.' });
    store.updateOrder(o.id, {
      status: next,
      markedByAdminAt: new Date().toISOString(),
      error: next === 'failed' ? (o.error || 'Marked failed by admin') : o.error,
    });
    res.json({ ok: true });
  });

  /* ---------------- user actions ---------------- */

  r.post('/user/:id/grant', requireAdmin, json, (req, res) => {
    const pack = String(req.body?.pack || 'single');
    const count = Math.min(10, Math.max(1, Number(req.body?.count || 1)));
    if (!PACK_META[pack]) return res.status(400).json({ ok: false, error: 'Unknown pack.' });
    const u = users.getById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'User not found.' });
    const credits = users.addCredits(u.id, pack, count);
    res.json({ ok: true, credits });
  });

  r.post('/user/:id/ban', requireAdmin, json, (req, res) => {
    const banned = Boolean(req.body?.banned);
    const u = users.updateUser(req.params.id, { banned });
    if (!u) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (banned) users.destroyUserSessions(u.id);
    res.json({ ok: true, banned });
  });

  r.post('/user/:id/delete', requireAdmin, json, (req, res) => {
    const u = users.getById(req.params.id);
    if (!u) return res.status(404).json({ ok: false, error: 'User not found.' });
    // typing the email is the confirmation — no accidental clicks
    if (String(req.body?.confirm || '').trim().toLowerCase() !== u.email) {
      return res.status(400).json({ ok: false, error: 'Type the account email to confirm.' });
    }
    users.deleteUser(u.id);
    res.json({ ok: true });
  });

  return r;
}
