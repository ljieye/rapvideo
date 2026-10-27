/**
 * Auth helpers: password hashing, session cookies, Google OAuth.
 *
 * No passport, no express-session — the whole flow is ~120 lines and you
 * can read every line. Google is a plain OAuth 2.0 authorization-code flow.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as users from './users.js';

export const SESSION_COOKIE = 'rv_session';
const SESSION_DAYS = 30;

/* ---------------- password hashing (scrypt, built in) ---------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, keyB64] = stored.split('$');
  const salt = Buffer.from(saltB64, 'base64url');
  const expected = Buffer.from(keyB64, 'base64url');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/* ---------------- cookies ---------------- */

export function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieString(name, value, { maxAge, httpOnly = true } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) bits.push('HttpOnly');
  if (typeof maxAge === 'number') bits.push(`Max-Age=${maxAge}`);
  if (process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1') bits.push('Secure');
  return bits.join('; ');
}

export function setSessionCookie(res, token) {
  res.append('Set-Cookie', cookieString(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 24 * 3600 }));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', cookieString(SESSION_COOKIE, '', { maxAge: 0 }));
}

/** Log someone in: new session + cookie. */
export function login(res, user) {
  const token = users.createSession(user.id);
  users.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
  setSessionCookie(res, token);
  return token;
}

export function logout(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) users.destroySession(token);
  clearSessionCookie(res);
}

/** Express middleware — attaches req.user (or null) to every request. */
export function attachUser(req, res, next) {
  const token = parseCookies(req)[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = token ? users.userByToken(token) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Please sign in first.' });
  if (req.user.banned) return res.status(403).json({ ok: false, error: 'This account is suspended.' });
  next();
}

/* ---------------- Google OAuth ---------------- */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';

export function googleConfig(baseUrl) {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/auth/google/callback`,
  };
}

export function googleEnabled(baseUrl) {
  const c = googleConfig(baseUrl);
  return Boolean(c.clientId && c.clientSecret);
}

/** CSRF state = random nonce + HMAC, so we can verify it without storage. */
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(import.meta.dirname, '..', 'data', '.session-secret');
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

export function makeState() {
  const nonce = crypto.randomBytes(12).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

export function verifyState(state) {
  if (!state || !state.includes('.')) return false;
  const [nonce, mac] = state.split('.');
  const expected = sign(nonce);
  if (mac.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function googleAuthUrl(baseUrl, state) {
  const c = googleConfig(baseUrl);
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH}?${q.toString()}`;
}

export async function exchangeGoogleCode(baseUrl, code) {
  const c = googleConfig(baseUrl);
  const body = new URLSearchParams({
    code,
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: c.redirectUri,
    grant_type: 'authorization_code',
  });
  const r = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`google token exchange failed: ${j.error || r.status} ${j.error_description || ''}`);
  return j.access_token;
}

export async function googleProfile(accessToken) {
  const r = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`google userinfo failed: ${j.error?.message || r.status}`);
  if (!j.email) throw new Error('google account returned no email');
  return { googleId: j.id, email: j.email, name: j.name || j.email.split('@')[0], avatar: j.picture || null };
}

/** Find-or-create the user behind a Google profile. */
export function upsertGoogleUser(profile) {
  let user = users.findByGoogleId(profile.googleId) || users.findByEmail(profile.email);
  if (user) {
    return users.updateUser(user.id, {
      googleId: profile.googleId,
      avatar: profile.avatar || user.avatar,
      name: user.name || profile.name,
      lastLoginAt: new Date().toISOString(),
    });
  }
  return users.createUser({
    email: profile.email,
    name: profile.name,
    avatar: profile.avatar,
    provider: 'google',
    googleId: profile.googleId,
  });
}
