/**
 * The generation pipeline — ported from pipeline-test/run.mjs, where every
 * step was verified against the live APIs on 2026-10-25.
 *
 *   lyrics  DeepSeek      ~2s      ~$0.001
 *   music   SeeAPI ai-music  ~40s   16 credits (~$0.06)
 *   video   SeeAPI seedance-2 reference-to-video, 480p 9:16
 *                                  ~390 credits (~$1.44) for 15s
 *
 * Files must be reachable at public HTTPS URLs for SeeAPI. The MVP uses the
 * uguu.se throwaway host (files survive a few hours — the pipeline finishes
 * in minutes). Swap `uploadPublic()` for R2/S3 signed URLs in production.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

export const cfg = {
  openaiKey: '', openaiBase: '', openaiModel: '',
  seeapiKey: '', seeapiModel: '', seeapiEndpoint: '',
  seeapiMusicModel: '', seeapiResolution: '', seeapiCreditUsd: 0.0037,
};

/** server.js calls this AFTER loading .env (imports run before top-level code). */
export function refreshCfg() {
  cfg.openaiKey = process.env.OPENAI_API_KEY || '';
  cfg.openaiBase = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  cfg.openaiModel = process.env.OPENAI_MODEL || 'deepseek-chat';
  cfg.seeapiKey = process.env.SEEAPI_API_KEY || '';
  cfg.seeapiModel = process.env.SEEAPI_MODEL || 'seedance-2';
  cfg.seeapiEndpoint = process.env.SEEAPI_ENDPOINT || 'reference-to-video';
  cfg.seeapiMusicModel = process.env.SEEAPI_MUSIC_MODEL || 'ai-music-m1';
  cfg.seeapiResolution = process.env.SEEAPI_RESOLUTION || '480p';
  cfg.seeapiCreditUsd = Number(process.env.SEEAPI_CREDIT_USD || 0.0037);
}

import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);

/* ---------------- lyrics (DeepSeek) ---------------- */
export async function writeLyrics(topic, mode) {
  const system = [
    'You write short, clean rap verses.',
    mode === 'duo' ? 'Write for TWO performers trading bars.' : 'Write for a solo performer.',
    'Rules: exactly 6 lines. No profanity, no slurs, no real public figures,',
    'no brands, no violence, nothing sexual. Keep every line under 60 characters.',
    'Each line must rhyme with its pair.',
    'Reply with the 6 lines only, one per line, no numbering, no labels, no quotes.',
  ].join(' ');

  const res = await fetch(`${cfg.openaiBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.openaiModel,
      temperature: 0.9,
      max_tokens: 300,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Write a rap about this: ${topic}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`lyrics API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const lines = text.split('\n').map((l) => l.replace(/^[\d]+[.)\s]*/, '').trim()).filter(Boolean);
  if (lines.length < 4) throw new Error('lyrics came back malformed');
  return lines.slice(0, 6);
}

/* ---------------- SeeAPI helpers ---------------- */
async function seeapiCreate(body) {
  const r = await fetch('https://api.seeapi.com/v1/generations', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.seeapiKey}`,
      'content-type': 'application/json',
      'idempotency-key': `rapvideo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || JSON.stringify(j).slice(0, 300);
    throw new Error(`SeeAPI ${r.status}: ${msg}`);
  }
  return j.generation ?? j;
}

async function seeapiWait(taskId, deadlineMs = 10 * 60 * 1000) {
  const started = Date.now();
  let delay = 3;
  while (Date.now() - started < deadlineMs) {
    await sleep(delay);
    delay = Math.min(delay * 1.4, 15);
    const r = await fetch(`https://api.seeapi.com/v1/generations/${taskId}`, {
      headers: { authorization: `Bearer ${cfg.seeapiKey}` },
    });
    if (!r.ok) throw new Error(`SeeAPI poll ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const g = (await r.json()).generation ?? {};
    if (g.status === 'succeeded') return g;
    if (['failed', 'canceled', 'expired', 'refunded'].includes(g.status)) {
      throw new Error(`SeeAPI task ${g.status}`);
    }
  }
  throw new Error('SeeAPI timed out after 10 minutes');
}

function pickAsset(g) {
  const list = g.result?.assets ?? g.assets ?? [];
  const arr = Array.isArray(list) ? list : Object.values(list);
  for (const a of arr) {
    const u = typeof a === 'string' ? a : (a?.url || a?.uri || a?.download_url);
    const type = typeof a === 'string' ? '' : String(a?.type || a?.media_type || '');
    if (u && /^https?:/.test(u) && (/\.mp4|video/i.test(u) || /video/i.test(type))) return u;
  }
  return arr.map((a) => (typeof a === 'string' ? a : a?.url)).find((u) => typeof u === 'string' && /^https?:/.test(u)) ?? null;
}

/* ---------------- throwaway public host ---------------- */
export async function uploadPublic(file) {
  const buf = await fsp.readFile(file);
  const form = new FormData();
  form.append('files[]', new Blob([buf]), path.basename(file));
  const r = await fetch('https://uguu.se/upload', { method: 'POST', body: form });
  const txt = await r.text();
  if (!r.ok) throw new Error(`uguu.se ${r.status}: ${txt.slice(0, 150)}`);
  const j = JSON.parse(txt);
  const url = j?.files?.[0]?.url;
  if (!url) throw new Error('uguu.se returned no URL');
  return url;
}

/* ---------------- music (SeeAPI ai-music) ---------------- */
async function makeSong(lyrics, beat, seconds) {
  const styleMap = {
    bounce: 'upbeat hip hop rap, punchy male vocal, bouncy modern beat, clean radio edit',
    boombap: '90s boom bap hip hop, punchy male vocal, dusty drums, clean radio edit',
    trap: 'dark trap hip hop, punchy male vocal, heavy 808s, clean radio edit',
  };
  const body = {
    model: cfg.seeapiMusicModel,
    endpoint: 'music-generation',
    provider: 'seeapi',
    input: {
      custom_mode: true,
      instrumental: false,
      title: 'RapVideo',
      lyrics: `[Verse]\n${lyrics.join('\n')}`,
      prompt: styleMap[beat] || styleMap.bounce,
      duration_seconds: seconds + 8,   // leave room past the clip window
    },
  };
  const task = await seeapiCreate(body);
  const done = await seeapiWait(task.id, 6 * 60 * 1000);
  const url = done.result?.assets?.[0]?.audio_url;
  if (!url) throw new Error('music task succeeded but no audio_url');
  return { url, credits: Number(done.consumed_credits ?? 0) };
}

/* ---------------- trim (ffmpeg) ---------------- */
export async function trim(src, dest, offset, seconds) {
  const bin = req('@ffmpeg-installer/ffmpeg').path;
  await new Promise((resolve, reject) => {
    const p = spawn(bin, ['-y', '-ss', String(offset), '-i', src, '-t', String(seconds), '-ar', '44100', '-ac', '2', dest], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
  return dest;
}

/* ---------------- video (SeeAPI seedance-2) ---------------- */
async function makeVideo(imageUrl, audioUrl, seconds) {
  const body = {
    model: cfg.seeapiModel,
    endpoint: cfg.seeapiEndpoint,
    provider: 'seeapi',
    input: {
      reference_images: [imageUrl],
      reference_audio: [audioUrl],
      prompt: 'A person performs the song straight to camera, rapping with clear lip movement and natural head motion, handheld concert framing',
      aspect_ratio: '9:16',
      duration_seconds: seconds,
      resolution: cfg.seeapiResolution,
      generate_audio: true,
      nsfw_checker: true,
    },
  };
  const g = await seeapiCreate(body);
  const done = await seeapiWait(g.id);
  const url = pickAsset(done);
  if (!url) throw new Error('video task succeeded but no video URL');
  return { url, credits: Number(done.consumed_credits ?? 0) };
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  await fsp.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

/* ---------------- full order runner ---------------- */
/**
 * Runs one paid order end to end. `order.photos` is an array of local file
 * paths (uploads dir). Updates `progress(step)` as it goes, returns the
 * local mp4 path. Throws on failure — caller marks the order failed.
 */
export async function runOrder(order, progress) {
  const seconds = 15;
  const offset = Number(order.offset ?? 4);          // skip the instrumental intro
  const workDir = path.dirname(order.photos[0]);

  progress('lyrics');
  const lyrics = await writeLyrics(order.topic, order.mode);

  progress('music');
  const song = await makeSong(lyrics, order.beat, seconds);
  const songPath = path.join(workDir, 'song.mp3');
  await download(song.url, songPath);
  const clipPath = path.join(workDir, 'clip.mp3');
  await trim(songPath, clipPath, offset, seconds);
  const clipUrl = await uploadPublic(clipPath);

  progress('video');
  const photoUrl = await uploadPublic(order.photos[0]);   // solo MVP: first photo
  const video = await makeVideo(photoUrl, clipUrl, seconds);

  const outPath = path.join(workDir, 'final.mp4');
  await download(video.url, outPath);
  return { videoPath: outPath, credits: song.credits + video.credits, lyrics };
}
