'use strict';
const http = require('http');
const https = require('https');

// Verifica un token crudo (sin el prefijo Bearer). Reusable por HTTP y WS.
async function verifyToken(token) {
  if (!token) return { ok: false, status: 401, error: 'missing_token' };
  if (process.env.QP_TOKEN && token === process.env.QP_TOKEN) {
    return { ok: true, via: 'shared' };
  }
  const url = process.env.SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (anon) {
    try {
      const u = new URL(url + '/auth/v1/user');
      const body = await getJSON(u, { apikey: anon, Authorization: 'Bearer ' + token });
      if (body && (body.email || body.id)) return { ok: true, via: 'supabase', email: body.email };
    } catch (e) {}
  }
  return { ok: false, status: 401, error: 'invalid_token' };
}

// Auth de las rutas: acepta el token compartido (QP_TOKEN) o un JWT de Supabase.
async function requireAuth(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return verifyToken(token);
}

function getJSON(u, headers) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const r = lib.request(u, { method: 'GET', headers }, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        if (resp.statusCode < 200 || resp.statusCode >= 300) return reject(new Error('HTTP ' + resp.statusCode));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.end();
  });
}

module.exports = { requireAuth, verifyToken };
