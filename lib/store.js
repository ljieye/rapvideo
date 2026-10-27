/**
 * Order store — a tiny JSON-file database.
 * Good for the first few thousand orders; swap for SQLite/D1 when it hurts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(import.meta.dirname, '..', 'data', 'orders.json');
let db = { orders: {}, events: [] };
let saveTimer = null;

export function init() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (fs.existsSync(FILE)) {
    try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* corrupt file: start clean, keep a backup */ }
  }
}

function persist() {
  // debounce + atomic write so a crash never truncates the file
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, FILE);
  }, 250);
}

export function newId() {
  return 'o_' + crypto.randomBytes(9).toString('base64url');
}

export function createOrder(fields) {
  const id = newId();
  const order = {
    id,
    createdAt: new Date().toISOString(),
    status: 'awaiting_payment',       // awaiting_payment | paid | running | done | failed
    step: null,                        // lyrics | music | video (while running)
    error: null,
    videoFile: null,
    waffoOrderId: null,
    sessionId: null,
    ...fields,
  };
  db.orders[id] = order;
  persist();
  return order;
}

export function getOrder(id) {
  return db.orders[id] ?? null;
}

/** Raw list for the admin panel — includes internal fields publicView hides. */
export function allOrders() {
  return Object.values(db.orders);
}

export function updateOrder(id, patch) {
  const o = db.orders[id];
  if (!o) return null;
  Object.assign(o, patch, { updatedAt: new Date().toISOString() });
  persist();
  return o;
}

export function findByWaffoOrder(waffoOrderId) {
  return Object.values(db.orders).find((o) => o.waffoOrderId === waffoOrderId) ?? null;
}

/** Public shape — never leak internals to the browser. */
export function publicView(o) {
  return {
    id: o.id,
    status: o.status,
    step: o.step,
    error: o.error,
    videoUrl: o.videoFile ? '/videos/' + o.videoFile : null,
    pack: o.pack,
    topic: o.topic ?? null,
    mode: o.mode ?? null,
    beat: o.beat ?? null,
    createdAt: o.createdAt,
  };
}

/** Every order belonging to one user, newest first. */
export function ordersForUser(userId) {
  if (!userId) return [];
  return Object.values(db.orders)
    .filter((o) => o.userId === userId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicView);
}

/** Persist the raw webhook for auditing (Privacy Policy says we keep payment records). */
export function logEvent(event) {
  db.events.push({ id: event.id, type: event.eventType, at: new Date().toISOString() });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);
  persist();
}

export function hasEvent(id) {
  return db.events.some((e) => e.id === id);
}
