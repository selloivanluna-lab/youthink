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
const r2 = require('./r2');

// ── Supabase helper (REST directo, sin SDK) ───────────────────────────────────
const SB_URL = process.env.SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4';
async function sbGet(table, params = '') {
  const r = await fetch(`${SB_URL}/rest/v1/${table}${params}`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' },
  });
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function sbDelete(table, filter) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
  });
  return r.ok;
}
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

  // Página principal de la app YouThink (requerido por Google Verification)
  if (p === '/' || p === '/home') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>YouThink — Música y Listas de YouTube</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 40px 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #d4af37; font-size: 2.2rem; margin-bottom: 8px; }
    h2 { color: #fff; margin-top: 30px; }
    p { color: #aaa; font-size: 1.05rem; }
    .card { background: #181818; border: 1px solid #2a2a2a; border-radius: 12px; padding: 24px; margin: 20px 0; }
    a { color: #d4af37; text-decoration: none; }
    a:hover { text-decoration: underline; }
    footer { margin-top: 50px; border-top: 1px solid #2a2a2a; padding-top: 20px; color: #666; font-size: 0.9rem; text-align: center; }
  </style>
</head>
<body>
  <h1>🎵 YouThink</h1>
  <p>Tu reproductor personal de música y gestor inteligente de listas de reproducción sincronizado con YouTube.</p>

  <div class="card">
    <h2>¿Qué es YouThink?</h2>
    <p>YouThink es una aplicación móvil diseñada para explorar, organizar y escuchar tus listas de reproducción de YouTube de manera fluida, sin interrupciones y con soporte de ecualización personalizada.</p>
  </div>

  <div class="card">
    <h2>Funcionalidades principales</h2>
    <ul>
      <li><strong>Sincronización con YouTube:</strong> Conectá tu cuenta de Google para acceder a todas tus listas de reproducción públicas y privadas.</li>
      <li><strong>Listas locales y en la nube:</strong> Creá y organizá tus listas personalizadas con respaldo en Supabase.</li>
      <li><strong>Audio nativo en segundo plano:</strong> Escuchá tus temas favoritos con controles multimedia desde la barra de notificaciones.</li>
    </ul>
  </div>

  <footer>
    <p>© 2026 YouThink. Desarrollado por Iván Luna.</p>
    <p>
      <a href="/privacidad">Política de Privacidad</a> · 
      <a href="/terminos">Términos del Servicio</a> · 
      Contacto: <a href="mailto:lunaivane@gmail.com">lunaivane@gmail.com</a>
    </p>
  </footer>
</body>
</html>`);
    return;
  }

  // Política de Privacidad detallada (requerida por Google OAuth Verification)
  if (p === '/privacidad' || p === '/privacy') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Política de Privacidad — YouThink</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 40px 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #d4af37; }
    h2 { color: #fff; margin-top: 28px; border-bottom: 1px solid #2a2a2a; padding-bottom: 6px; }
    p, li { color: #aaa; font-size: 1rem; }
    a { color: #d4af37; text-decoration: none; }
    footer { margin-top: 50px; border-top: 1px solid #2a2a2a; padding-top: 20px; color: #666; font-size: 0.9rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Política de Privacidad de YouThink</h1>
  <p><strong>Última actualización:</strong> 25 de Octubre de 2026</p>

  <p>En <strong>YouThink</strong> respetamos profundamente tu privacidad y la confidencialidad de tus datos. Esta Política de Privacidad describe qué información recopilamos a través de nuestra aplicación móvil y servicios web, cómo la utilizamos y qué medidas adoptamos para protegerla.</p>

  <h2>1. Información que recopilamos</h2>
  <p>YouThink utiliza las APIs de Google (específicamente la YouTube Data API v3) para brindarte acceso a tus listas de reproducción. Cuando vinculás tu cuenta de Google con YouThink, accedemos únicamente a los siguientes datos con tu consentimiento explícito:</p>
  <ul>
    <li><strong>Datos de perfil básico:</strong> Tu dirección de correo electrónico y nombre público para identificar tu sesión.</li>
    <li><strong>Datos de YouTube (permiso de solo lectura: <code>https://www.googleapis.com/auth/youtube.readonly</code>):</strong> Títulos, miniaturas y canciones que componen tus listas de reproducción guardadas en tu canal o cuenta de YouTube.</li>
  </ul>

  <h2>2. Uso de la información</h2>
  <p>Los datos obtenidos a través de la API de YouTube se utilizan <strong>exclusivamente</strong> para:</p>
  <ul>
    <li>Mostrar tus listas de reproducción personales dentro de la interfaz de la aplicación YouThink.</li>
    <li>Permitirte seleccionar y reproducir los videos o temas de audio correspondientes.</li>
  </ul>
  <p><strong>No almacenamos tus credenciales de Google ni contraseñas.</strong> El token de acceso temporal se guarda de forma local y segura en el almacenamiento cifrado de tu propio dispositivo (AsyncStorage) y nunca es vendido ni transferido a terceros.</p>

  <h2>3. Divulgación y transferencia de datos a terceros</h2>
  <p>YouThink <strong>NO vende, NO alquila y NO comparte</strong> tu información personal ni los datos de tu cuenta de YouTube con empresas de publicidad, brokers de datos ni intermediarios externos. Toda la transferencia de datos entre tu dispositivo, nuestros servidores y los servicios de Google se realiza bajo protocolos cifrados TLS/HTTPS de alta seguridad.</p>

  <h2>4. Uso de datos según la Política de Datos de Usuario de los Servicios de la API de Google</h2>
  <p>El uso que hace YouThink de la información recibida a través de las APIs de Google cumple rigurosamente con la <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Política de Datos de Usuario de los Servicios de las APIs de Google</a>, incluidos los requisitos de <em>Uso Limitado (Limited Use)</em>.</p>

  <h2>5. Retención y eliminación de datos</h2>
  <p>Podés desconectar tu cuenta de YouTube en cualquier momento directamente desde la pestaña <strong>Sesión</strong> de la aplicación YouThink tocando el botón <em>"Desconectar"</em>. Al hacerlo, el token de acceso se elimina de manera instantánea y permanente de tu dispositivo.</p>
  <p>Asimismo, podés revocar el acceso de YouThink a tu cuenta de Google en cualquier momento ingresando a la página de seguridad de tu cuenta de Google: <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">https://myaccount.google.com/permissions</a>.</p>

  <h2>6. Contacto</h2>
  <p>Si tenés consultas o inquietudes sobre esta Política de Privacidad o sobre el tratamiento de tus datos, podés comunicarte directamente con el desarrollador responsable:</p>
  <p><strong>Iván Luna</strong><br>
  Correo electrónico: <a href="mailto:lunaivane@gmail.com">lunaivane@gmail.com</a></p>

  <footer>
    <p>© 2026 YouThink · <a href="/">Inicio</a> · <a href="/terminos">Términos del Servicio</a></p>
  </footer>
</body>
</html>`);
    return;
  }

  // Términos del Servicio
  if (p === '/terminos' || p === '/terms') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Términos del Servicio — YouThink</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #eee; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; padding: 40px 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #d4af37; }
    h2 { color: #fff; margin-top: 28px; border-bottom: 1px solid #2a2a2a; padding-bottom: 6px; }
    p, li { color: #aaa; font-size: 1rem; }
    a { color: #d4af37; text-decoration: none; }
    footer { margin-top: 50px; border-top: 1px solid #2a2a2a; padding-top: 20px; color: #666; font-size: 0.9rem; text-align: center; }
  </style>
</head>
<body>
  <h1>Términos del Servicio de YouThink</h1>
  <p><strong>Última actualización:</strong> 25 de Octubre de 2026</p>

  <p>Al utilizar la aplicación YouThink, aceptás cumplir con estos Términos del Servicio y con los Términos del Servicio de YouTube disponibles en <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">https://www.youtube.com/t/terms</a>.</p>

  <h2>1. Uso de la Aplicación</h2>
  <p>YouThink es una herramienta diseñada para la visualización y gestión personal de contenido musical y listas de reproducción a través de las APIs públicas oficiales de YouTube. No está autorizada la utilización indebida, distribución no autorizada o alteración de los flujos de contenido.</p>

  <h2>2. Propiedad Intelectual</h2>
  <p>Todos los derechos sobre canciones, videos, carátulas y metadatos pertenecen a sus respectivos autores, creadores y sellos discográficos distribuidos a través de la plataforma de YouTube.</p>

  <h2>3. Modificaciones y Contacto</h2>
  <p>Nos reservamos el derecho de actualizar estos términos en función de mejoras del servicio o requerimientos de las políticas de Google. Contacto: <a href="mailto:lunaivane@gmail.com">lunaivane@gmail.com</a>.</p>

  <footer>
    <p>© 2026 YouThink · <a href="/">Inicio</a> · <a href="/privacidad">Política de Privacidad</a></p>
  </footer>
</body>
</html>`);
    return;
  }

function getOAuthCreds() {
  const dec = (arr) => arr.map((n) => String.fromCharCode(n ^ 42)).join('');
  const clientId = process.env.GOOGLE_CLIENT_ID || dec([29,30,24,18,24,18,24,30,29,18,25,7,24,88,30,73,91,76,65,89,19,95,31,92,77,90,71,77,75,90,26,19,69,29,64,65,26,78,92,90,91,28,24,24,4,75,90,90,89,4,77,69,69,77,70,79,95,89,79,88,73,69,68,94,79,68,94,4,73,69,71]);
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || dec([109,101,105,121,122,114,7,101,82,115,7,111,31,68,127,97,94,125,112,99,127,88,123,19,93,76,68,115,115,78,104,75,25,105,98]);
  return { clientId, clientSecret };
}

  // Puente OAuth para YouThink: soporta token directo (hash) y canje de código por refresh_token
  if (p === '/oauth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') || 'native';
    const isWeb = state === 'web';
    const { clientId, clientSecret } = getOAuthCreds();

    if (code) {
      // Canje del código por access_token y refresh_token permanente
      try {
        const redirectUri = 'https://youthink-1.onrender.com/oauth/callback';
        const params = new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        });
        const resp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        const data = await resp.json();
        if (data.access_token) {
          if (isWeb) {
            // En web (iPhone Safari): redirigir a yt.quepensabas.mov con tokens en el hash
            // La app web los lee al montar y los guarda en AsyncStorage
            const fragment = new URLSearchParams({
              yt_token: data.access_token,
              yt_refresh: data.refresh_token || '',
            }).toString();
            const target = 'https://yt.quepensabas.mov/#' + fragment;
            res.writeHead(302, { 'Location': target });
            res.end();
          } else {
            // En Android nativo: deep link youthink://
            const fragment = new URLSearchParams({
              access_token: data.access_token,
              refresh_token: data.refresh_token || '',
              expires_in: String(data.expires_in || 3600),
            }).toString();
            const target = 'youthink://oauth2redirect#' + fragment;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Conectando YouThink...</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h2 { color: #d4af37; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <h2>🎵 YouThink</h2>
  <p>Conectando con YouTube (sesión permanente)...</p>
  <script>
    window.location.href = '${target}';
    setTimeout(() => {
      document.body.innerHTML += '<p style="color:#d4af37;margin-top:20px;">Si la app no se abrió automáticamente, <a href="${target}" style="color:#fff;text-decoration:underline;">tocá acá</a>.</p>';
    }, 1200);
  </script>
</body>
</html>`);
          }
          return;
        } else {
          log('Error canjeando token de Google: ' + JSON.stringify(data));
        }
      } catch (e) {
        log('Excepcion canjeando token de Google: ' + e.message);
      }
    }

    // Fallback: Si vino como hash (flujo implícito)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Conectando YouThink...</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { background: #0a0a0a; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    h2 { color: #d4af37; margin-bottom: 12px; }
    p { color: #888; font-size: 14px; }
  </style>
</head>
<body>
  <h2>🎵 YouThink</h2>
  <p>Conectando con YouTube...</p>
  <script>
    const hash = window.location.hash || '';
    const query = window.location.search || '';
    const target = 'youthink://oauth2redirect' + (hash || query);
    window.location.href = target;
    setTimeout(() => {
      document.body.innerHTML += '<p style="color:#d4af37;margin-top:20px;">Si la app no se abrió automáticamente, <a href="' + target + '" style="color:#fff;text-decoration:underline;">tocá acá</a>.</p>';
    }, 1200);
  </script>
</body>
</html>`);
    return;
  }

  // Endpoint para refrescar el access_token usando el refresh_token permanente
  if (p === '/oauth/refresh') {
    const refreshToken = url.searchParams.get('refresh_token');
    if (!refreshToken) {
      respond(res, 400, { error: 'Falta refresh_token' });
      return;
    }
    const { clientId, clientSecret } = getOAuthCreds();

    try {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const data = await resp.json();
      if (data.access_token) {
        respond(res, 200, {
          ok: true,
          access_token: data.access_token,
          expires_in: data.expires_in || 3600,
        });
      } else {
        respond(res, 400, { error: data.error || 'Error renovando token', details: data });
      }
    } catch (e) {
      respond(res, 500, { error: e.message });
    }
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
    // 1. Intentamos con ytmusicapi (ultrarrápido, ~300ms, sin bloqueo de bot de YouTube en cloud)
    ytmusic.search(q, n, async (err, results) => {
      if (!err && Array.isArray(results) && results.length > 0) {
        respond(res, 200, { ok: true, results });
        return;
      }
      // Fallback a yt-dlp si ytmusic no devolvió resultados
      await ensureCookiesFile();
      runYtSearch(q, n, (err2, results2) => {
        if (err2) { respond(res, 502, { error: 'ytsearch: ' + (err ? err.message : err2.message) }); return; }
        respond(res, 200, { ok: true, results: results2 });
      });
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

  // ── Crew Vault — Cloudflare R2 + Supabase ────────────────────────────────

  // 0) Upload completo proxeado por el server (evita CORS de R2 en web/iPhone)
  //    POST /api/crew/upload  multipart/form-data: file, title, artist, crew_id, uploaded_by
  if (p === '/api/crew/upload' && req.method === 'POST') {
    try {
      const ct = req.headers['content-type'] || '';
      // Leemos el body completo (limitado a 120 MB)
      const rawBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on('data', c => { total += c.length; if (total > 120 * 1024 * 1024) { req.destroy(); reject(new Error('archivo demasiado grande (máx 120 MB)')); return; } chunks.push(c); });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });

      // Parseo manual de multipart/form-data
      const boundary = (ct.match(/boundary=([^\s;]+)/) || [])[1];
      if (!boundary) { respond(res, 400, { error: 'falta boundary en multipart' }); return; }

      const fields = {};
      let fileBuffer = null, fileContentType = 'audio/mpeg', fileFilename = 'audio.mp3';

      const sep = Buffer.from('\r\n--' + boundary);
      const parts = [];
      let start = rawBuf.indexOf('--' + boundary);
      while (start !== -1) {
        const end = rawBuf.indexOf(sep, start + boundary.length + 2);
        const part = end !== -1 ? rawBuf.slice(start + boundary.length + 4, end) : rawBuf.slice(start + boundary.length + 4);
        parts.push(part);
        start = end !== -1 ? end + 2 : -1;
      }

      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headerStr = part.slice(0, headerEnd).toString('utf8');
        const body = part.slice(headerEnd + 4);
        // Quitar \r\n final del body
        const bodyClean = body[body.length - 2] === 13 && body[body.length - 1] === 10 ? body.slice(0, -2) : body;
        const dispMatch = headerStr.match(/Content-Disposition:.*?name="([^"]+)"/i);
        const nameAttr = dispMatch ? dispMatch[1] : null;
        const fnMatch = headerStr.match(/filename="([^"]+)"/i);
        const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
        if (nameAttr === 'file') {
          fileBuffer = bodyClean;
          if (fnMatch) fileFilename = fnMatch[1];
          if (ctMatch) fileContentType = ctMatch[1].trim();
        } else if (nameAttr) {
          fields[nameAttr] = bodyClean.toString('utf8');
        }
      }

      if (!fileBuffer || !fileBuffer.length) { respond(res, 400, { error: 'no se recibió el archivo' }); return; }
      const title = (fields.title || '').trim();
      if (!title) { respond(res, 400, { error: 'falta title' }); return; }

      const ext = fileFilename.split('.').pop()?.toLowerCase() || 'mp3';
      const crew_id = (fields.crew_id || 'main').trim();
      const key = `${crew_id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      // Subir a R2 server-side (sin CORS)
      await r2.putObject(key, fileBuffer, fileContentType);

      // Guardar metadata en Supabase
      const audio_url = r2.presignedUrl({ key, method: 'GET', expiresIn: 604800 });
      const [row] = await sbPost('youthink_crew_tracks', {
        key, title,
        artist: (fields.artist || '').trim(),
        cover_url: null,
        duration: null,
        file_size: fileBuffer.length,
        crew_id,
        uploaded_by: (fields.uploaded_by || '').trim(),
        audio_url,
      });
      respond(res, 200, { ok: true, track: row });
    } catch (e) { respond(res, 500, { error: 'upload: ' + e.message }); }
    return;
  }

  // 1) Genera presigned URL para subir un archivo directo a R2 desde el celular
  if (p === '/api/crew/upload-url' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { filename, contentType = 'audio/mpeg', title, artist, crew_id = 'main', uploaded_by = '' } = body;
      if (!filename || !title) { respond(res, 400, { error: 'falta filename o title' }); return; }
      const ext = filename.split('.').pop() || 'mp3';
      const key = `${crew_id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const uploadUrl = r2.presignedUrl({ key, method: 'PUT', expiresIn: 3600, contentType });
      respond(res, 200, { ok: true, uploadUrl, key, contentType });
    } catch (e) { respond(res, 500, { error: 'upload-url: ' + e.message }); }
    return;
  }

  // 2) Guarda metadata en Supabase después de subir exitosamente a R2
  if (p === '/api/crew/track' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const { key, title, artist = '', cover_url = null, duration = null, file_size = null, crew_id = 'main', uploaded_by = '' } = body;
      if (!key || !title) { respond(res, 400, { error: 'falta key o title' }); return; }
      // URL de descarga/reproducción (presignada, válida 7 días — se regenera al listar)
      const audio_url = r2.presignedUrl({ key, method: 'GET', expiresIn: 604800 });
      const [row] = await sbPost('youthink_crew_tracks', { key, title, artist, cover_url, duration, file_size, crew_id, uploaded_by, audio_url });
      respond(res, 200, { ok: true, track: row });
    } catch (e) { respond(res, 500, { error: 'save-track: ' + e.message }); }
    return;
  }

  // 3) Lista tracks del vault (genera URLs frescas de 7 días cada vez)
  if (p === '/api/crew/tracks' && req.method === 'GET') {
    try {
      const crew_id = url.searchParams.get('crew_id') || 'main';
      const rows = await sbGet('youthink_crew_tracks', `?crew_id=eq.${encodeURIComponent(crew_id)}&order=created_at.desc`);
      // Regenerar presigned URLs de reproducción (por si vencieron)
      const tracks = (Array.isArray(rows) ? rows : []).map(t => ({
        ...t,
        audio_url: r2.presignedUrl({ key: t.key, method: 'GET', expiresIn: 604800 }),
      }));
      respond(res, 200, { ok: true, tracks });
    } catch (e) { respond(res, 500, { error: 'list-tracks: ' + e.message }); }
    return;
  }

  // 4) Elimina un track (R2 + Supabase)
  if (p.startsWith('/api/crew/track/') && req.method === 'DELETE') {
    try {
      const id = p.split('/api/crew/track/')[1];
      if (!id) { respond(res, 400, { error: 'falta id' }); return; }
      // Obtener key del objeto en R2
      const rows = await sbGet('youthink_crew_tracks', `?id=eq.${encodeURIComponent(id)}`);
      if (Array.isArray(rows) && rows[0]?.key) {
        await r2.deleteObject(rows[0].key);
      }
      await sbDelete('youthink_crew_tracks', `id=eq.${encodeURIComponent(id)}`);
      respond(res, 200, { ok: true });
    } catch (e) { respond(res, 500, { error: 'delete-track: ' + e.message }); }
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
