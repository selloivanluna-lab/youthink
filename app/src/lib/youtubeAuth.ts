import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../config';

export const CACHE_YT_ITEMS_PREFIX = 'qp_cache_yt_items_';
export const CACHE_YT_LISTAS_KEY = 'qp_cache_yt_playlists';

/**
 * Obtiene las listas de reproducción de la cuenta de YouTube vinculada.
 * Retorna inmediatamente la caché local para no bloquear la UI y en segundo
 * plano refresca contra Google API con auto-renovación de token si caducó.
 */
export async function obtenerListasYouTube(onFresh?: (listas: any[]) => void): Promise<any[]> {
  let previas: any[] = [];
  try {
    const raw = await AsyncStorage.getItem(CACHE_YT_LISTAS_KEY);
    if (raw) previas = JSON.parse(raw);
  } catch {}

  const refresco = (async () => {
    try {
      const resp = await ejecutarConTokenYouTube(async (tok) => {
        let all: any[] = [];
        let pageToken = '';
        let lastError: any = null;
        let lastStatus = 200;

        do {
          const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50${
            pageToken ? '&pageToken=' + pageToken : ''
          }`;
          const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
          lastStatus = r.status;
          const json = await r.json();

          if (json.error) {
            lastError = json.error;
            break;
          }

          const items = (json.items || []).map((it: any) => ({
            id: 'yt_' + it.id,
            nombre: it.snippet?.title || 'Lista de YouTube',
            user_id: 'youtube',
            created_at: it.snippet?.publishedAt || new Date().toISOString(),
            items_count: it.contentDetails?.itemCount,
          }));

          all = [...all, ...items];
          pageToken = json.nextPageToken || '';
        } while (pageToken);

        if (lastError && all.length === 0) {
          return { status: lastStatus, error: lastError };
        }

        return { data: all, status: 200 };
      });

      if (resp.data && Array.isArray(resp.data)) {
        await AsyncStorage.setItem(CACHE_YT_LISTAS_KEY, JSON.stringify(resp.data));
        if (onFresh) onFresh(resp.data);
        return resp.data;
      }
    } catch (e) {
      console.warn('[youtubeAuth] Error al actualizar listas de YouTube:', e);
    }
    return previas;
  })();

  if (previas.length > 0) {
    refresco.catch(() => {});
    return previas;
  }

  return await refresco;
}

/**
 * Añade una canción a una lista de YouTube oficial.
 * Usa auto-renovación transparente del token e inserta de inmediato en la caché local
 * para que aparezca al instante sin esperar latencia de red.
 */
export async function agregarItemAPlaylistYouTube(
  playlistIdRaw: string,
  item: { id: string; title: string; channel?: string; thumb?: string; duration?: number }
): Promise<{ ok: boolean; enYt: boolean }> {
  const plId = playlistIdRaw.replace(/^yt_/, '');
  const cleanId = (item.id || '').trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];

  // 1. Guardar de inmediato en la caché local de esa lista de YouTube
  const cacheKey = CACHE_YT_ITEMS_PREFIX + plId;
  try {
    let itemsCache: any[] = [];
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) itemsCache = JSON.parse(raw);

    const existe = itemsCache.some((c) => (c.id === cleanId || c.yt_id === cleanId));
    if (!existe) {
      const nuevo = {
        id: cleanId,
        yt_id: cleanId,
        title: item.title,
        channel: item.channel || '',
        thumb: item.thumb || `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg`,
        duration: item.duration || 0,
        added_at: new Date().toISOString(),
      };
      itemsCache.push(nuevo);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(itemsCache));
    }
  } catch (e) {
    console.warn('[youtubeAuth] Error actualizando caché local tras agregar item:', e);
  }

  // 2. Enviar a YouTube Data API v3 con manejo automático de token
  let enYt = false;
  try {
    const res = await ejecutarConTokenYouTube(async (tok) => {
      const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + tok,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            playlistId: plId,
            resourceId: {
              kind: 'youtube#video',
              videoId: cleanId,
            },
          },
        }),
      });
      const json = await r.json();
      return { data: json, status: r.status, error: json.error };
    });

    if (res.data?.id) enYt = true;
  } catch (e) {
    console.warn('[youtubeAuth] Error en POST playlistItems YouTube:', e);
  }

  return { ok: true, enYt };
}

/**
 * Obtiene el access_token actual de YouTube guardado localmente.
 */
export async function obtenerTokenYouTube(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem('qp_yt_access_token');
  } catch {
    return null;
  }
}

/**
 * Refresca el access_token de YouTube contra el endpoint backend /oauth/refresh
 * usando el refresh_token persistido. Actualiza AsyncStorage y devuelve el nuevo token.
 */
export async function refrescarTokenYouTube(): Promise<string | null> {
  try {
    const refreshToken = await AsyncStorage.getItem('qp_yt_refresh_token');
    if (!refreshToken) return null;

    const base = API_URL.replace(/\/+$/, '');
    const res = await fetch(`${base}/oauth/refresh?refresh_token=${encodeURIComponent(refreshToken)}`);
    const data = await res.json();

    if (data.ok && data.access_token) {
      await AsyncStorage.setItem('qp_yt_access_token', data.access_token);
      return data.access_token;
    }
  } catch (e) {
    console.warn('[youtubeAuth] Error al renovar token YouTube:', e);
  }
  return null;
}

/**
 * Ejecuta una consulta a la API de YouTube. Si detecta error 401 (token expirado),
 * renueva automáticamente el token en segundo plano y reintenta la consulta una vez.
 */
export async function ejecutarConTokenYouTube<T>(
  fn: (token: string) => Promise<{ data?: T; status?: number; error?: any }>
): Promise<{ data?: T; error?: any }> {
  let token = await obtenerTokenYouTube();
  if (!token) return { error: new Error('Sin token de YouTube') };

  let res = await fn(token);

  // Si falló por 401 Unauthorized o credenciales inválidas, renovar y reintentar
  const es401 =
    res.status === 401 ||
    res.error?.code === 401 ||
    res.error?.status === 'UNAUTHENTICATED' ||
    String(res.error?.message || '').toLowerCase().includes('credential');

  if (es401) {
    console.log('[youtubeAuth] Token expirado (401), renovando automáticamente...');
    const nuevoToken = await refrescarTokenYouTube();
    if (nuevoToken) {
      res = await fn(nuevoToken);
    }
  }

  return res;
}

/**
 * Carga los items de una lista de YouTube con caché offline inmediato.
 * Nunca devuelve vacío si hay canciones cacheadas previamente.
 */
export async function obtenerItemsPlaylistYouTube(
  playlistIdRaw: string,
  onFresh?: (items: any[]) => void
): Promise<any[]> {
  const plId = playlistIdRaw.replace(/^yt_/, '');
  const cacheKey = CACHE_YT_ITEMS_PREFIX + plId;

  // 1. Cargar caché previo de inmediato
  let itemsPrevios: any[] = [];
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      itemsPrevios = JSON.parse(raw);
    }
  } catch {}

  // 2. Ejecutar fetch en segundo plano con renovación transparente de token
  const fetchPromesa = (async () => {
    try {
      const resp = await ejecutarConTokenYouTube(async (tok) => {
        let all: any[] = [];
        let pageToken = '';
        let lastError: any = null;
        let lastStatus = 200;

        do {
          const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${plId}&maxResults=50${
            pageToken ? '&pageToken=' + pageToken : ''
          }`;
          const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
          lastStatus = r.status;
          const json = await r.json();

          if (json.error) {
            lastError = json.error;
            break;
          }

          const items = (json.items || []).map((it: any) => ({
            id: it.snippet?.resourceId?.videoId || it.id,
            title: it.snippet?.title || '(sin título)',
            channel: it.snippet?.videoOwnerChannelTitle || '',
            thumb:
              it.snippet?.thumbnails?.medium?.url ||
              it.snippet?.thumbnails?.default?.url ||
              `https://i.ytimg.com/vi/${it.snippet?.resourceId?.videoId || it.id}/mqdefault.jpg`,
            duration: 0,
          }));

          all = [...all, ...items];
          pageToken = json.nextPageToken || '';
        } while (pageToken);

        if (lastError && all.length === 0) {
          return { status: lastStatus, error: lastError };
        }

        return { data: all, status: 200 };
      });

      if (resp.data && Array.isArray(resp.data)) {
        // Fusionar con caché previo para no perder canciones añadidas recientemente
        // mientras la API de YouTube termina de propagar los cambios
        const ids = new Set(resp.data.map((x: any) => x.id || x.yt_id));
        const merged = [...resp.data];
        for (const prev of itemsPrevios) {
          const k = prev.id || prev.yt_id;
          if (k && !ids.has(k)) {
            ids.add(k);
            merged.push(prev);
          }
        }
        AsyncStorage.setItem(cacheKey, JSON.stringify(merged)).catch(() => {});
        if (onFresh) onFresh(merged);
        return merged;
      }
    } catch (e) {
      console.warn('[youtubeAuth] Error al actualizar items de lista YT:', e);
    }
    return itemsPrevios;
  })();

  // Si hay caché disponible, devolverlo inmediatamente para no bloquear la UI;
  // de lo contrario esperar a la red.
  if (itemsPrevios && itemsPrevios.length > 0) {
    fetchPromesa.catch(() => {});
    return itemsPrevios;
  }

  return await fetchPromesa;
}
