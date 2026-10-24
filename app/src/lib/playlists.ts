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
      // Si hay error, lo propagamos para que la UI lo muestre
      if (error) throw new Error('Supabase: ' + (error.message || JSON.stringify(error)));
    } else {
      console.log('[Playlists] Sin sesión activa, usando local');
    }
  } catch (e) {
    console.warn('[Playlists] Error al cargar de Supabase:', e);
    throw e; // re-lanzar para que cargarMisListas lo capture
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

  try {
    await supabase.from('youthink_playlists').delete().eq('id', id);
  } catch {}
}

// ── Items de una lista ──

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase
        .from('youthink_playlist_items')
        .select('*')
        .eq('playlist_id', playlistId)
        .order('added_at', { ascending: true });
      if (!error && Array.isArray(data)) {
        saveLocalItems(playlistId, data).catch(() => {});
        return data;
      }
    }
  } catch {}

  return getLocalItems(playlistId);
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

    // Intentar sincronizar con Supabase
    try {
      await supabase.from('youthink_playlist_items').upsert(
        {
          playlist_id: playlistId,
          yt_id: item.id,
          title: item.title,
          channel: item.channel,
          thumb: item.thumb,
          duration: item.duration,
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

  try {
    await supabase
      .from('youthink_playlist_items')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('yt_id', ytId);
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
