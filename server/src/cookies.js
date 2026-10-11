'use strict';
// Cookie Keeper: guarda/lee la sesión de YouTube cifrada en Supabase.
// Formato almacenado en `notas`:
//   { enc: "<base64>", _renovado: <unix>, _expira: <unix>, _plataforma: "youtube" }
// `enc` descifrado = { youtube: "<Netscape txt>" }
const { encrypt, decrypt } = require('./crypto');
const { getCookiesRow, upsertCookiesRow } = require('./supabase');

// Expiración más próxima (unix) leyendo el .txt Netscape. Igual que renovar-cookies.ps1.
function expiracionMasProxima(netscape) {
  const lines = String(netscape || '').split(/\r?\n/);
  let min = 0;
  for (const ln of lines) {
    if (!ln || ln[0] !== '.') continue;
    const parts = ln.split('\t');
    const exp = parseInt(parts[4], 10);
    if (exp > 0) min = (min === 0 || exp < min) ? exp : min;
  }
  return min;
}

function esNetscape(txt) {
  return typeof txt === 'string' && txt.indexOf('Netscape') >= 0;
}

// Normaliza a string. Filas viejas guardaron un objeto PowerShell (FileInfo con .value).
function aTexto(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  if (v && typeof v === 'object' && typeof v.value === 'string') return v.value;
  return v == null ? '' : String(v);
}

// Body de la app: { youtube: "<Netscape txt>" }
async function store({ youtube }) {
  if (!esNetscape(youtube)) throw new Error('cookie youtube inválida (falta el header Netscape)');
  const plain = JSON.stringify({ youtube });
  const payload = {
    enc: encrypt(plain),
    _renovado: Math.floor(Date.now() / 1000),
    _expira: expiracionMasProxima(youtube),
    _plataforma: 'youtube',
  };
  const res = await upsertCookiesRow(payload);
  return { ok: true, _renovado: payload._renovado, _expira: payload._expira, ...res };
}

// Devuelve la forma que ya consume el plugin CEP: { youtube, _renovado, _expira }
async function read() {
  const row = await getCookiesRow();
  if (!row || !row.notas) return { ok: true, cookies: {} };
  let notas;
  try { notas = JSON.parse(row.notas); } catch (e) { return { ok: true, cookies: {} }; }

  // Compatibilidad: filas viejas en texto plano (sin `enc`).
  if (!notas.enc) {
    const { enc, ...plain } = notas;
    if ('youtube' in plain) plain.youtube = aTexto(plain.youtube);
    return { ok: true, cookies: plain };
  }

  let inner;
  try { inner = JSON.parse(decrypt(notas.enc)); } catch (e) {
    throw new Error('no se pudo descifrar las cookies');
  }
  return {
    ok: true,
    cookies: {
      ...inner,
      _renovado: notas._renovado || 0,
      _expira: notas._expira || 0,
    },
  };
}

module.exports = { store, read };
