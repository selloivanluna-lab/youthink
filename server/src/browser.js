'use strict';
// Remote browser (Plan B del Cookie Keeper): Chromium persistente en un volumen.
// El usuario loguea UNA vez por una sesión remota (screencast CDP + input por WS);
// el perfil queda guardado y luego el refresh (headless) extrae y cifra las cookies.
const fs = require('fs');
const path = require('path');

const PROFILE_DIR = process.env.BROWSER_PROFILE_DIR || '/data/profile';
const DESKTOP_UA = process.env.BROWSER_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Sesiones interactivas vivas: sid -> { page, cdp, clients:Set, frameCount }
const sessions = new Map();

let ctxPromise = null;
let chromium = null;
function pw() {
  if (!chromium) chromium = require('playwright').chromium;
  return chromium;
}

async function getContext() {
  if (!ctxPromise) {
    ctxPromise = (async () => {
      try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) {}
      return pw().launchPersistentContext(PROFILE_DIR, {
        headless: process.env.BROWSER_HEADLESS === '1',
        viewport: { width: 412, height: 820 },
        deviceScaleFactor: 1,
        userAgent: DESKTOP_UA,
        locale: 'es-AR',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'],
      });
    })();
  }
  return ctxPromise;
}

// ── cookies → formato Netscape (el que consume el plugin CEP y yt-dlp) ──
function toNetscape(cookies) {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
  ];
  for (const c of cookies) {
    const domain = c.domain || '';
    const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expires = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    lines.push([domain, includeSub, c.path || '/', secure, expires, c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

function relevant(c) {
  const d = (c.domain || '').replace(/^\./, '');
  return /youtube\.com$/.test(d) || /google\.com$/.test(d) || d === 'youtu.be';
}

// Refresh headless: abre youtube.com, extrae cookies de sesión y las cifra en Supabase.
async function refresh(cookiesStore) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    let loggedIn = false;
    try {
      await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      loggedIn = await page.evaluate(() => {
        try { return !!document.querySelector('#avatar-btn, button[aria-label*="cuenta" i], ytd-topbar-menu-button-renderer'); }
        catch (e) { return false; }
      });
    } catch (e) { /* seguimos con lo que haya */ }

    const all = await ctx.cookies();
    const yt = all.filter(relevant);
    if (!yt.length) throw new Error('no hay cookies de YouTube en el perfil (¿falta iniciar sesión?)');
    // Guard: no sobrescribir una sesión válida con un perfil sin login.
    const names = new Set(yt.map((c) => c.name));
    const hasSession = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO', 'SAPISID'].some((n) => names.has(n));
    if (!hasSession) throw new Error('el navegador remoto no tiene sesión iniciada: iniciá sesión primero');
    const netscape = toNetscape(yt);
    const res = await cookiesStore.store({ youtube: netscape });
    return { ...res, cookies: yt.length, logueado: loggedIn };
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

// ── sesión interactiva (login remoto) ────────────────────────────────
async function startSession(startUrl) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sess = { sid, page, cdp, clients: new Set(), frameCount: 0 };
  sessions.set(sid, sess);

  cdp.on('Page.screencastFrame', async (ev) => {
    sess.frameCount++;
    const payload = JSON.stringify({ t: 'f', data: ev.data, w: (ev.metadata && ev.metadata.deviceWidth) || 0, h: (ev.metadata && ev.metadata.deviceHeight) || 0 });
    for (const ws of sess.clients) { try { if (ws.readyState === 1) ws.send(payload); } catch (e) {} }
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch (e) {}
  });
  cdp.on('Page.frameNavigated', async () => { try { await startCast(sess); } catch (e) {} });
  page.on('close', () => closeSession(sid));

  await page.goto(startUrl || 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await startCast(sess);
  return { sid, url: page.url() };
}

async function startCast(sess) {
  await sess.cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 55, maxWidth: 480, maxHeight: 960, everyNthFrame: 1,
  });
}

function attachWs(sid, ws) {
  const sess = sessions.get(sid);
  if (!sess) { try { ws.send(JSON.stringify({ t: 'err', error: 'sesión inexistente' })); } catch (e) {} ws.close(); return; }
  sess.clients.add(ws);
  try { ws.send(JSON.stringify({ t: 'ready', sid })); } catch (e) {}

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
    try { await dispatch(sess, m); } catch (e) {}
  });
  ws.on('close', () => { sess.clients.delete(ws); });

  // Kick: fuerza un frame nuevo cuando entra un cliente.
  sess.cdp.send('Page.screencastFrameAck', { sessionId: 0 }).catch(() => {});
  startCast(sess).catch(() => {});
}

async function dispatch(sess, m) {
  const cdp = sess.cdp;
  const x = Math.round(m.x || 0), y = Math.round(m.y || 0);
  switch (m.t) {
    case 'mv':
      return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    case 'click':
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      return;
    case 'wheel':
      return cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: m.dx || 0, deltaY: m.dy || 0 });
    case 'text':
      return cdp.send('Input.insertText', { text: String(m.text || '') });
    case 'enter':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
      return cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    case 'backspace':
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' });
      return cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, key: 'Backspace', code: 'Backspace' });
    case 'nav':
      return sess.page.goto(String(m.url || ''), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    case 'back':
      return sess.page.goBack().catch(() => {});
    default:
      return;
  }
}

function closeSession(sid) {
  const sess = sessions.get(sid);
  if (!sess) return;
  sessions.delete(sid);
  for (const ws of sess.clients) { try { ws.close(); } catch (e) {} }
  try { sess.page.close(); } catch (e) {}
}

async function closeAll() {
  for (const sid of Array.from(sessions.keys())) closeSession(sid);
}

async function status(cookiesStore) {
  try {
    const data = await cookiesStore.read();
    const c = (data && data.cookies) || {};
    return { ok: true, tiene_cookies: !!c.youtube, _renovado: c._renovado || 0, _expira: c._expira || 0, sesiones: sessions.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { getContext, refresh, startSession, attachWs, closeSession, closeAll, status, toNetscape, PROFILE_DIR };
