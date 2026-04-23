// server.js（安定化パッチ入り）
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const https = require('https');
require('dotenv').config();

const Unblocker = require('unblocker');

const app = express();

// 基本ミドルウェア
app.disable('x-powered-by');
app.use(compression());
app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- 安定化: アウトバウンドのHTTP/HTTPSエージェント（Keep-Alive） ----
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 64
});
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10_000,
  maxSockets: 64
});

// ---- Unblocker 設定 ----
const config = {
  prefix: '/proxy/',
  processContentTypes: [
    'text/html',
    'application/xml+xhtml',
    'application/xhtml+xml',
    'text/css'
  ],
  standardMiddleware: true,

  // 上流に出す直前の調整（ヘッダ・エージェント・タイムアウトなど）
  requestMiddleware: [
    (data) => {
      // UA/言語/エンコーディングを“普通のブラウザ相当”に統一
      const h = data.requestOptions.headers || (data.requestOptions.headers = {});
      h['user-agent'] = h['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
      h['accept-language'] = h['accept-language'] || 'ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.6';
      // 一部環境でbrが相性悪いケースがあるため、まずはgzip/deflate優先
      h['accept-encoding'] = 'gzip, deflate';
      h['connection'] = 'keep-alive';
      // Keep-Aliveエージェントを適用
      data.requestOptions.agent = (data.protocol === 'http:') ? httpAgent : httpsAgent;
      // ソケット/応答タイムアウト（過度なハング防止）
      data.requestOptions.timeout = 30_000; // ms
    }
  ],

  // レスポンス側の最終調整
  responseMiddleware: [
    (data) => {
      if (data.headers) {
        // 一部サイトの描画/埋め込み安定化
        delete data.headers['content-security-policy'];
        delete data.headers['x-frame-options'];
      }
      // 動画シークの安定化
      if (data.clientRequest && data.clientRequest.headers) {
        const range = data.clientRequest.headers['range'];
        if (range) data.headers['accept-ranges'] = 'bytes';
      }
    }
  ]
};

app.use(new Unblocker(config));

// トップページ（フォーム）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 入力ハンドラ: URL or 検索語 → 常に /proxy/ 経由へ
app.post('/go', (req, res) => {
  const input = (req.body.q || '').trim();
  if (!input) return res.redirect('/');

  const isLikelyUrl = /^(https?:\/\/)/i.test(input) || /\./.test(input);
  const target = isLikelyUrl
    ? (input.match(/^https?:\/\//i) ? input : `https://${input}`)
    : `https://www.google.com/search?q=${encodeURIComponent(input)}`;

  res.redirect(`${config.prefix}${target}`);
});

// 健康チェック
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ---- エラーハンドラ（ECONNRESET等の可視化と優しい表示） ----
app.use((err, req, res, next) => {
  console.error('proxy-error:', err && (err.code || err.message), err && err.stack ? `\n${err.stack}` : '');
  if (res.headersSent) return next(err);
  const isNetErr = err && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN');
  res.status(isNetErr ? 502 : 500).send(`
    <!doctype html><meta charset="utf-8">
    <title>一時的に接続できません</title>
    <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:32px;line-height:1.7;color:#223}
    .card{max-width:720px;border:1px solid #e7ebf3;border-radius:14px;padding:20px;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    h1{font-size:18px;margin:0 0 10px}code{background:#f3f6fb;padding:2px 6px;border-radius:6px}</style>
    <div class="card">
      <h1>一時的に接続できませんでした。</h1>
      <div>しばらく待って再読み込みしてください。対象サイトやネットワークの状況により、まれに発生します。</div>
      <div style="margin-top:10px;color:#667">
        エラー: <code>${(err && (err.code || err.message)) || 'unknown'}</code>
      </div>
      <div style="margin-top:14px"><a href="javascript:history.back()">← 前のページに戻る</a></div>
    </div>
  `);
});

// ---- サーバ起動（外向き待受 & タイムアウト調整） ----
const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});
server.keepAliveTimeout = 61_000;
server.headersTimeout   = 62_000;
server.requestTimeout   = 60_000;

// 予期せぬ例外もログして落ちにくく
process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
