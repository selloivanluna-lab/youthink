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

// ── Listas de reproducción ──

export async function getPlaylists(): Promise<Playlist[]> {
  const { data, error } = await supabase
    .from('youthink_playlists')
    .select('id, nombre, user_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createPlaylist(nombre: string): Promise<Playlist> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Debés iniciar sesión primero');
  const { data, error } = await supabase
    .from('youthink_playlists')
    .insert({ nombre, user_id: user.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deletePlaylist(id: string): Promise<void> {
  const { error } = await supabase.from('youthink_playlists').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ── Items de una lista ──

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  const { data, error } = await supabase
    .from('youthink_playlist_items')
    .select('*')
    .eq('playlist_id', playlistId)
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function addToPlaylist(playlistId: string, item: YtResult): Promise<void> {
  // Evita duplicados silenciosamente.
  const { error } = await supabase.from('youthink_playlist_items').upsert(
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
  if (error) throw new Error(error.message);
}

export async function removeFromPlaylist(playlistId: string, ytId: string): Promise<void> {
  const { error } = await supabase
    .from('youthink_playlist_items')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('yt_id', ytId);
  if (error) throw new Error(error.message);
}
