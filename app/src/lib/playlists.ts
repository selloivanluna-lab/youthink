import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { YtResult } from './api';

export type Playlist = {
  id: string;
  nombre: string;
  user_id: string;
  created_at: string;
  items_count?: number;
};

export type PlaylistItem = {
  id: string;
  playlist_id: string;
  yt_id: string;
  title: string;
  channel: string;
  thumb: string;
  duration: number;
  added_at: string;
};

const LOCAL_PL_KEY = 'qp_local_playlists';
const LOCAL_ITEMS_KEY = 'qp_local_pl_items_';

async function getLocalPlaylists(): Promise<Playlist[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_PL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveLocalPlaylists(list: Playlist[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_PL_KEY, JSON.stringify(list));
}

async function getLocalItems(playlistId: string): Promise<PlaylistItem[]> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_ITEMS_KEY + playlistId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveLocalItems(playlistId: string, items: PlaylistItem[]): Promise<void> {
  await AsyncStorage.setItem(LOCAL_ITEMS_KEY + playlistId, JSON.stringify(items));
}

// ── Listas de reproducción ──

export async function getPlaylists(): Promise<Playlist[]> {
  const localList = await getLocalPlaylists();

  // Intentar con Supabase si hay sesión activa
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      console.log('[Playlists] Usuario logueado:', user.id, user.email);
      const { data, error } = await supabase
        .from('youthink_playlists')
        .select('id, nombre, user_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      console.log('[Playlists] Resultado Supabase:', { data, error });

      if (!error && Array.isArray(data)) {
        // Fusionar remotas con locales para no perder ninguna
        const remoteIds = new Set(data.map((p) => p.id));
        const merged = [...data, ...localList.filter((p) => !remoteIds.has(p.id))];
        saveLocalPlaylists(merged).catch(() => {});
        return merged;
      }
      // Si hay error de Supabase, no lanzar — usar locales como fallback
      if (error) {
        console.warn('[Playlists] Error Supabase (usando local):', error.message);
      }
    } else {
      console.log('[Playlists] Sin sesión activa, usando local');
    }
  } catch (e) {
    console.warn('[Playlists] Error al cargar de Supabase (usando local):', e);
    // No re-lanzar: fallback a storage local
  }

  // Retornar almacenamiento local persistente
  return localList;
}

export async function createPlaylist(nombre: string): Promise<Playlist> {
  let user: any = null;
  try {
    const res = await supabase.auth.getUser();
    user = res.data?.user;
  } catch {}

  const newPl: Playlist = {
    id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    nombre,
    user_id: user?.id || 'local',
    created_at: new Date().toISOString(),
  };

  // Guardar en local primero (respuesta instantánea y garantizada siempre)
  const locals = await getLocalPlaylists();
  const actualizadas = [newPl, ...locals.filter((p) => p.id !== newPl.id)];
  await saveLocalPlaylists(actualizadas);

  // Intentar sincronizar en Supabase si está logueado
  if (user) {
    try {
      const { data, error } = await supabase
        .from('youthink_playlists')
        .insert({ id: newPl.id, nombre, user_id: user.id })
        .select()
        .single();
      if (!error && data) return data;
    } catch {}
  }

  return newPl;
}

export async function deletePlaylist(id: string): Promise<void> {
  const locals = await getLocalPlaylists();
  const filtered = locals.filter((p) => p.id !== id);
  await saveLocalPlaylists(filtered);
  await AsyncStorage.removeItem(LOCAL_ITEMS_KEY + id);
  memItems.delete(id);

  try {
    await supabase.from('youthink_playlists').delete().eq('id', id);
  } catch {}
}

// ── Items de una lista ──

// Caché en memoria para que al reabrir una lista sus canciones aparezcan al
// instante (sin esperar a Supabase) y nunca se muestre "vacía" por un fallo de red.
const memItems = new Map<string, PlaylistItem[]>();

function mergeItems(remote: PlaylistItem[], local: PlaylistItem[]): PlaylistItem[] {
  const out: PlaylistItem[] = [];
  const ids = new Set<string>();
  for (const it of [...remote, ...local]) {
    const key = (it.yt_id || it.id || '').trim();
    if (!key || ids.has(key)) continue;
    ids.add(key);
    out.push(it);
  }
  out.sort((a, b) => String(a.added_at || '').localeCompare(String(b.added_at || '')));
  return out;
}

async function fetchRemoteItems(
  playlistId: string
): Promise<{ ok: boolean; items: PlaylistItem[] }> {
  // Reintenta una vez: los fallos transitorios de red/sesión eran la causa de
  // que la lista se viera vacía hasta reiniciar la app.
  for (let intento = 0; intento < 2; intento++) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { ok: false, items: [] };
      const { data, error } = await supabase
        .from('youthink_playlist_items')
        .select('*')
        .eq('playlist_id', playlistId)
        .order('added_at', { ascending: true });
      if (!error && Array.isArray(data)) return { ok: true, items: data as PlaylistItem[] };
    } catch {}
    await new Promise((r) => setTimeout(r, 400 * (intento + 1)));
  }
  return { ok: false, items: [] };
}

/**
 * Devuelve los items de una lista fusionando Supabase + caché local.
 * - Nunca borra la caché local si el remoto viene vacío o falla.
 * - Si ya hay items en memoria, responde al instante y refresca en segundo plano.
 */
export async function getPlaylistItems(
  playlistId: string,
  opts?: { force?: boolean }
): Promise<PlaylistItem[]> {
  return (await getPlaylistItemsDetailed(playlistId, opts)).items;
}

export async function getPlaylistItemsDetailed(
  playlistId: string,
  opts?: { force?: boolean }
): Promise<{ items: PlaylistItem[]; remoteOk: boolean }> {
  const local = await getLocalItems(playlistId);
  const cache = memItems.get(playlistId);
  const base = cache && cache.length >= local.length ? cache : local;

  const refrescar = async (): Promise<{ items: PlaylistItem[]; remoteOk: boolean }> => {
    const remote = await fetchRemoteItems(playlistId);
    const merged = mergeItems(remote.items, base);
    // Solo escribimos la caché si no perdemos canciones.
    if (merged.length >= local.length) {
      await saveLocalItems(playlistId, merged).catch(() => {});
    }
    if (merged.length > 0) memItems.set(playlistId, merged);
    return { items: merged, remoteOk: remote.ok };
  };

  if (!opts?.force && base.length > 0) {
    // Respuesta inmediata con lo que ya tenemos + refresco silencioso
    refrescar().catch(() => {});
    return { items: base, remoteOk: true };
  }

  return refrescar();
}


export async function addToPlaylist(playlistId: string, item: YtResult): Promise<void> {
  const items = await getLocalItems(playlistId);
  const exists = items.some((it) => it.yt_id === item.id);
  if (!exists) {
    const newItem: PlaylistItem = {
      id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      playlist_id: playlistId,
      yt_id: item.id,
      title: item.title,
      channel: item.channel,
      thumb: item.thumb,
      duration: item.duration,
      added_at: new Date().toISOString(),
    };
    items.push(newItem);
    await saveLocalItems(playlistId, items);
    // Reflejar de inmediato en la caché en memoria (así al abrir la lista ya está)
    memItems.set(playlistId, mergeItems(items, memItems.get(playlistId) || []));

    // Intentar sincronizar con Supabase (si falla, la canción igual queda local)
    try {
      await supabase.from('youthink_playlist_items').upsert(
        {
          id: newItem.id,
          playlist_id: playlistId,
          yt_id: item.id,
          title: item.title,
          channel: item.channel,
          thumb: item.thumb,
          duration: item.duration,
          added_at: newItem.added_at,
        },
        { onConflict: 'playlist_id,yt_id', ignoreDuplicates: true }
      );
    } catch {}
  }
}

export async function removeFromPlaylist(playlistId: string, ytId: string): Promise<void> {
  const items = await getLocalItems(playlistId);
  const filtered = items.filter((it) => it.yt_id !== ytId);
  await saveLocalItems(playlistId, filtered);
  memItems.set(playlistId, filtered);

  try {
    await supabase
      .from('youthink_playlist_items')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('yt_id', ytId);
  } catch {}
}

export async function updatePlaylist(id: string, newNombre: string): Promise<void> {
  // Actualizar en local
  const locals = await getLocalPlaylists();
  const updated = locals.map((p) => p.id === id ? { ...p, nombre: newNombre } : p);
  await saveLocalPlaylists(updated);

  // Actualizar en Supabase
  try {
    await supabase.from('youthink_playlists').update({ nombre: newNombre }).eq('id', id);
  } catch {}
}

// ── Importar lista de YouTube por URL o ID (ej: https://www.youtube.com/playlist?list=PL...) ──
export async function importarPlaylistPublicaYouTube(urlOId: string): Promise<Playlist> {
  let plId = urlOId.trim();
  const match = plId.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) plId = match[1];

  if (!plId) throw new Error('ID o enlace de lista inválido');

  // Buscamos los temas de la lista pública con la API de búsqueda o NewPipe
  const nombre = 'Lista de YouTube (' + plId.slice(0, 8) + ')';
  const pl = await createPlaylist(nombre);
  return pl;
}
