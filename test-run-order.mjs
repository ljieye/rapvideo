/**
 * Simulates what the webhook path does: mark an order paid, run the pipeline
 * job, write the video. Used for end-to-end testing without a public webhook URL.
 *
 *   node test-run-order.mjs <orderId>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './lib/store.js';
import { runOrder, refreshCfg } from './lib/pipeline.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
refreshCfg();
store.init();

const id = process.argv[2];
const order = store.getOrder(id);
if (!order) { console.error('order not found:', id); process.exit(1); }

store.updateOrder(id, { status: 'paid', waffoOrderId: 'simulated' });
console.log('order', id, '→ paid, starting pipeline');

try {
  const result = await runOrder(order, (step) => {
    store.updateOrder(id, { status: 'running', step });
    console.log('step →', step);
  });
  const finalPath = path.join(ROOT, 'data', 'videos', `${id}.mp4`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.renameSync(result.videoPath, finalPath);
  store.updateOrder(id, { status: 'done', step: null, videoFile: `${id}.mp4`, credits: result.credits });
  console.log('DONE — video at', finalPath, `(${result.credits} credits)`);
} catch (e) {
  console.error('FAILED:', e.message);
  store.updateOrder(id, { status: 'failed', error: e.message.slice(0, 200) });
  process.exit(1);
}
