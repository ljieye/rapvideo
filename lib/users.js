/**
 * User + session store — same JSON-file pattern as the order store.
 *
 * Deliberately boring: no ORM, no migrations. Two maps in one file,
 * atomic writes, and swap for SQLite/D1 when the file gets slow.
 *
 *   users:    u_xxx -> { id, email, name, avatar, provider, passwordHash, ... }
 *   sessions: sha256(token) -> { userId, createdAt, expiresAt }
 *
 * Only the hash of a session token is stored, so a leaked data file
 * cannot be replayed as a live login.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(import.meta.dirname, '..', 'data', 'users.json');
let db = { users: {}, sessions: {} };
let saveTimer = null;

export function init() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      db = { users: parsed.users || {}, sessions: parsed.sessions || {} };
    } catch {
      // corrupt file: keep a copy so nothing is silently lost
      try { fs.copyFileSync(FILE, FILE + '.broken-' + Date.now()); } catch {}
    }
  }
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, FILE);
  }, 200);
}

/* ---------------- users ---------------- */

export function newUserId() {
  return 'u_' + crypto.randomBytes(9).toString('base64url');
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function findByEmail(email) {
  const e = normEmail(email);
  return Object.values(db.users).find((u) => u.email === e) ?? null;
}

export function getById(id) {
  return db.users[id] ?? null;
}

export function findByGoogleId(googleId) {
  return Object.values(db.users).find((u) => u.googleId === googleId) ?? null;
}

export function createUser({ email, name, avatar = null, provider = 'password', passwordHash = null, googleId = null }) {
  const user = {
    id: newUserId(),
    email: normEmail(email),
    name: name || normEmail(email).split('@')[0],
    avatar,
    provider,
    passwordHash,
    googleId,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  db.users[user.id] = user;
  persist();
  return user;
}

export function updateUser(id, patch) {
  const u = db.users[id];
  if (!u) return null;
  Object.assign(u, patch, { updatedAt: new Date().toISOString() });
  persist();
  return u;
}

/** Shape safe to send to the browser. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, avatar: u.avatar,
    provider: u.provider, createdAt: u.createdAt,
    credits: creditsOf(u),
    freeCredits: Object.values(creditsOf(u)).reduce((a, b) => a + b, 0),
  };
}

/* ---------------- free credits (admin comps, failure make-goods) ----------------
 * A credit is "one video of this pack, already paid for". /api/draft spends it
 * before it ever asks Waffo for a checkout URL.
 */

const PACKS = ['single', '3pack', '5pack'];

function creditsOf(u) {
  const c = u?.credits || {};
  const out = {};
  for (const p of PACKS) out[p] = Math.max(0, Number(c[p] || 0));
  return out;
}

export function addCredits(userId, pack, count = 1) {
  const u = db.users[userId];
  if (!u) return null;
  const c = creditsOf(u);
  c[pack] = Math.max(0, c[pack] + Number(count || 0));
  u.credits = c;
  u.updatedAt = new Date().toISOString();
  persist();
  return c;
}

/** Returns true if a credit was available and has now been spent. */
export function consumeCredit(userId, pack) {
  const u = db.users[userId];
  if (!u) return false;
  const c = creditsOf(u);
  if (c[pack] <= 0) return false;
  c[pack] -= 1;
  u.credits = c;
  u.updatedAt = new Date().toISOString();
  persist();
  return true;
}

export function listUsers() {
  return Object.values(db.users);
}

export function deleteUser(userId) {
  if (!db.users[userId]) return false;
  delete db.users[userId];
  for (const [k, s] of Object.entries(db.sessions)) {
    if (s.userId === userId) delete db.sessions[k];
  }
  persist();
  return true;
}

/* ---------------- sessions ---------------- */

const SESSION_DAYS = 30;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.sessions[hashToken(token)] = {
    userId,
    createdAt: now,
    expiresAt: now + SESSION_DAYS * 24 * 3600 * 1000,
  };
  persist();
  return token;
}

export function userByToken(token) {
  if (!token) return null;
  const key = hashToken(token);
  const s = db.sessions[key];
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    delete db.sessions[key];
    persist();
    return null;
  }
  return db.users[s.userId] ?? null;
}

export function destroySession(token) {
  if (!token) return;
  const key = hashToken(token);
  if (db.sessions[key]) {
    delete db.sessions[key];
    persist();
  }
}

export function destroyUserSessions(userId) {
  for (const [k, s] of Object.entries(db.sessions)) {
    if (s.userId === userId) delete db.sessions[k];
  }
  persist();
}

/** Drop expired sessions once a day so the file does not grow forever. */
export function pruneSessions() {
  const now = Date.now();
  let removed = 0;
  for (const [k, s] of Object.entries(db.sessions)) {
    if (s.expiresAt < now) { delete db.sessions[k]; removed++; }
  }
  if (removed) persist();
  return removed;
}
