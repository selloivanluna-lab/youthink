/**
 * Descargas.tsx — Pestaña de biblioteca offline de YouThink.
 * Muestra todos los tracks descargados (YouTube + Crew) con reproducción offline.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deleteDownload, DownloadedTrack, getDownloads } from '../lib/downloads';
import { theme } from '../theme';
import { playerStore } from '../lib/playerStore';

function fmtBytes(b?: number): string {
  if (!b) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function Descargas() {
  const [tracks, setTracks] = useState<DownloadedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    const list = await getDownloads();
    setTracks(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function borrar(id: string, title: string) {
    const confirmar = async (): Promise<boolean> => {
      if (Platform.OS === 'web') {
        return (globalThis as any).confirm?.(`¿Eliminar "${title}" de tus descargas?`) ?? true;
      }
      return new Promise<boolean>((resolve) =>
        Alert.alert('Eliminar descarga', `¿Eliminar "${title}"?`, [
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Eliminar', style: 'destructive', onPress: () => resolve(true) },
        ])
      );
    };

    const ok = await confirmar();
    if (!ok) return;

    await deleteDownload(id);
    setTracks((prev) => prev.filter((t) => t.id !== id));
    if (playingId === id) {
      pararAudio();
    }
  }

  function pararAudio() {
    if (Platform.OS === 'web' && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingId(null);
  }

  function reproducir(track: DownloadedTrack) {
    if (track.localPath.startsWith('web://')) {
      Alert.alert(
        'Guardado en web',
        'Esta descarga fue guardada desde el navegador. Para escucharla, buscala en la carpeta de Descargas de tu dispositivo.'
      );
      return;
    }

    if (Platform.OS === 'web') {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (playingId === track.id) {
        setPlayingId(null);
        return;
      }
      const audio = new (globalThis as any).Audio(track.localPath) as HTMLAudioElement;
      audioRef.current = audio;
      audio.play();
      setPlayingId(track.id);
      audio.onended = () => {
        setPlayingId(null);
        audioRef.current = null;
      };
      return;
    }

    // Android: si ya está reproduciendo este track, toggle play/pause
    if (playingId === track.id) {
      playerStore.togglePlay();
      return;
    }

    // Registrar en playerStore para MiniPlayer
    playerStore.setState({
      actual: {
        id: track.id,
        title: track.title,
        channel: track.artist,
        thumb: track.thumb || '',
        url: track.localPath,
        kind: 'song' as const,
        source: 'download' as const,
        duration: track.duration || 0,
      },
      reproduciendo: true,
    });
    setPlayingId(track.id);
  }

  if (loading) {
    return (
      <View style={s.center}>
        <Text style={s.dimText}>Cargando descargas…</Text>
      </View>
    );
  }

  if (tracks.length === 0) {
    return (
      <View style={s.center}>
        <Text style={{ fontSize: 52, marginBottom: 14 }}>⬇️</Text>
        <Text style={s.emptyTitle}>No tenés descargas</Text>
        <Text style={s.dimText}>
          Las canciones que descargues desde PLAY o Library Crew aparecerán aquí para escuchar sin
          internet.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.header}>⬇️ Descargas ({tracks.length})</Text>
      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        onRefresh={cargar}
        refreshing={loading}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => {
          const isPlaying = playingId === item.id;
          return (
            <View style={s.row}>
              {item.thumb ? (
                <Image source={{ uri: item.thumb }} style={s.thumb} />
              ) : (
                <View style={[s.thumb, s.thumbFallback]}>
                  <Text style={{ fontSize: 22 }}>🎵</Text>
                </View>
              )}

              <View style={s.info}>
                <Text style={s.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {item.artist}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 3 }}>
                  <View style={s.badge}>
                    <Text style={s.badgeText}>
                      {item.source === 'crew' ? '👥 Crew' : '▶️ YouTube'}
                    </Text>
                  </View>
                  {item.fileSize ? (
                    <Text style={s.dimTextInline}>{fmtBytes(item.fileSize)}</Text>
                  ) : null}
                  <Text style={s.dimTextInline}>{fmtDate(item.downloadedAt)}</Text>
                </View>
              </View>

              <Pressable
                focusable={true}
                style={s.btn}
                onPress={() => reproducir(item)}
              >
                <Text style={{ fontSize: 22 }}>{isPlaying ? '⏸️' : '▶️'}</Text>
              </Pressable>
              <Pressable
                focusable={true}
                style={s.btn}
                onPress={() => borrar(item.id, item.title)}
              >
                <Text style={{ fontSize: 20 }}>🗑️</Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
    backgroundColor: theme.colors.bg,
  },
  header: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    padding: 16,
    paddingBottom: 8,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  dimText: { color: theme.colors.textDim, fontSize: 12, textAlign: 'center' },
  dimTextInline: { color: theme.colors.textDim, fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  thumb: { width: 60, height: 45, borderRadius: 5, marginRight: 10 },
  thumbFallback: {
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginRight: 4 },
  title: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  sub: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  badge: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: theme.colors.textDim, fontSize: 10 },
  btn: { padding: 10 },
});
