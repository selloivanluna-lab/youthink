import { API_URL, QP_TOKEN } from '../config';

export type YtResult = {
  id: string;
  title: string;
  url: string;
  duration: number;
  channel: string;
  thumb: string;
};

export type CookieStatus = {
  ok: boolean;
  tiene_cookies: boolean;
  _renovado: number;
  _expira: number;
  sesiones: number;
};

export type BrowserSession = { ok: boolean; sid: string; url: string };

function authHeaders(): Record<string, string> {
  return {
    Authorization: 'Bearer ' + QP_TOKEN,
    'Content-Type': 'application/json',
  };
}

async function getJson<T>(path: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r: Response;
    try {
      r = await fetch(API_URL + path, { headers: authHeaders(), signal: ctrl.signal, cache: 'no-store' });
    } catch (e: any) { throw friendlyNetError(e); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as any)?.error || 'HTTP ' + r.status);
    return data as T;
  } finally { clearTimeout(t); }
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r: Response;
    try {
      r = await fetch(API_URL + path, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store',
      });
    } catch (e: any) { throw friendlyNetError(e); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as any)?.error || 'HTTP ' + r.status);
    return data as T;
  } finally { clearTimeout(t); }
}

// Traduce timeouts y fallos de red a mensajes claros (evita "signal is aborted without reason").
function friendlyNetError(e: any): Error {
  if (e?.name === 'AbortError') {
    return new Error('El servidor tardó demasiado (puede estar despertando). Esperá unos segundos y reintentá.');
  }
  return new Error('No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
}

// Reintenta con backoff progresivo. Útil para cold starts del server Fly (~3-4s de arranque).
async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 1500): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      // No reintentar si fue un abort intencional (timeout)
      if (e?.name === 'AbortError' && i === tries - 1) throw lastErr;
      await new Promise((r) => setTimeout(r, baseMs * (i + 1))); // 1.5s, 3s, 4.5s
    }
  }
  throw lastErr;
}

export type CrewTrack = {
  id: string;
  crew_id: string;
  uploaded_by: string;
  title: string;
  artist: string;
  audio_url: string;
  cover_url: string | null;
  duration: number | null;
  file_size: number | null;
  key: string;
  created_at: string;
};

export const api = {
  health: () => getJson<{ ok: boolean; ytdlp: boolean; ffmpeg: boolean; deno: boolean }>('/api/health', 8000),

  search: (q: string, n = 15) =>
    withRetry(() => getJson<{ ok: boolean; results: YtResult[] }>(`/api/ytsearch?q=${encodeURIComponent(q)}&n=${n}`, 25000)),

  // preview necesita yt-dlp + ffmpeg — puede demorar hasta 60s en servidor cloud
  preview: (id: string) =>
    withRetry(() => getJson<{ ok: boolean; clip: string }>(`/api/ytpreview?id=${encodeURIComponent(id)}`, 75000), 2, 2000),

  // URL absoluta para expo-video. El token va en la URL (los reproductores no mandan headers).
  clipUrl: (id: string) => `${API_URL}/api/clip?id=${encodeURIComponent(id)}&token=${encodeURIComponent(QP_TOKEN)}`,

  // Modo solo audio (ahorra datos en 4G). Reintenta por si el server está despertando (cold start).
  previewAudio: (id: string) =>
    withRetry(() => getJson<{ ok: boolean; audio: string }>(`/api/audio?id=${encodeURIComponent(id)}`, 30000)),
  audioClipUrl: (id: string) =>
    `${API_URL}/api/aclip?id=${encodeURIComponent(id)}&token=${encodeURIComponent(QP_TOKEN)}`,

  radio: (seed: string, n = 25) =>
    getJson<{ ok: boolean; tracks: YtResult[] }>(`/api/radio?seed=${encodeURIComponent(seed)}&n=${n}`),

  getCookies: () => getJson<{ ok: boolean; cookies: Record<string, unknown> }>('/api/cookies'),
  saveCookies: (youtube: string) =>
    postJson<{ ok: boolean; _renovado: number; _expira: number }>('/api/cookies', { youtube }),

  // Cookie Keeper (Plan B: navegador remoto en el backend)
  cookieStatus: () => getJson<CookieStatus>('/api/cookies/status'),
  refreshCookies: () => getJson<{ ok: boolean; cookies: number; logueado: boolean; _renovado: number; _expira: number }>('/api/cookies/refresh'),
  startBrowserSession: (url?: string) =>
    postJson<BrowserSession>('/api/browser/session', url ? { url } : {}),
  closeBrowserSession: (sid: string) => postJson<{ ok: boolean }>('/api/browser/close', { sid }),
  browserWsUrl: (sid: string) =>
    API_URL.replace(/^http/, 'ws') + '/ws/browser?sid=' + encodeURIComponent(sid) + '&token=' + encodeURIComponent(QP_TOKEN),

  // Headers para fuentes de expo-video.
  mediaHeaders: () => ({ Authorization: 'Bearer ' + QP_TOKEN }),

  // -- Crew Vault (Cloudflare R2) -------------------------------------------
  crewGetUploadUrl: (params: { filename: string; contentType?: string; title: string; artist?: string; crew_id?: string; uploaded_by?: string }) =>
    withRetry(() => postJson<{ ok: boolean; uploadUrl: string; key: string; contentType: string }>('/api/crew/upload-url', params)),

  crewSaveTrack: (params: { key: string; title: string; artist?: string; cover_url?: string | null; duration?: number | null; file_size?: number | null; crew_id?: string; uploaded_by?: string }) =>
    withRetry(() => postJson<{ ok: boolean; track: CrewTrack }>('/api/crew/track', params)),

  crewListTracks: (crew_id = 'main') =>
    withRetry(() => getJson<{ ok: boolean; tracks: CrewTrack[] }>(`/api/crew/tracks?crew_id=${encodeURIComponent(crew_id)}`), 3, 2000),

  crewDeleteTrack: (id: string) =>
    fetch(API_URL + `/api/crew/track/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: authHeaders(),
    }).then(r => r.json() as Promise<{ ok: boolean }>),
};
