'use strict';

// Vercel Serverless Function 入口
// 复用 server.js 的请求处理器（本地 `node server.js` 与线上共用同一套逻辑）
const { handleRequest } = require('../server');

module.exports = async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (e) {
    console.error('[function error]', e && e.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e && e.message || 'Function error' }));
    }
  }
};
