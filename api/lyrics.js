/**
 * Vercel Serverless function: POST /api/lyrics
 * Free lyrics preview (DeepSeek). Same prompt/parsing as lib/pipeline.js writeLyrics
 * so users see identical results locally and on Vercel.
 *
 * The full generation pipeline (music + lip-sync, 4–5 min, persistent storage)
 * cannot run on Vercel serverless — it needs a long-running host (Railway/Render/VPS).
 */

/* per-instance rate-limit store (module scope survives warm invocations) */
const rateHits = new Map();

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: 'Use POST.' }));
  }

  /* ---- body ---- */
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { /* treated as empty */ }

  const topic = String(body.topic || '').trim().slice(0, 300);
  if (topic.length < 3) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok: false, error: 'topic too short' }));
  }

  /* ---- rate limit: 10/hour per IP (best effort, per serverless instance) ---- */
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (hits.length >= 10) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ ok: false, error: 'Too many attempts. Try again later.' }));
  }
  hits.push(now);
  rateHits.set(ip, hits);

  /* ---- engine ---- */
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || '';
  if (!key) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ ok: false, error: 'Lyrics engine is not configured yet. Add OPENAI_API_KEY in Vercel env vars.' }));
  }
  const base = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = process.env.OPENAI_MODEL || 'deepseek-chat';
  const mode = body.mode === 'duo' ? 'duo' : 'solo';

  const system = [
    'You write short, clean rap verses.',
    mode === 'duo' ? 'Write for TWO performers trading bars.' : 'Write for a solo performer.',
    'Rules: exactly 6 lines. No profanity, no slurs, no real public figures,',
    'no brands, no violence, nothing sexual. Keep every line under 60 characters.',
    'Each line must rhyme with its pair.',
    'Reply with the 6 lines only, one per line, no numbering, no labels, no quotes.',
  ].join(' ');

  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Write a rap about this: ${topic}` },
        ],
      }),
    });
    if (!upstream.ok) throw new Error(`lyrics API ${upstream.status}`);
    const data = await upstream.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    const lines = text.split('\n').map((l) => l.replace(/^[\d]+[.)\s]*/, '').trim()).filter(Boolean);
    if (lines.length < 4) throw new Error('lyrics came back malformed');
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, lines: lines.slice(0, 6) }));
  } catch (e) {
    console.error('lyrics failed:', e && e.message);
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, error: 'lyrics engine unavailable' }));
  }
}
