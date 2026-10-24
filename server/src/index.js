'use strict';
// Qué Pensabas Bajar — backend hosted (Fly.io)
// Reúne: búsqueda/descarga de YouTube (yt-dlp), radio (ytmusicapi) y el
// Cookie Keeper (cookies de sesión de YouTube cifradas en Supabase).
// Todas las rutas /api/* salvo /api/health requieren Authorization: Bearer <token>.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const { requireAuth, verifyToken } = require('./auth');
const cookies = require('./cookies');
const ytmusic = require('./ytmusic');
const browser = require('./browser');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || process.env.QP_BAJAR_PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const SERVER_DIR = __dirname;
const TMP_DIR = process.env.TMP_DIR || path.join(require('os').tmpdir(), 'qp-bajar');
const CLIP_DIR = path.join(TMP_DIR, 'Cache');
const AUDIO_DIR = path.join(TMP_DIR, 'Audio');
const DESCARGAS_DIR = path.join(TMP_DIR, 'Descargas');
const CLIP_SECONDS = Number(process.env.CLIP_SECONDS || 45);
const AUDIO_SECONDS = Number(process.env.AUDIO_SECONDS || 7200); // 2 horas (soporta mixes y sets largos)
const CLIP_CACHE = {};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function log(m) { console.log(new Date().toISOString() + ' ' + m); }

// Auth de medios (clip/aclip): acepta el token también por query (?token=)
// porque los reproductores nativos/<video> no mandan el header Authorization.
async function requireAuthMedia(req, url, p) {
  if (p === '/api/clip' || p === '/api/aclip') {
    const qt = url.searchParams.get('token') || '';
    if (qt) return verifyToken(qt);
  }
  return requireAuth(req);
}

function respond(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

// ── helpers de binarios ──────────────────────────────────────────────
function findBin(name) {
  const exe = (process.platform === 'win32' && name.indexOf('.') === -1) ? name + '.exe' : name;
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    try { if (fs.existsSync(path.join(d, exe))) return path.join(d, exe); } catch (e) {}
  }
  return null;
}

function findDeno() {
  const p = findBin('deno');
  if (p) return p;
  const cands = [
    path.join(process.env.DENO_INSTALL || '', 'bin', 'deno'),
    path.join(require('os').homedir(), '.deno', 'bin', 'deno'),
  ];
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

// ── cookies para yt-dlp (Cookie Keeper desde Supabase) ───────────────
// Escribe el Netscape guardado en Supabase a un archivo y se lo pasa a yt-dlp.
// Sin esto, YouTube frena audio/video con "Sign in to confirm you're not a bot".
const COOKIES_TXT = path.join(TMP_DIR, 'cookies.txt');
let cookiesFetchedAt = 0;
let cookiesFetching = null;

async function ensureCookiesFile(force) {
  const TTL = 10 * 60 * 1000;
  if (!force && cookiesFetchedAt && Date.now() - cookiesFetchedAt < TTL) return fs.existsSync(COOKIES_TXT);
  if (cookiesFetching) return cookiesFetching;
  cookiesFetching = (async () => {
    try {
      const data = await cookies.read();
      const yt = data && data.cookies && data.cookies.youtube;
      if (!yt || typeof yt !== 'string' || yt.indexOf('Netscape') < 0) return false;
      try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch (e) {}
      fs.writeFileSync(COOKIES_TXT, yt, { mode: 0o600 });
      cookiesFetchedAt = Date.now();
      log('cookies: archivo listo (' + yt.length + ' bytes)');
      return true;
    } catch (e) {
      log('cookies: no se pudieron cargar (' + (e && e.message) + ')');
      return false;
    } finally { cookiesFetching = null; }
  })();
  return cookiesFetching;
}

function cookieArgs() {
  try {
    if (fs.existsSync(COOKIES_TXT) && fs.statSync(COOKIES_TXT).size > 40) return ['--cookies', COOKIES_TXT];
  } catch (e) {}
  return [];
}

// Clientes de YouTube a probar EN ORDEN hasta que uno funcione. YouTube cambia
// cuál cliente esquiva el PO token ("Sign in to confirm you're not a bot") y el
// "The page needs to be reloaded" cada pocas semanas. Override con YT_PLAYER_CLIENT
// (sets separados por "|"). 'android' e 'ios' tienen menores restricciones de bot.
const YT_CLIENT_SETS = (process.env.YT_PLAYER_CLIENT || 'android|ios|mweb|web_embedded|default,-tv_downgraded,web_embedded|tv,web_safari').split('|');
function ytExtractorArgs(set) { return ['--extractor-args', 'youtube:player_client=' + set]; }
function ytExtraArgs() { return ytExtractorArgs(YT_CLIENT_SETS[0]); }
// Proxy opcional (p.ej. residencial) si Google bloquea la IP del datacenter. Env: YT_PROXY=http://user:pass@host:port
function ytProxyArgs() { return process.env.YT_PROXY ? ['--proxy', process.env.YT_PROXY] : []; }
function ytRetryable(msg) { return /Sign in to confirm|needs to be reloaded|not a bot|Requested format is not available|player response|HTTP Error 403|Unable to extract/i.test(msg || ''); }

// ── proxy GET genérico ───────────────────────────────────────────────
function proxyGet(urlStr, headers, cb) {
  if (typeof headers === 'function') { cb = headers; headers = null; }
  let u;
  try { u = new URL(urlStr); } catch (e) { return cb(new Error('URL inválida')); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return cb(new Error('protocolo no soportado'));
  const lib = u.protocol === 'https:' ? https : http;
  const r = lib.request(u, { method: 'GET', headers: headers || {} }, (resp) => {
    const chunks = [];
    resp.on('data', (c) => chunks.push(c));
    resp.on('end', () => cb(null, resp.statusCode || 0, Buffer.concat(chunks), resp.headers));
  });
  r.on('error', (e) => cb(e));
  r.end();
}

// ── búsqueda YouTube ─────────────────────────────────────────────────
function runYtSearch(q, n, cb) {
  const ytdlp = findBin('yt-dlp');
  if (!ytdlp) return cb(new Error('yt-dlp no encontrado en PATH'));
  const args = [];
  const deno = findDeno();
  if (deno) args.push('--js-runtimes', 'deno:' + deno);
  args.push(...ytExtraArgs());
  args.push('--flat-playlist', '--dump-single-json', '--no-warnings', '--ignore-errors',
    'ytsearch' + n + ':' + q);
  let p;
  try { p = cp.spawn(ytdlp, args, { windowsHide: true }); } catch (e) { return cb(e); }
  let out = '', err = '', done = false;
  const finish = (e, r) => { if (done) return; done = true; cb(e, r); };
  const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} finish(new Error('timeout de búsqueda (>30s)')); }, 30000);
  p.stdout.on('data', (d) => { out += d.toString(); });
  p.stderr.on('data', (d) => { err += d.toString(); });
  p.on('error', (e) => { clearTimeout(timer); finish(e); });
  p.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 && !out) {
      const det = (err || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
      return finish(new Error(det || ('yt-dlp code ' + code)));
    }
    try {
      const data = JSON.parse(out);
      const results = ((data && data.entries) || []).filter((e) => e && e.id).map((e) => ({
        id: e.id,
        title: e.title || '(sin título)',
        url: 'https://www.youtube.com/watch?v=' + e.id,
        duration: e.duration || 0,
        channel: e.channel || e.uploader || '',
        thumb: 'https://i.ytimg.com/vi/' + e.id + '/mqdefault.jpg',
      }));
      finish(null, results);
    } catch (e) { finish(new Error('JSON de búsqueda inválido')); }
  });
}

// ── clip de vista previa (45s, ≤360p, con audio) ─────────────────────
function runYtClip(id, cb) {
  const out = path.join(CLIP_DIR, id + '.mp4');
  try { if (fs.existsSync(out) && fs.statSync(out).size > 0) return cb(null, out); } catch (e) {}
  if (CLIP_CACHE[id]) { CLIP_CACHE[id].cbs.push(cb); return; }
  CLIP_CACHE[id] = { cbs: [cb] };
  const done = (err) => {
    const c = CLIP_CACHE[id] || { cbs: [] };
    delete CLIP_CACHE[id];
    c.cbs.forEach((f) => { try { f(err, err ? null : out); } catch (e) {} });
  };
  const ytdlp = findBin('yt-dlp');
  if (!ytdlp) return done(new Error('yt-dlp no encontrado en PATH'));
  try { fs.mkdirSync(CLIP_DIR, { recursive: true }); } catch (e) {}
  const deno = findDeno();
  let lastErr = null;
  const attempt = (i) => {
    if (i >= YT_CLIENT_SETS.length) return done(lastErr || new Error('yt-dlp agotó los clientes'));
    const args = [];
    if (deno) args.push('--js-runtimes', 'deno:' + deno);
    args.push(...ytExtractorArgs(YT_CLIENT_SETS[i]));
    args.push(...ytProxyArgs());
    if (process.env.YT_COOKIES !== '0') args.push(...cookieArgs());
    args.push('-f', '18/bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/bv*[height<=360]+ba/b[height<=360]/b/best',
      '--merge-output-format', 'mp4',
      '--download-sections', '*0-' + CLIP_SECONDS,
      '-o', out,
      '--no-warnings', '--no-playlist',
      'https://www.youtube.com/watch?v=' + id);
    let p;
    try { p = cp.spawn(ytdlp, args, { windowsHide: true }); } catch (e) { return done(e); }
    let err = '', settled = false;
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch (e) {}
      if (settled) return; settled = true;
      lastErr = new Error('timeout de vista previa');
      attempt(i + 1);
    }, 90000);
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { clearTimeout(timer); if (settled) return; settled = true; done(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return; settled = true;
      try { if (fs.existsSync(out) && fs.statSync(out).size > 0) return done(null); } catch (e) {}
      const det = (err || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
      lastErr = new Error(det || ('yt-dlp code ' + code));
      if (ytRetryable(det) && i + 1 < YT_CLIENT_SETS.length) { try { fs.rmSync(out, { force: true }); } catch (e) {} return attempt(i + 1); }
      done(lastErr);
    });
  };
  attempt(0);
}

// ── audio solo (modo "solo audio", ahorra datos en 4G) ───────────────
function runYtAudio(id, cb) {
  const out = path.join(AUDIO_DIR, id + '.m4a');
  try { if (fs.existsSync(out) && fs.statSync(out).size > 0) return cb(null, out); } catch (e) {}
  const key = 'a:' + id;
  if (CLIP_CACHE[key]) { CLIP_CACHE[key].cbs.push(cb); return; }
  CLIP_CACHE[key] = { cbs: [cb] };
  const done = (err) => {
    const c = CLIP_CACHE[key] || { cbs: [] };
    delete CLIP_CACHE[key];
    c.cbs.forEach((f) => { try { f(err, err ? null : out); } catch (e) {} });
  };
  const ytdlp = findBin('yt-dlp');
  if (!ytdlp) return done(new Error('yt-dlp no encontrado en PATH'));
  try { fs.mkdirSync(AUDIO_DIR, { recursive: true }); } catch (e) {}
  const deno = findDeno();
  let lastErr = null;
  const attempt = (i) => {
    if (i >= YT_CLIENT_SETS.length) return done(lastErr || new Error('yt-dlp agotó los clientes'));
    const args = [];
    if (deno) args.push('--js-runtimes', 'deno:' + deno);
    args.push(...ytExtractorArgs(YT_CLIENT_SETS[i]));
    args.push(...ytProxyArgs());
    if (process.env.YT_COOKIES !== '0') args.push(...cookieArgs());
    // Con deno activo, --download-sections es rápido (segundos) y recorta el audio,
    // así no bajamos 10-60 min completos. Formato liviano (139=48kbps m4a).
    args.push('-f', '139/140/bestaudio[ext=m4a]/bestaudio',
      '--download-sections', '*0-' + AUDIO_SECONDS,
      '-o', out,
      '--no-warnings', '--no-playlist',
      'https://www.youtube.com/watch?v=' + id);
    let p;
    try { p = cp.spawn(ytdlp, args, { windowsHide: true }); } catch (e) { return done(e); }
    let err = '', settled = false;
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch (e) {}
      if (settled) return; settled = true;
      lastErr = new Error('timeout de audio');
      attempt(i + 1);
    }, 90000);
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => { clearTimeout(timer); if (settled) return; settled = true; done(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return; settled = true;
      try { if (fs.existsSync(out) && fs.statSync(out).size > 0) return done(null); } catch (e) {}
      const det = (err || '').split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
      lastErr = new Error(det || ('yt-dlp code ' + code));
      if (ytRetryable(det) && i + 1 < YT_CLIENT_SETS.length) { try { fs.rmSync(out, { force: true }); } catch (e) {} return attempt(i + 1); }
      done(lastErr);
    });
  };
  attempt(0);
}

// ── streaming de archivo local con Range ─────────────────────────────
function streamLocalFile(req, res, file, type) {
  let stat;
  try { stat = fs.statSync(file); } catch (e) { respond(res, 404, { error: 'archivo inexistente' }); return; }
  const range = req.headers['range'];
  const base = { 'Content-Type': type || 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = (m && m[1]) ? parseInt(m[1], 10) : 0;
    let end = (m && m[2]) ? parseInt(m[2], 10) : stat.size - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= stat.size) end = stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size, 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    }
    base['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
    base['Content-Length'] = end - start + 1;
    res.writeHead(206, base);
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  base['Content-Length'] = stat.size;
  res.writeHead(200, base);
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(b));
  });
}

// ── server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + HOST + ':' + PORT); } catch (e) { respond(res, 400, { error: 'bad url' }); return; }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, Content-Range, Accept-Ranges',
    });
    res.end();
    return;
  }

  const p = url.pathname;
  if (p === '/api/health') {
    respond(res, 200, {
      ok: true, ts: Date.now(), ytdlp: !!findBin('yt-dlp'), ffmpeg: !!findBin('ffmpeg'), deno: !!findDeno(),
      // Diagnóstico del deploy: commit que corre Render y config de YouTube (sin secretos).
      commit: process.env.RENDER_GIT_COMMIT || null,
      yt: { clientes: YT_CLIENT_SETS, cookies: process.env.YT_COOKIES !== '0', proxy: !!process.env.YT_PROXY },
    });
    return;
  }

  if (!p.startsWith('/api/')) { respond(res, 404, { error: '404 ' + p }); return; }

  const auth = await requireAuthMedia(req, url, p);
  if (!auth.ok) { log('auth rechazada ' + p); respond(res, auth.status || 401, { error: auth.error || 'unauthorized' }); return; }

  log(req.method + ' ' + req.url);

  if (p === '/api/ytsearch') {
    const q = (url.searchParams.get('q') || '').trim();
    const n = Math.min(Math.max(parseInt(url.searchParams.get('n') || '12', 10) || 12, 1), 25);
    if (!q) { respond(res, 400, { error: 'falta ?q=' }); return; }
    await ensureCookiesFile();
    runYtSearch(q, n, (err, results) => {
      if (err) { respond(res, 502, { error: 'ytsearch: ' + err.message }); return; }
      respond(res, 200, { ok: true, results });
    });
    return;
  }

  if (p === '/api/ytpreview') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!/^[\w-]{6,20}$/.test(id)) { respond(res, 400, { error: 'falta ?id= válido' }); return; }
    await ensureCookiesFile();
    runYtClip(id, (err) => {
      if (err) { respond(res, 502, { error: 'ytpreview: ' + err.message }); return; }
      respond(res, 200, { ok: true, clip: '/api/clip?id=' + id });
    });
    return;
  }

  if (p === '/api/clip') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!/^[\w-]{6,20}$/.test(id)) { respond(res, 400, { error: 'falta ?id= válido' }); return; }
    streamLocalFile(req, res, path.join(CLIP_DIR, id + '.mp4'), 'video/mp4');
    return;
  }

  if (p === '/api/audio') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!/^[\w-]{6,20}$/.test(id)) { respond(res, 400, { error: 'falta ?id= válido' }); return; }
    await ensureCookiesFile();
    runYtAudio(id, (err) => {
      if (err) { respond(res, 502, { error: 'audio: ' + err.message }); return; }
      respond(res, 200, { ok: true, audio: '/api/aclip?id=' + id });
    });
    return;
  }

  if (p === '/api/aclip') {
    const id = (url.searchParams.get('id') || '').trim();
    if (!/^[\w-]{6,20}$/.test(id)) { respond(res, 400, { error: 'falta ?id= válido' }); return; }
    streamLocalFile(req, res, path.join(AUDIO_DIR, id + '.m4a'), 'audio/mp4');
    return;
  }

  if (p === '/api/download') {
    const u = url.searchParams.get('u') || '';
    const nombre = (url.searchParams.get('nombre') || 'archivo').replace(/[\/\\:*?"<>|]/g, '_').slice(0, 120);
    if (!u) { respond(res, 400, { error: 'falta ?u=' }); return; }
    proxyGet(u, { 'User-Agent': UA, 'Accept-Encoding': 'identity' }, (err, status, body) => {
      if (err) { respond(res, 502, { error: 'download: ' + err.message }); return; }
      if (status >= 400) { respond(res, 502, { error: 'download HTTP ' + status }); return; }
      try {
        fs.mkdirSync(DESCARGAS_DIR, { recursive: true });
        const dest = path.join(DESCARGAS_DIR, nombre);
        fs.writeFileSync(dest, body);
        log('download OK ' + dest + ' (' + body.length + ' bytes)');
        respond(res, 200, { ok: true, ruta: dest, bytes: body.length });
      } catch (e) { respond(res, 500, { error: 'download write: ' + e.message }); }
    });
    return;
  }

  if (p === '/api/radio') {
    const seed = (url.searchParams.get('seed') || '').trim();
    const n = Math.min(Math.max(parseInt(url.searchParams.get('n') || '25', 10) || 25, 1), 50);
    if (!seed) { respond(res, 400, { error: 'falta ?seed=' }); return; }
    ytmusic.radio(seed, n, (err, tracks) => {
      if (err) { respond(res, 502, { error: 'radio: ' + err.message }); return; }
      respond(res, 200, { ok: true, tracks });
    });
    return;
  }

  if (p === '/api/cookies' && req.method === 'GET') {
    try {
      const data = await cookies.read();
      respond(res, 200, data);
    } catch (e) { respond(res, 502, { error: 'cookies: ' + e.message }); }
    return;
  }

  if (p === '/api/cookies' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.youtube) { respond(res, 400, { error: 'falta youtube' }); return; }
      const data = await cookies.store({ youtube: body.youtube });
      await ensureCookiesFile(true);
      respond(res, 200, data);
    } catch (e) { respond(res, 400, { error: 'cookies store: ' + e.message }); }
    return;
  }

  // Cookie Keeper (Plan B): el navegador remoto vive en el backend.
  if (p === '/api/cookies/status') {
    respond(res, 200, await browser.status(cookies));
    return;
  }

  if (p === '/api/cookies/refresh') {
    try {
      const data = await browser.refresh(cookies);
      await ensureCookiesFile(true);
      respond(res, 200, data);
    } catch (e) { respond(res, 502, { error: 'refresh: ' + e.message }); }
    return;
  }

  if (p === '/api/browser/session' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      let startUrl = url.searchParams.get('url') || '';
      if (req.method === 'POST') {
        try { const b = JSON.parse((await readBody(req)) || '{}'); if (b.url) startUrl = b.url; } catch (e) {}
      }
      const s = await browser.startSession(startUrl || undefined);
      respond(res, 200, { ok: true, sid: s.sid, url: s.url });
    } catch (e) { respond(res, 502, { error: 'session: ' + e.message }); }
    return;
  }

  if (p === '/api/browser/close' && req.method === 'POST') {
    try { const b = JSON.parse((await readBody(req)) || '{}'); if (b.sid) browser.closeSession(b.sid); respond(res, 200, { ok: true }); }
    catch (e) { respond(res, 400, { error: e.message }); }
    return;
  }

  respond(res, 404, { error: '404 ' + p });
});

// ── WebSocket del navegador remoto ───────────────────────────────────
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  let url;
  try { url = new URL(req.url, 'http://' + HOST + ':' + PORT); } catch (e) { socket.destroy(); return; }
  if (url.pathname !== '/ws/browser') { socket.destroy(); return; }
  const token = url.searchParams.get('token') || '';
  const auth = await verifyToken(token);
  if (!auth.ok) { try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch (e) {} socket.destroy(); return; }
  const sid = url.searchParams.get('sid') || '';
  wss.handleUpgrade(req, socket, head, (ws) => browser.attachWs(sid, ws));
});

server.listen(PORT, HOST, () => {
  log('QP Bajar API on http://' + HOST + ':' + PORT);
});
process.on('uncaughtException', (e) => { log('uncaught ' + (e && e.message)); });
process.on('unhandledRejection', (e) => { log('unhandled ' + (e && e.message)); });
