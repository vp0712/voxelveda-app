'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const INTERNAL_PORT = Number(process.env.INTERNAL_APP_PORT || 8081);
const HOST = '0.0.0.0';
const INTERNAL_HOST = '127.0.0.1';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'logo.png');

let backendReady = false;
let backendFailed = false;
let shuttingDown = false;
let child = null;
let pollTimer = null;

function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function warmupHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>Voxel Veda is starting</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;min-height:100%;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#111827}body{min-height:100vh;display:grid;place-items:center;padding:24px}.wrap{display:flex;flex-direction:column;align-items:center;gap:18px;width:min(88vw,360px);max-width:calc(100vw - 32px);padding:28px;border-radius:28px;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.12);overflow:hidden}.logo-wrap{position:relative;display:grid;place-items:center;width:min(56vw,210px);height:min(56vw,210px);min-width:150px;min-height:150px;border-radius:50%;background:#fff}.ring{position:absolute;inset:0;border:3px solid rgba(17,24,39,.10);border-right-color:#111827;border-bottom-color:#111827;border-radius:50%;animation:spin .95s linear infinite}.logo-stage{position:relative;z-index:1;width:52%;height:52%;max-width:108px;max-height:108px;display:grid;place-items:center}.logo-stage img{display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;object-position:center;filter:none!important;transform:none!important;animation:none!important;opacity:1!important;border-radius:0!important}.txt{margin:0;max-width:100%;text-align:center;font-size:12px;line-height:1.5;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#667085;overflow-wrap:anywhere}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:390px){body{padding:14px}.wrap{width:calc(100vw - 24px);max-width:calc(100vw - 24px);padding:24px 16px}.logo-wrap{width:180px;height:180px;min-width:0;min-height:0}.logo-stage{width:50%;height:50%;max-width:90px;max-height:90px}}@media(prefers-reduced-motion:reduce){.ring{animation:none;border-color:rgba(17,24,39,.15);border-right-color:#111827}}</style></head><body><main class="wrap"><div class="logo-wrap"><span class="ring" aria-hidden="true"></span><div class="logo-stage"><img src="/logo.png?v=20260917c" alt="Voxel Veda"></div></div><p class="txt">Voxel Veda is preparing your workspace</p></main><script>(()=>{let finished=false;async function check(){if(finished)return;try{const r=await fetch('/api/health',{cache:'no-store'});const j=await r.json();if(j&&j.backend_ready===true){finished=true;location.replace(location.href);return;}}catch{}setTimeout(check,1200);}setTimeout(check,700);})();</script></body></html>`;
}

function serveLogo(res) {
  fs.readFile(LOGO_PATH, (error, buffer) => {
    if (error) return writeJson(res, 503, { status: 'starting', logo: 'unavailable' });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(buffer);
  });
}

function proxyRequest(req, res) {
  const upstream = http.request({
    hostname: INTERNAL_HOST,
    port: INTERNAL_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: req.headers.host || `127.0.0.1:${INTERNAL_PORT}` }
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on('error', () => {
    if (!res.headersSent) writeJson(res, 503, { status: 'starting', ready: false });
    else res.end();
  });

  req.pipe(upstream);
}

function checkBackend() {
  if (shuttingDown || backendFailed) return;
  const request = http.get({ hostname: INTERNAL_HOST, port: INTERNAL_PORT, path: '/api/health', timeout: 1500 }, (res) => {
    res.resume();
    if (res.statusCode === 200) {
      if (!backendReady) console.log(`Startup gateway: backend ready on ${INTERNAL_HOST}:${INTERNAL_PORT}.`);
      backendReady = true;
      return;
    }
    backendReady = false;
  });
  request.on('timeout', () => request.destroy());
  request.on('error', () => { backendReady = false; });
}

const gateway = http.createServer((req, res) => {
  const pathname = String(req.url || '/').split('?')[0];

  if (pathname === '/api/health') {
    const status = backendFailed ? 503 : 200;
    return writeJson(res, status, {
      status: backendFailed ? 'failed' : 'ok',
      service: 'voxel-veda-startup-gateway',
      backend_ready: backendReady,
      uptime_seconds: Math.max(0, Math.floor(process.uptime()))
    });
  }

  if (pathname === '/logo.png' && !backendReady) return serveLogo(res);

  if (backendReady) return proxyRequest(req, res);

  if (pathname === '/api/ready') {
    return writeJson(res, 503, { ready: false, status: backendFailed ? 'failed' : 'starting' });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const body = Buffer.from(warmupHtml());
    res.writeHead(503, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': req.method === 'HEAD' ? 0 : body.length,
      'Cache-Control': 'no-store',
      'Retry-After': '2',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff'
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  return writeJson(res, 503, { status: 'starting', ready: false, message: 'Voxel Veda is starting. Retry shortly.' });
});

function startBackend() {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(INTERNAL_PORT) },
    stdio: 'inherit'
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    backendReady = false;
    backendFailed = true;
    console.error(`Startup gateway: backend exited before shutdown (code=${code ?? 'null'} signal=${signal || 'none'}).`);
    setTimeout(() => process.exit(code || 1), 250).unref();
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(pollTimer);
  console.log(`Startup gateway received ${signal}.`);
  if (child && !child.killed) child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
  gateway.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}

gateway.listen(PUBLIC_PORT, HOST, () => {
  console.log(`Startup gateway listening on ${HOST}:${PUBLIC_PORT}; backend will initialize on ${INTERNAL_HOST}:${INTERNAL_PORT}.`);
  startBackend();
  checkBackend();
  pollTimer = setInterval(checkBackend, 1000);
  pollTimer.unref?.();
});

gateway.on('error', (error) => {
  console.error(`Startup gateway failed: ${error.code || error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
