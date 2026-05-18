// proxy.js – StreamVault Release Proxy v1.0
// ─────────────────────────────────────────────────────────────────────────────
// Corre no Render (free tier) atrás do Cloudflare Tunnel.
// Recebe GET /{jobId}/{assetPath} → busca à Release do GitHub → devolve.
//
// O Cloudflare cacheia a resposta por 1 ano — MISS só acontece uma vez por
// asset por região. Após o warm todos os pedidos são servidos do cache CDN.
//
// Fluxo:
//   Player → cdn.pixgo.qzz.io/{jobId}/hls/seg.bin
//   → Cloudflare CDN → HIT → serve (0 requests ao proxy)
//   → MISS → tunnel → proxy (Render) → GitHub Release → cacheia 1 ano
//
// Variáveis de ambiente (.env ou Render Dashboard):
//   GITHUB_TOKEN   — PAT com scope: repo
//   GITHUB_OWNER   — username da conta storage
//   GITHUB_REPO    — repo de storage
//   ALLOWED_ORIGIN — origem permitida (ex: https://pixgo.frii.site ou *)
//   PORT           — porta (Render injeta automaticamente)
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import http from 'http';

const PORT           = parseInt(process.env.PORT || '8080');
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN  || '';
const GITHUB_OWNER   = process.env.GITHUB_OWNER  || '';
const GITHUB_REPO    = process.env.GITHUB_REPO   || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const MIME = {
  bin:  'application/octet-stream',
  m3u8: 'application/vnd.apple.mpegurl',
  json: 'application/json',
  jpg:  'image/jpeg',
};

const TTL = 31536000; // 1 ano

// ── GitHub API ───────────────────────────────────────────────────────────────
async function ghFetch(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      'Authorization':        `Bearer ${GITHUB_TOKEN}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent':           'StreamVault-Proxy/1.0',
      ...extraHeaders,
    },
  });
  return res;
}

// ── Cache de Release em memória (evita hit à API por cada asset) ─────────────
// { jobId → { assets: [{name, id}], cachedAt } }
const releaseCache = new Map();
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hora

async function getReleaseAssets(jobId) {
  const cached = releaseCache.get(jobId);
  if (cached && Date.now() - cached.cachedAt < RELEASE_CACHE_TTL) {
    return cached.assets;
  }

  const res = await ghFetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${jobId}`
  );

  if (!res.ok) return null;

  const release = await res.json();
  const assets  = (release.assets || []).map(a => ({ name: a.name, id: a.id }));

  releaseCache.set(jobId, { assets, cachedAt: Date.now() });
  return assets;
}

// ── Keep-alive — evita que o Render adormeça ─────────────────────────────────
function startKeepAlive(port) {
  const interval = 14 * 60 * 1000;
  const selfUrl  = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : `http://localhost:${port}/health`;

  setInterval(async () => {
    try {
      await fetch(selfUrl);
      console.log(`[keep-alive] ping → ${new Date().toISOString()}`);
    } catch (e) {
      console.warn(`[keep-alive] erro: ${e.message}`);
    }
  }, interval);

  console.log(`  ✓ Keep-alive activo → ${selfUrl}`);
}

// ── Servidor HTTP ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  // CORS
  res.setHeader('Access-Control-Allow-Origin',   ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods',  'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Cache');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, repo: `${GITHUB_OWNER}/${GITHUB_REPO}` }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }

  // Parsear path: /{jobId}/{assetPath}
  const parts = req.url.replace(/^\//, '').split('/');
  if (parts.length < 2) {
    res.writeHead(400); res.end('Bad Request'); return;
  }

  const jobId     = parts[0];
  const assetPath = parts.slice(1).join('/');
  const assetName = assetPath.split('/').pop();
  const ext       = assetName.split('.').pop().toLowerCase();
  const mime      = MIME[ext] || 'application/octet-stream';

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    res.writeHead(500); res.end('Proxy não configurado'); return;
  }

  try {
    // 1. Obter assets da Release (com cache em memória)
    const assets = await getReleaseAssets(jobId);
    if (!assets) {
      res.writeHead(404); res.end(`Release não encontrada: ${jobId}`); return;
    }

    const asset = assets.find(a => a.name === assetName);
    if (!asset) {
      res.writeHead(404); res.end(`Asset não encontrado: ${assetName}`); return;
    }

    // 2. Descarregar asset da Release
    const assetRes = await ghFetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/${asset.id}`,
      { 'Accept': 'application/octet-stream' }
    );

    if (!assetRes.ok) {
      res.writeHead(502); res.end('Erro ao descarregar asset'); return;
    }

    // 3. Resposta com headers de cache
    res.writeHead(200, {
      'Content-Type':  mime,
      'Cache-Control': `public, max-age=${TTL}, immutable`,
      'X-Cache':       'MISS-PROXY',
    });

    // Stream do body
    const reader = assetRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();

    console.log(`[proxy] ${jobId}/${assetName} → 200`);

  } catch (e) {
    console.error(`[proxy] erro: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(500); res.end('Erro interno');
    }
  }
});

server.listen(PORT, () => {
  console.log(`StreamVault Release Proxy v1.0 — porta ${PORT}`);
  console.log(`  ✓ Storage: ${GITHUB_OWNER}/${GITHUB_REPO}`);

  if (process.env.RENDER || process.env.KEEP_ALIVE === 'true') {
    startKeepAlive(PORT);
  }
});
