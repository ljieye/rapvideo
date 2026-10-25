'use strict';

/* ---------------- state ---------------- */
const state = {
  lang: localStorage.getItem('rd_lang') || 'zh',
  photoMode: 'two',        // two | one
  stage: 'studio',
  occasion: 'duet',
  rapLang: 'zh',
  format: '9:16',
  photos: { slot1: null, slot2: null, slotBoth: null },
  config: null,
  currentTask: null,
  pollTimer: null
};

/* ---------------- i18n ---------------- */
const I18N = {
  en: {
    nav_create: 'Create', nav_styles: 'Styles', nav_how: 'How it works', nav_pricing: 'Packs', nav_faq: 'FAQ',
    hero_title: 'Your photos,<br>an original rap duet',
    hero_sub: 'Upload two portraits or one photo together, pick a stage and an occasion — AI writes the lyrics, sings an original beat, and returns a 12-second shareable rap video. Review likeness, words and lip sync before sharing.',
    hero_cta: 'Create a rap video', hero_cta2: 'Browse styles first',
    hero_note: '↑ Four separately produced showcase scenes · click any card to load its direction',
    gen_title: 'Create your AI rap duet',
    gen_sub: 'Bring two people into an original rap. Choose your photos, stage and occasion — AI handles the rest.',
    gen_photos: 'Your photos', seg_two: 'Two portraits', seg_one: 'One photo together',
    add_photo: 'Add photo', add_together: 'Add photo together', person1: 'Person 1', person2: 'Person 2', both: 'Both performers',
    photo_hint: 'JPG / PNG / WebP · up to 2 MB each · two consenting adults, clear faces, even lighting',
    gen_stage: 'Choose a stage', gen_occasion: 'Choose an occasion', gen_lang: 'Rap language',
    gen_format: 'Format and personal details', fmt_portrait: 'Portrait', fmt_square: 'Square', fmt_landscape: 'Landscape',
    format_hint: '12 seconds · 768P · original AI vocals and music',
    gen_personal: 'Make the rap personal',
    personal_ph: 'Add a name, a story or a line to rap about, e.g. "A rooftop birthday for Alin, where we once sang together"',
    consent: 'Both performers are adults, and I have permission to use their photos to create this AI video.',
    gen_btn: 'Generate rap video',
    gen_privacy: 'Your photos upload only when you generate, and are sent with your creative direction to our AI provider. Review your video before sharing.',
    download: 'Download video',
    styles_title: 'A studio built for two',
    styles_sub: 'Four original direction examples. Click any style to load its creative direction into the generator.',
    style1: 'Studio spotlight', style1_d: 'Close portraits and focused studio light, relaxed shoulders and subtle gestures.',
    style2: 'Wide studio session', style2_d: 'A wide view of the studio, two performers answering each other across the mic.',
    style3: 'Front-row energy', style3_d: 'Street cypher atmosphere, circling camera, the most contagious live energy.',
    style4: 'A birthday double act', style4_d: 'A high-energy rap birthday shout-out with full celebration vibes.',
    use_dir: 'Use this direction →',
    models_title: 'The AI models behind our videos',
    m1: 'Your video · 12s · 768P · native AI audio', m2: 'Creative direction & prompt screening (lyrics)', m3: 'Unified API gateway · model access',
    models_note: 'Before generation, text directions pass DeepSeek screening. Blocked prompts never start generation and never consume allowance. Model: minimax-h3 / text-to-video via SeeAPI.',
    how_title: 'From photos to a personal duet',
    how1_t: 'Add your photos', how1_d: 'Two clear portraits or one photo together. Even lighting, visible eyes and clear faces work best.',
    how2_t: 'Pick a stage, add detail', how2_d: 'Four stages × four occasions, English or Mandarin rap. Add a name or a shared memory to make it yours.',
    how3_t: 'Generate, listen, download', how3_d: 'AI returns a 12-second 768P duet in My works. Review the full video before sharing.',
    works_title: '🎞 My works', works_empty: 'No works yet — generate your first rap video.',
    pricing_title: 'Choose your video pack', pricing_sub: 'One-time payment. No subscription, no auto-renewal. Allowance valid for 365 days.',
    pack_lite: 'Lite', pack_pro: 'Pro', pack_ultra: 'Ultra', onetime: 'one-time',
    lite_v: '1 video · valid 365 days', pro_v: '2 videos · valid 365 days', ultra_v: '5 videos · valid 365 days',
    popular: 'Most popular', choose: 'Choose a video pack',
    pricing_note: 'Each video is a 12-second, 768P rap duet with AI vocals and music, powered by Minimax H3. Confirmed failed tasks restore your allowance. Payments are securely handled by Pancake (Waffo) — one-time packs, no subscription.',
    faq_title: 'AI rap video questions',
    q1: "What's the easiest way to make an AI rap video here?",
    a1: 'Choose a pack, add two portraits or one photo together, pick a stage, occasion and language, add a personal detail — then generate a 12-second 768P duet and find it in My works.',
    q2: 'Can I upload my own song?',
    a2: 'This workflow does not accept song files. AI creates new lyrics, voices and a beat around your topic. You can re-edit the download with your own licensed audio.',
    q3: 'Can it use exact lyrics or match a recording?',
    a3: 'No. You can suggest a name, story or phrase, but exact lyrics and precise lip sync are not guaranteed. No recording upload or audio-driven lip-sync control.',
    q4: 'Is this a free AI rap video generator?',
    a4: 'Production uses one-time video packs — no subscription, no renewal. This demo environment includes a small trial allowance you can use right away.',
    q5: 'Can I use the result for TikTok or YouTube Shorts?',
    a5: 'Yes. Choose 9:16, review the full video and audio, then download. Publishing, captions and AI labeling follow the rules of your destination platform.',
    q6: 'What if generation fails?',
    a6: 'Confirmed failed tasks automatically restore your video allowance so you can adjust and try again.',
    cta_title: 'Create an AI rap duet with your own direction', cta_btn: 'Start creating',
    footer_tag: 'Two voices, one beat — instant rap video',
    footer_note: 'Generated content is AI-made · confirm photo permissions and follow platform rules before sharing',
    status_composing: 'Writing your rap direction…',
    status_submitting: 'Submitting to the video model…',
    status_processing: 'Generating your 12-second duet… this usually takes a few minutes',
    status_succeeded: 'Done! Preview and download below.',
    status_failed: 'Generation failed',
    no_allowance: 'Allowance used up — pick a video pack to continue.',
    need_consent: 'Please confirm the consent checkbox first.',
    need_photos: 'Please add the required photo(s) first.',
    upload_fail: 'Photo upload failed',
    stage_names: { studio: 'Recording studio', booth: 'Orange booth', street: 'Street cypher', lobby: 'Luxury lobby' },
    occasion_names: { duet: 'Friendly duet', birthday: 'Birthday shout-out', couple: 'Couple duet', battle: 'Friendly rap battle' }
  }
};
// 中文直接用 HTML 里的默认文案
function t(key) {
  if (state.lang === 'zh') return null; // null = keep HTML default
  return I18N.en[key] || null;
}

/* ---------------- helpers ---------------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
async function api(path, opts) {
  const resp = await fetch(path, opts);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(json.error || `HTTP ${resp.status}`), { status: resp.status });
  return json;
}

/* ---------------- i18n apply ---------------- */
function applyLang() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  $('#langToggle').textContent = state.lang === 'zh' ? 'EN' : '中文';
  $$('[data-i18n]').forEach(el => {
    const v = t(el.dataset.i18n);
    if (v !== null) el.innerHTML = v;
  });
  $$('[data-i18n-ph]').forEach(el => {
    const v = t(el.dataset.i18nPh);
    if (v !== null) el.placeholder = v;
  });
  renderChips();
}

/* ---------------- chips ---------------- */
function renderChips() {
  const cfg = state.config;
  if (!cfg) return;
  const stageGroup = $('#stageGroup');
  stageGroup.innerHTML = '';
  Object.entries(cfg.stages).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (k === state.stage ? ' active' : '');
    b.textContent = state.lang === 'zh' ? v.zh : v.en;
    b.onclick = () => { state.stage = k; renderChips(); };
    stageGroup.appendChild(b);
  });
  const occGroup = $('#occasionGroup');
  occGroup.innerHTML = '';
  Object.entries(cfg.occasions).forEach(([k, v]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (k === state.occasion ? ' active' : '');
    b.textContent = state.lang === 'zh' ? v.zh : v.en;
    b.onclick = () => { state.occasion = k; renderChips(); };
    occGroup.appendChild(b);
  });
  const langGroup = $('#langGroup');
  langGroup.innerHTML = '';
  [['zh', '中文说唱'], ['en', 'English rap']].forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'chip' + (k === state.rapLang ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { state.rapLang = k; renderChips(); };
    langGroup.appendChild(b);
  });
}

/* ---------------- photos ---------------- */
function bindPhotoSlot(slotId, key) {
  const slot = $(`#${slotId}`);
  const input = slot.querySelector('input');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('图片不能超过 2 MB / Image must be under 2 MB'); return; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      r.readAsDataURL(file);
    });
    try {
      const { url } = await api('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl })
      });
      state.photos[key] = url;
      slot.classList.add('has-img');
      slot.querySelectorAll('img').forEach(i => i.remove());
      const img = document.createElement('img');
      img.src = url; img.alt = 'photo';
      slot.prepend(img);
    } catch (e) { alert(e.message); }
  });
}

function applyPhotoMode() {
  const two = state.photoMode === 'two';
  $('#slot1').classList.toggle('hidden', !two);
  $('#slot2').classList.toggle('hidden', !two);
  $('#slotBoth').classList.toggle('hidden', two);
}

/* ---------------- generation ---------------- */
async function refreshAllowance() {
  try {
    const a = await api('/api/allowance');
    const label = a.purchased > 0
      ? `${a.remaining}（体验 ${a.trialRemaining} + 已购 ${a.purchased}）`
      : `${a.remaining}`;
    $('#allowanceNum').textContent = label;
    return a;
  } catch { return null; }
}

async function generate() {
  const btn = $('#generateBtn');
  const two = state.photoMode === 'two';
  const photos = two ? [state.photos.slot1, state.photos.slot2].filter(Boolean) : (state.photos.slotBoth ? [state.photos.slotBoth] : []);
  if (two && photos.length < 2) { alert(t('need_photos') || '请先添加所需照片'); return; }
  if (!two && photos.length < 1) { alert(t('need_photos') || '请先添加所需照片'); return; }
  if (!$('#consentCheck').checked) { alert(t('need_consent') || '请先勾选授权确认'); return; }

  const allowance = await refreshAllowance();
  if (allowance && allowance.remaining <= 0) { alert(t('no_allowance') || '额度已用完'); return; }

  btn.disabled = true;
  $('#taskPanel').classList.remove('hidden');
  $('#taskError').classList.add('hidden');
  $('#taskResult').classList.add('hidden');
  $('#taskStatusText').textContent = t('status_composing') || '正在撰写说唱导演脚本…';

  try {
    const { taskId } = await api('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: state.stage, occasion: state.occasion, language: state.rapLang,
        format: state.format, personalDetail: $('#personalDetail').value.trim(),
        consent: true, photos
      })
    });
    state.currentTask = taskId;
    pollTask(taskId);
  } catch (e) {
    btn.disabled = false;
    $('#taskPanel').classList.remove('hidden');
    const err = $('#taskError');
    err.textContent = e.message; err.classList.remove('hidden');
  }
}

function pollTask(taskId) {
  clearTimeout(state.pollTimer);
  const tick = async () => {
    try {
      const task = await api(`/api/tasks/${taskId}`);
      const statusText = $('#taskStatusText');
      const map = {
        composing: t('status_composing') || '正在撰写说唱导演脚本…',
        submitting: t('status_submitting') || '正在提交给视频模型…',
        processing: t('status_processing') || '正在生成 12 秒二重唱视频，通常需要几分钟…'
      };
      if (task.status === 'succeeded') {
        statusText.textContent = t('status_succeeded') || '完成！请在下方预览与下载。';
        $('#taskResult').classList.remove('hidden');
        const v = $('#resultVideo');
        v.src = task.videoUrl;
        $('#downloadBtn').href = task.videoUrl;
        $('#generateBtn').disabled = false;
        refreshAllowance(); renderWorks();
        return;
      }
      if (task.status === 'failed') {
        statusText.textContent = t('status_failed') || '生成失败';
        const err = $('#taskError');
        err.textContent = task.error || '未知错误'; err.classList.remove('hidden');
        $('#generateBtn').disabled = false;
        refreshAllowance(); renderWorks();
        return;
      }
      statusText.textContent = map[task.status] || statusText.textContent;
      state.pollTimer = setTimeout(tick, 5000);
    } catch {
      state.pollTimer = setTimeout(tick, 8000);
    }
  };
  tick();
}

/* ---------------- works ---------------- */
async function renderWorks() {
  const list = $('#worksList');
  try {
    const tasks = await api('/api/tasks');
    if (!tasks.length) return;
    const stageNames = t('stage_names');
    const occNames = t('occasion_names');
    list.innerHTML = '';
    tasks.forEach(task => {
      if (task.status === 'succeeded' && task.videoUrl) {
        const card = document.createElement('div');
        card.className = 'work-card';
        card.innerHTML = `<video src="${task.videoUrl}" controls playsinline preload="metadata"></video>
          <div class="work-meta"><b>${task.format} · 12s</b>${new Date(task.createdAt).toLocaleString()}</div>`;
        list.appendChild(card);
      } else if (task.status === 'failed') {
        const card = document.createElement('div');
        card.className = 'work-card failed';
        card.textContent = `✕ ${task.error || 'failed'}`;
        list.appendChild(card);
      } else {
        const card = document.createElement('div');
        card.className = 'work-card processing';
        card.innerHTML = `<span class="spinner"></span>${task.status === 'processing' ? (t('status_processing') || '生成中…') : '…'}`;
        list.appendChild(card);
      }
    });
  } catch { /* ignore */ }
}

/* ---------------- checkout ---------------- */
let pollOrderTimer = null;

async function buyPack(packKey) {
  try {
    const { orderId, checkoutUrl } = await api('/api/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: packKey })
    });
    localStorage.setItem('rd_pending_order', orderId);
    // 文档建议：不要用 window.open（Safari/移动端会拦截），直接跳转
    window.location.href = checkoutUrl;
  } catch (e) {
    alert(e.message || '创建支付失败');
  }
}

function watchPendingOrder() {
  const orderId = localStorage.getItem('rd_pending_order');
  if (!orderId) return;
  clearTimeout(pollOrderTimer);
  const tick = async () => {
    try {
      const o = await api(`/api/orders/${orderId}`);
      if (o.status === 'paid') {
        localStorage.removeItem('rd_pending_order');
        refreshAllowance();
        alert(state.lang === 'zh'
          ? `支付成功！已到账 ${o.videos} 个视频额度 🎉`
          : `Payment successful — ${o.videos} video allowance added 🎉`);
        return;
      }
    } catch {
      localStorage.removeItem('rd_pending_order');
      return;
    }
    pollOrderTimer = setTimeout(tick, 5000);
  };
  tick();
}

/* ---------------- events ---------------- */
$('#langToggle').addEventListener('click', () => {
  state.lang = state.lang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('rd_lang', state.lang);
  applyLang();
});

$$('#photoMode .seg-btn').forEach(b => b.addEventListener('click', () => {
  $$('#photoMode .seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.photoMode = b.dataset.mode;
  applyPhotoMode();
}));

$$('#formatSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
  $$('#formatSeg .seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  state.format = b.dataset.format;
}));

// 风格卡 → 带入方向
$$('.style-card').forEach(card => card.addEventListener('click', () => {
  const [stage, occasion] = (card.dataset.preset || '').split(',');
  if (stage && occasion) { state.stage = stage; state.occasion = occasion; renderChips(); }
  document.querySelector('#generator').scrollIntoView({ behavior: 'smooth' });
}));

$$('.pack-btn').forEach(b => b.addEventListener('click', () => buyPack(b.dataset.pack)));

$('#generateBtn').addEventListener('click', generate);

/* ---------------- init ---------------- */
(async function init() {
  bindPhotoSlot('slot1', 'slot1');
  bindPhotoSlot('slot2', 'slot2');
  bindPhotoSlot('slotBoth', 'slotBoth');
  applyPhotoMode();
  try { state.config = await api('/api/config'); } catch {}
  applyLang();
  refreshAllowance();
  renderWorks();
  watchPendingOrder();
})();
