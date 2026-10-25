'use strict';

/**
 * Waffo Pancake 支付对接（零依赖）
 * - 请求签名：RSA-SHA256(canonicalRequest)，Headers: X-Merchant-Id / X-Timestamp / X-Signature
 *   canonicalRequest = METHOD\nPATH\nTIMESTAMP\nSHA256_BASE64(BODY)
 * - Webhook 验签：X-Waffo-Signature: t=<ms>,v1=<base64>，验 RSA-SHA256(`${t}.${rawBody}`)
 *   使用 SDK 内嵌的 test/prod 双公钥自动回退
 */

const crypto = require('crypto');

const API_BASE = 'https://api.waffo.ai';

// ---------- 私钥 ----------
function buildPem(b64) {
  const body = b64.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('WAFFO_PRIVATE_KEY 为空');
  if (body.includes('BEGIN')) return b64; // 已经是 PEM
  const wrapped = body.match(/.{1,64}/g).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

// ---------- API Key 请求签名 ----------
function signedHeaders(privateKeyPem, method, apiPath, bodyStr) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash('sha256').update(bodyStr || '').digest('base64');
  const canonicalRequest = `${method}\n${apiPath}\n${timestamp}\n${bodyHash}`;
  const signature = crypto.sign('sha256', Buffer.from(canonicalRequest, 'utf8'), privateKeyPem).toString('base64');
  return {
    'Content-Type': 'application/json',
    'X-Merchant-Id': process.env.WAFFO_MERCHANT_ID,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}

async function apiCall(method, apiPath, body) {
  const bodyStr = body ? JSON.stringify(body) : '';
  const resp = await fetch(`${API_BASE}${apiPath}`, {
    method,
    headers: signedHeaders(buildPem(process.env.WAFFO_PRIVATE_KEY), method, apiPath, bodyStr),
    body: bodyStr || undefined
  });
  const text = await resp.text();
  let jsonBody = null;
  try { jsonBody = JSON.parse(text); } catch {}
  if (!resp.ok) {
    const err = new Error(`Pancake API ${resp.status}: ${text.slice(0, 400)}`);
    err.status = resp.status;
    err.body = jsonBody || text;
    throw err;
  }
  return jsonBody;
}

// ---------- 商品 ----------
const PACKS = {
  lite:  { name: { zh: '体验版 Lite',  en: 'Lite Pack'  }, price: '4.90',  videos: 1, desc: '1 rap video · valid 365 days' },
  pro:   { name: { zh: '进阶版 Pro',   en: 'Pro Pack'   }, price: '8.90',  videos: 2, desc: '2 rap videos · valid 365 days' },
  ultra: { name: { zh: '畅享版 Ultra', en: 'Ultra Pack' }, price: '19.90', videos: 5, desc: '5 rap videos · valid 365 days' }
};

// 创建一次性商品（幂等：同一 store 下同名商品只建一次，由调用方缓存 productId）
async function createOneTimeProduct(storeId, packKey, pack) {
  const body = {
    storeId,
    name: `${pack.name.en} · ${pack.videos} video${pack.videos > 1 ? 's' : ''}`,
    description: pack.desc,
    prices: {
      [process.env.WAFFO_CURRENCY || 'USD']: {
        amount: pack.price,
        taxIncluded: true,
        taxCategory: 'digital_goods'
      }
    },
    metadata: { pack: packKey, videos: String(pack.videos), app: 'rapduet' }
  };
  const resp = await apiCall('POST', '/v1/actions/onetime-product/create-product', body);
  const product = (resp && resp.data && resp.data.product) || null;
  if (!product || !product.id) throw new Error(`创建商品失败：${JSON.stringify(resp).slice(0, 300)}`);
  return product;
}

// ---------- 收银台会话 ----------
async function createCheckoutSession({ productId, metadata, successUrl, buyerEmail }) {
  const body = {
    productId,
    currency: process.env.WAFFO_CURRENCY || 'USD',
    metadata
  };
  if (successUrl) body.successUrl = successUrl;
  if (buyerEmail) body.buyerEmail = buyerEmail;
  const resp = await apiCall('POST', '/v1/actions/checkout/create-session', body);
  const data = (resp && resp.data) || {};
  if (!data.checkoutUrl) throw new Error(`创建收银台失败：${JSON.stringify(resp).slice(0, 300)}`);
  return data; // { sessionId, checkoutUrl, expiresAt }
}

// ---------- Webhook 验签（移植自 @waffo/pancake-ts） ----------
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxnmRY6yMMA3lVqmAU6ZG
b1sjL/+r/z6E+ZjkXaDAKiqOhk9rpazni0bNsGXwmftTPk9jy2wn+j6JHODD/WH/
SCnSfvKkLIjy4Hk7BuCgB174C0ydan7J+KgXLkOwgCAxxB68t2tezldwo74ZpXgn
F49opzMvQ9prEwIAWOE+kV9iK6gx/AckSMtHIHpUesoPDkldpmFHlB2qpf1vsFTZ
5kD6DmGl+2GIVK01aChy2lk8pLv0yUMu18v44sLkO5M44TkGPJD9qG09wrvVG2wp
OTVCn1n5pP8P+HRLcgzbUB3OlZVfdFurn6EZwtyL4ZD9kdkQ4EZE/9inKcp3c1h4
xwIDAQAB
-----END PUBLIC KEY-----`;
const PROD_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz+xApdTIb4ua+DgZKQ54
iBsD82ybyhGCLRETONW4Jgbb3A8DUM1LqBk6r/CmTOCHqLalTQHNigvP3R5zkDNX
iRJz6gA4MJ/+8K0+mnEE2RISQzN+Qu65TNd6svb+INm/kMaftY4uIXr6y6kchtTJ
dwnQhcKdAL2v7h7IFnkVelQsKxDdb2PqX8xX/qwd01iXvMcpCCaXovUwZsxH2QN5
ZKBTseJivbhUeyJCco4fdUyxOMHe2ybCVhyvim2uxAl1nkvL5L8RCWMCAV55LLo0
9OhmLahz/DYNu13YLVP6dvIT09ZFBYU6Owj1NxdinTynlJCFS9VYwBgmftosSE1U
dwIDAQAB
-----END PUBLIC KEY-----`;

function verifyWebhook(rawBody, signatureHeader, { toleranceMs = 45 * 60 * 1000, futureToleranceMs = 60 * 1000 } = {}) {
  if (!signatureHeader) throw new Error('Missing X-Waffo-Signature header');
  let t = '', v1 = '';
  for (const pair of String(signatureHeader).split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const k = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (k === 't') t = val;
    else if (k === 'v1') v1 = val;
  }
  if (!t || !v1) throw new Error('Malformed X-Waffo-Signature header');
  const ageMs = Date.now() - Number(t);
  if (Number.isNaN(ageMs) || ageMs > toleranceMs || ageMs < -futureToleranceMs) {
    throw new Error('Webhook timestamp outside tolerance window (possible replay)');
  }
  const signatureInput = `${t}.${rawBody}`;
  const tryKeys = [PROD_PUBLIC_KEY, TEST_PUBLIC_KEY];
  const ok = tryKeys.some(pub => {
    try {
      return crypto.verify('sha256', Buffer.from(signatureInput, 'utf8'), pub, Buffer.from(v1, 'base64'));
    } catch { return false; }
  });
  if (!ok) throw new Error('Invalid webhook signature');
  return JSON.parse(rawBody);
}

module.exports = { PACKS, buildPem, apiCall, createOneTimeProduct, createCheckoutSession, verifyWebhook };
