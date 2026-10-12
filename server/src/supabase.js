'use strict';
// Acceso a Supabase para la fila central de cookies.
// Usar SIEMPRE la service role key del lado servidor: es el único escritor/lector.
const ROW = '__QP_CONFIG_BAJAR_COOKIES__';
const CONFIG_UID = process.env.CONFIG_USER_ID || '9dd9fe61-d95e-436a-9497-2aedc784df34';

function cfg() {
  return {
    url: process.env.SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co',
    // La service role key es lo ideal (lectura+escritura). Si falta, cae a la
    // anon/publishable key (pública, ya viaja en el bundle del cliente): alcanza
    // para LEER la fila de cookies y pasárselas a yt-dlp.
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY ||
      'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4',
  };
}

async function sb(pathname, opts) {
  const { url, key } = cfg();
  if (!key) throw new Error('falta SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(url + pathname, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(opts && opts.headers),
    },
  });
  return r;
}

async function getCookiesRow() {
  const r = await sb(`/rest/v1/events?cliente=eq.${ROW}&select=id,notas&limit=1`);
  if (!r.ok) throw new Error('supabase get HTTP ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0] : null;
}

// notasObj -> se serializa en el campo `notas`.
async function upsertCookiesRow(notasObj) {
  const notas = JSON.stringify(notasObj);
  const existing = await getCookiesRow();
  if (existing) {
    const r = await sb(`/rest/v1/events?id=eq.${existing.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ notas }),
    });
    if (!r.ok) throw new Error('supabase patch HTTP ' + r.status);
    return { id: existing.id, created: false };
  }
  const r = await sb('/rest/v1/events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: CONFIG_UID,
      date: '2026-01-01',
      cliente: ROW,
      tipo: 'CONFIG',
      precio: 0,
      pago_realizado: 0,
      estado: 'confirmado',
      notas,
    }),
  });
  if (!r.ok) throw new Error('supabase post HTTP ' + r.status);
  return { created: true };
}

module.exports = { getCookiesRow, upsertCookiesRow, ROW };
