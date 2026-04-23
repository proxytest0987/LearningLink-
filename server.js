// server.js
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const Unblocker = require('unblocker');

const app = express();

// 基本ミドルウェア
app.disable('x-powered-by');
app.use(compression());
app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Unblocker 設定
const config = {
  // すべてのプロキシURLは /proxy/ で始める
  prefix: '/proxy/',
  // HTML/CSSなどの書き換え対象
  processContentTypes: [
    'text/html',
    'application/xml+xhtml',
    'application/xhtml+xml',
    'text/css'
  ],
  // 既定の標準ミドルウェアを有効化(CSP/リダイレクト/クッキー修正/URL書換など)
  standardMiddleware: true,
  // 追加のレスポンス処理(必要に応じてヘッダ調整)
  responseMiddleware: [
    (data) => {
      // 一部サイトの再生/動作安定化: 不要な制限ヘッダを削除
      if (data.headers) {
        delete data.headers['content-security-policy'];
        delete data.headers['x-frame-options'];
      }
      // Rangeヘッダは自動的に中継されるが、動画のシーク安定化のため明示
      if (data.clientRequest && data.clientRequest.headers) {
        const range = data.clientRequest.headers['range'];
        if (range) data.headers['accept-ranges'] = 'bytes';
      }
    }
  ]
};

app.use(new Unblocker(config));

// トップページ(検索/URL入力フォーム)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 入力ハンドラ: URLまたは検索語を /proxy/ に流す
app.post('/go', (req, res) => {
  const input = (req.body.q || '').trim();

  if (!input) return res.redirect('/');

  // URLかどうかを簡易判定
  const isLikelyUrl = /^(https?:\/\/)/i.test(input) || /\./.test(input);

  // 検索エンジンは必ずプロキシ経由で
  const target = isLikelyUrl
    ? (input.match(/^https?:\/\//i) ? input : `https://${input}`)
    : `https://www.google.com/search?q=${encodeURIComponent(input)}`;

  // 常に /proxy/ を通す
  const proxied = `${config.prefix}${target}`;
  res.redirect(proxied);
});

// 健康チェック
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Proxy running on http://localhost:${PORT}`);
});
