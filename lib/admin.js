/**
 * Admin gate — one shared key, one signed cookie, no user table involvement.
 *
 * The key comes from ADMIN_TOKEN in .env. If you never set one, a random key is
 * generated into data/.admin-token on first boot and printed to the console.
 * The cookie is an HMAC over its own expiry, so nothing is stored server-side
 * and a copied cookie still dies after 12 hours.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCookies } from './auth.js';

const COOKIE = 'rv_admin';
const TTL_MS = 12 * 3600 * 1000;
const TOKEN_FILE = path.join(import.meta.dirname, '..', 'data', '.admin-token');

let cached = null;

export function adminToken() {
  if (cached) return cached;
  const env = (process.env.ADMIN_TOKEN || '').trim();
  if (env.length >= 8) { cached = env; return cached; }

  try {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) { cached = t; return cached; }
  } catch { /* first boot */ }

  cached = crypto.randomBytes(18).toString('base64url');
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, cached, { mode: 0o600 });
  return cached;
}

function hmac(payload) {
  const secret = process.env.SESSION_SECRET || adminToken();
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Compare through a digest so length differences cannot be timed. */
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function checkToken(submitted) {
  return safeEq(submitted, adminToken());
}

function secureFlag() {
  return process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';
}

export function setAdminCookie(res) {
  const exp = String(Date.now() + TTL_MS);
  const bits = [`${COOKIE}=${exp}.${hmac(exp)}`, 'Path=/', 'SameSite=Strict', 'HttpOnly', `Max-Age=${TTL_MS / 1000}`];
  if (secureFlag()) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

export function clearAdminCookie(res) {
  const bits = [`${COOKIE}=`, 'Path=/', 'SameSite=Strict', 'HttpOnly', 'Max-Age=0'];
  if (secureFlag()) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

export function isAdmin(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return false;
  const i = raw.lastIndexOf('.');
  if (i < 0) return false;
  const exp = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  if (!/^\d{8,}$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEq(mac, hmac(exp));
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'Admin sign-in required.' });
  next();
}

/** Which key is live, without ever printing it. */
export function adminHint() {
  const t = adminToken();
  return {
    source: process.env.ADMIN_TOKEN ? 'ADMIN_TOKEN (.env)' : 'data/.admin-token (auto-generated)',
    tail: t.slice(-4),
  };
}
