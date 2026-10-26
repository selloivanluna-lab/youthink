import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';
import { getPlaylists, getPlaylistItems, createPlaylist, deletePlaylist, removeFromPlaylist, Playlist, PlaylistItem } from '../lib/playlists';
import { useNavigation } from '@react-navigation/native';

type UserInfo = {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
};

export default function Sesion() {
  const navigation = useNavigation();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [cargandoPlaylists, setCargandoPlaylists] = useState(false);
  const [listaSeleccionada, setListaSeleccionada] = useState<Playlist | null>(null);
  const [itemsLista, setItemsLista] = useState<PlaylistItem[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);

  const [nuevaLista, setNuevaLista] = useState('');
  const [creandoLista, setCreandoLista] = useState(false);
  const [errorListas, setErrorListas] = useState('');
  const [ytToken, setYtToken] = useState<string | null>(null);
  const [ytTokenExpirado, setYtTokenExpirado] = useState(false);
  const [listasYT, setListasYT] = useState<Playlist[]>([]);
  const [cargandoYT, setCargandoYT] = useState(false);
  const [ytListaSeleccionada, setYtListaSeleccionada] = useState<Playlist | null>(null);
  const [ytItems, setYtItems] = useState<any[]>([]);
  const [cargandoYTItems, setCargandoYTItems] = useState(false);

  // Cargar token guardado de YouTube al iniciar
  useEffect(() => {
    AsyncStorage.getItem('qp_yt_access_token').then((token) => {
      if (token) {
        setYtToken(token);
        cargarListasYouTube(token);
      }
    });
  }, []);

  // Función para refrescar el token de YouTube automáticamente en segundo plano
  const refrescarTokenYouTube = async (): Promise<string | null> => {
    try {
      const refreshToken = await AsyncStorage.getItem('qp_yt_refresh_token');
      if (!refreshToken) return null;
      const res = await fetch(`https://youthink-1.onrender.com/oauth/refresh?refresh_token=${encodeURIComponent(refreshToken)}`);
      const data = await res.json();
      if (data.ok && data.access_token) {
        await AsyncStorage.setItem('qp_yt_access_token', data.access_token);
        setYtToken(data.access_token);
        setYtTokenExpirado(false);
        return data.access_token;
      }
    } catch (e) {
      console.warn('[YT Refresh]', e);
    }
    return null;
  };

  const GOOGLE_CLIENT_ID = '74282824783-2r4cqfks9u5vgpmgap09o7jk0dvpq622.apps.googleusercontent.com';

  const conectarYouTubeDirecto = async () => {
    try {
      const redirectUri = 'https://youthink-1.onrender.com/oauth/callback';
      const scope = encodeURIComponent('https://www.googleapis.com/auth/youtube.readonly');
      // Usamos response_type=code y access_type=offline para obtener refresh_token permanente
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
      await Linking.openURL(authUrl);
    } catch (e: any) {
      setError(e?.message || 'Error al conectar con YouTube');
    }
  };

  const desconectarYouTube = async () => {
    await AsyncStorage.multiRemove(['qp_yt_access_token', 'qp_yt_refresh_token']);
    setYtToken(null);
    setYtTokenExpirado(false);
    setListasYT([]);
    setYtListaSeleccionada(null);
    setYtItems([]);
  };

  const verItemsYT = async (lista: Playlist) => {
    // Toggle: si ya estaba abierta, cerrar
    if (ytListaSeleccionada?.id === lista.id) {
      setYtListaSeleccionada(null);
      setYtItems([]);
      return;
    }
    setYtListaSeleccionada(lista);
    setYtItems([]);
    if (!ytToken) return;
    setCargandoYTItems(true);
    try {
      // El id real de la playlist YT viene sin el prefijo 'yt_'
      const playlistId = lista.id.replace(/^yt_/, '');
      let all: any[] = [];
      let pageToken = '';
      do {
        const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50${pageToken ? '&pageToken=' + pageToken : ''}`;
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + ytToken } });
        const json = await res.json();
        if (json.error) break;
        const items = (json.items || []).map((it: any) => ({
          id: it.snippet.resourceId?.videoId || it.id,
          title: it.snippet.title,
          channel: it.snippet.videoOwnerChannelTitle || '',
          thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
          duration: 0,
        }));
        all = [...all, ...items];
        pageToken = json.nextPageToken || '';
      } while (pageToken);
      setYtItems(all);
    } catch (e) {
      console.warn('[YT Items]', e);
    }
    setCargandoYTItems(false);
  };

  // Carga las listas de YouTube del usuario con el access_token directo
  const cargarListasYouTube = async (token: string) => {
    setCargandoYT(true);
    setYtTokenExpirado(false);
    try {
      let allItems: Playlist[] = [];
      let pageToken = '';
      do {
        const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50${pageToken ? '&pageToken=' + pageToken : ''}`;
        let res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        let json = await res.json();
        if (json.error) {
          if (json.error.code === 401) {
            // Token expirado: intentar renovar automáticamente con el refresh_token
            const nuevoToken = await refrescarTokenYouTube();
            if (nuevoToken) {
              res = await fetch(url, { headers: { Authorization: 'Bearer ' + nuevoToken } });
              json = await res.json();
              if (json.error) {
                setYtTokenExpirado(true);
                break;
              }
            } else {
              setYtTokenExpirado(true);
              break;
            }
          } else {
            console.warn('[YT Playlists]', json.error);
            break;
          }
        }
        const items: Playlist[] = (json.items || []).map((it: any) => ({
          id: 'yt_' + it.id,
          nombre: it.snippet.title,
          user_id: 'youtube',
          created_at: it.snippet.publishedAt,
          items_count: it.contentDetails?.itemCount,
        }));
        allItems = [...allItems, ...items];
        pageToken = json.nextPageToken || '';
      } while (pageToken);
      if (allItems.length > 0) {
        setListasYT(allItems);
      }
    } catch (e) {
      console.warn('[YT Playlists] Error:', e);
    }
    setCargandoYT(false);
  };

  const handleCrearLista = async () => {
    const nom = nuevaLista.trim();
    if (!nom) return;
    setCreandoLista(true);
    try {
      const pl = await createPlaylist(nom);
      setPlaylists((prev) => [pl, ...prev.filter((p) => p.id !== pl.id)]);
      setNuevaLista('');
    } catch {}
    setCreandoLista(false);
  };

  const cargarMisListas = async () => {
    setCargandoPlaylists(true);
    setErrorListas('');
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch (e: any) {
      setErrorListas(e?.message || 'Error al cargar listas');
    }
    setCargandoPlaylists(false);
  };

  const verItems = async (p: Playlist) => {
    setListaSeleccionada(p);
    setCargandoItems(true);
    try {
      const items = await getPlaylistItems(p.id);
      setItemsLista(items);
    } catch {}
    setCargandoItems(false);
  };

  const borrarItem = async (ytId: string) => {
    if (!listaSeleccionada) return;
    await removeFromPlaylist(listaSeleccionada.id, ytId);
    setItemsLista((prev) => prev.filter((it) => it.yt_id !== ytId));
  };

  const borrarLista = async (pId: string) => {
    await deletePlaylist(pId);
    setPlaylists((prev) => prev.filter((p) => p.id !== pId));
    if (listaSeleccionada?.id === pId) setListaSeleccionada(null);
  };

  // Carga la sesión actual al montar.
  useEffect(() => {
    // Primero resolvemos la sesión, luego cargamos las listas (evita race condition)
    supabase.auth.getUser().then(({ data }: any) => {
      if (data?.user) {
        const m = data.user.user_metadata || {};
        setUser({
          id: data.user.id,
          email: data.user.email,
          full_name: m.full_name || m.name || '',
          avatar_url: m.avatar_url || m.picture || '',
        });
      }
      setLoading(false);
      // Cargar listas DESPUÉS de conocer el estado de sesión
      cargarMisListas();
    });

    // Escucha cambios de sesión (por ejemplo, después del redirect OAuth).
    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user) {
        const m = session.user.user_metadata || {};
        setUser({
          id: session.user.id,
          email: session.user.email,
          full_name: m.full_name || m.name || '',
          avatar_url: m.avatar_url || m.picture || '',
        });
        // Al completar el login OAuth, recargar listas con el usuario ya autenticado
        cargarMisListas();
        // Capturar provider_token (access token de Google/YouTube)
        const tok = session.provider_token;
        if (tok) {
          setYtToken(tok);
          cargarListasYouTube(tok);
        }
      } else {
        setUser(null);
        setYtToken(null);
        setListasYT([]);
      }
    });
    // Escucha de Deep Links cuando el navegador externo vuelve a la app
    const handleUrl = (event: { url: string }) => {
      const url = event.url;
      if (!url) return;

      // Retorno de YouTube OAuth directo (youthink://oauth2redirect#access_token=...&refresh_token=...)
      if (url.includes('oauth2redirect')) {
        const hashIdx = url.indexOf('#');
        const queryIdx = url.indexOf('?');
        const paramsStr = hashIdx !== -1 ? url.substring(hashIdx + 1) : queryIdx !== -1 ? url.substring(queryIdx + 1) : '';
        const params = new URLSearchParams(paramsStr);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token) {
          AsyncStorage.setItem('qp_yt_access_token', access_token).catch(() => {});
          if (refresh_token) {
            AsyncStorage.setItem('qp_yt_refresh_token', refresh_token).catch(() => {});
          }
          setYtToken(access_token);
          setYtTokenExpirado(false);
          cargarListasYouTube(access_token);
        }
        return;
      }

      // Retorno de Supabase Auth (youthink://auth/callback)
      if (url.includes('auth/callback')) {
        const hashIdx = url.indexOf('#');
        const queryIdx = url.indexOf('?');
        const paramsStr = hashIdx !== -1 ? url.substring(hashIdx + 1) : queryIdx !== -1 ? url.substring(queryIdx + 1) : '';
        const params = new URLSearchParams(paramsStr);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        const provider_token = params.get('provider_token');
        if (access_token && refresh_token) {
          supabase.auth.setSession({ access_token, refresh_token }).then((res) => {
            const tok = provider_token || res.data?.session?.provider_token;
            if (tok) {
              AsyncStorage.setItem('qp_yt_access_token', tok).catch(() => {});
              setYtToken(tok);
              cargarListasYouTube(tok);
            }
            setSigning(false);
          }).catch(() => setSigning(false));
        } else {
          setSigning(false);
        }
      }
    };
    const linkingSub = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then((url) => { if (url) handleUrl({ url }); });

    return () => {
      sub.subscription.unsubscribe();
      linkingSub.remove();
    };
  }, []);

  const loginGoogle = async () => {
    setSigning(true);
    setError('');
    try {
      // Scheme oficial en app.json es "youthink"
      const redirectTo =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.href
          : 'youthink://auth/callback';

      const { data, error: e } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: false,
          // Pedimos acceso de lectura a YouTube para ver las listas del usuario
          scopes: 'openid email profile https://www.googleapis.com/auth/youtube.readonly',
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (e) throw e;
      // En nativo, data.url contiene la URL de Google → la abrimos en el navegador del sistema.
      if (Platform.OS !== 'web' && data?.url) await Linking.openURL(data.url);
    } catch (e: any) {
      setError(e?.message || 'No se pudo iniciar sesión con Google');
      setSigning(false);
    }
  };

  const logout = async () => {
    setSigning(true);
    await supabase.auth.signOut();
    setUser(null);
    setSigning(false);
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={theme.colors.gold} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.hero}>
        <Text style={s.heroIcon}>🎵</Text>
        <Text style={s.heroTitle}>YouThink</Text>
        <Text style={s.heroSub}>Tu cuenta para guardar listas y descubrir música</Text>
      </View>

      {user ? (
        /* ── SESIÓN ACTIVA ── */
        <View style={s.card}>
          <View style={s.profileRow}>
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={s.avatar} />
            ) : (
              <View style={s.avatarPlaceholder}>
                <Text style={s.avatarLetter}>{(user.full_name || user.email || '?')[0].toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              {user.full_name ? <Text style={s.userName}>{user.full_name}</Text> : null}
              <Text style={s.userEmail}>{user.email}</Text>
            </View>
          </View>

          <View style={s.divider} />

          <View style={s.infoRow}>
            <Text style={s.infoIcon}>✅</Text>
            <Text style={s.infoText}>Sesión activa con Google</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoIcon}>🎵</Text>
            <Text style={s.infoText}>Tus listas de reproducción se sincronizan automáticamente</Text>
          </View>

          <Pressable style={[s.btn, { backgroundColor: theme.colors.surface2, marginTop: 20 }]} onPress={logout} disabled={signing}>
            <Text style={[s.btnText, { color: theme.colors.textDim }]}>
              {signing ? 'Cerrando…' : 'Cerrar sesión'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── SECCIÓN DE LISTAS DE REPRODUCCIÓN ── */}
      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={s.cardTitle}>📋 Mis listas de reproducción</Text>
          <Pressable onPress={cargarMisListas} style={{ padding: 4 }}>
            <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>🔄 Actualizar</Text>
          </Pressable>
        </View>

        {/* Creador de nueva lista */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <TextInput
            style={{
              flex: 1,
              backgroundColor: theme.colors.surface2,
              color: theme.colors.text,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              fontSize: 14,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
            placeholder="Nombre de nueva lista…"
            placeholderTextColor={theme.colors.textDim}
            value={nuevaLista}
            onChangeText={setNuevaLista}
            autoCorrect={false}
          />
          <Pressable
            style={{
              backgroundColor: theme.colors.gold,
              borderRadius: 8,
              paddingHorizontal: 14,
              justifyContent: 'center',
              alignItems: 'center',
              opacity: !nuevaLista.trim() || creandoLista ? 0.4 : 1,
            }}
            onPress={handleCrearLista}
            disabled={!nuevaLista.trim() || creandoLista}
          >
            {creandoLista ? (
              <ActivityIndicator color="#111" size="small" />
            ) : (
              <Text style={{ color: '#111', fontWeight: '800', fontSize: 13 }}>➕ Crear</Text>
            )}
          </Pressable>
        </View>

        {cargandoPlaylists ? (
          <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 16 }} />
        ) : errorListas ? (
          <Text style={[s.err, { marginBottom: 8 }]}>⚠️ {errorListas}</Text>
        ) : playlists.length === 0 ? (
          <Text style={s.hint}>Todavía no tenés listas. Escribí un nombre arriba y tocá "➕ Crear" para armar tu primera lista.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {playlists.map((p) => {
              const estaAbierta = listaSeleccionada?.id === p.id;
              return (
                <View key={p.id} style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, padding: 12, backgroundColor: theme.colors.surface2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Pressable style={{ flex: 1 }} onPress={() => estaAbierta ? setListaSeleccionada(null) : verItems(p)}>
                      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>🎵 {p.nombre}</Text>
                      <Text style={{ color: theme.colors.textDim, fontSize: 12, marginTop: 2 }}>
                        {estaAbierta ? 'Tocar para cerrar' : 'Tocar para ver canciones'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => borrarLista(p.id)} style={{ padding: 6 }}>
                      <Text style={{ color: theme.colors.danger, fontSize: 14 }}>🗑️</Text>
                    </Pressable>
                  </View>

                  {estaAbierta ? (
                    <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10 }}>
                      {cargandoItems ? (
                        <ActivityIndicator color={theme.colors.gold} size="small" style={{ marginVertical: 8 }} />
                      ) : itemsLista.length === 0 ? (
                        <Text style={{ color: theme.colors.textDim, fontSize: 12, fontStyle: 'italic' }}>Esta lista está vacía.</Text>
                      ) : (
                        <View style={{ gap: 8 }}>
                          {itemsLista.map((it, idx) => (
                            <Pressable
                              key={it.id}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
                              onPress={() => {
                                const queue = itemsLista.map((song) => ({
                                  id: song.yt_id,
                                  title: song.title,
                                  channel: song.channel,
                                  thumb: song.thumb,
                                  duration: song.duration || 0,
                                }));
                                navigation.navigate('Buscar' as never, {
                                  autoPlayId: it.yt_id,
                                  autoPlayTitle: it.title,
                                  autoPlayQueue: queue,
                                  autoPlayIndex: idx,
                                } as never);
                              }}
                            >
                              <Image source={{ uri: it.thumb }} style={{ width: 44, height: 26, borderRadius: 4, backgroundColor: '#000' }} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{it.title}</Text>
                                <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{it.channel}</Text>
                              </View>
                              <Text style={{ color: theme.colors.gold, fontSize: 16 }}>▶</Text>
                              <Pressable onPress={(e) => { e.stopPropagation?.(); borrarItem(it.yt_id); }} style={{ padding: 4 }}>
                                <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>✕</Text>
                              </Pressable>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* ── LISTAS DE YOUTUBE ── */}
      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={s.cardTitle}>▶️ Mis listas de YouTube</Text>
          {ytToken && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Pressable onPress={() => cargarListasYouTube(ytToken)} style={{ padding: 4 }}>
                <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>🔄</Text>
              </Pressable>
              <Pressable onPress={desconectarYouTube} style={{ padding: 4 }}>
                <Text style={{ color: theme.colors.danger, fontSize: 12 }}>Desconectar</Text>
              </Pressable>
            </View>
          )}
        </View>

        {ytTokenExpirado && (
          <View style={{ backgroundColor: 'rgba(212, 175, 55, 0.15)', borderWidth: 1, borderColor: theme.colors.gold, borderRadius: 8, padding: 10, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ color: theme.colors.gold, fontWeight: '700', fontSize: 13 }}>⚠️ Sesión de YouTube caducada</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 2 }}>Renovala en un toque para actualizar tus listas.</Text>
            </View>
            <Pressable
              style={{ backgroundColor: theme.colors.gold, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 }}
              onPress={conectarYouTubeDirecto}
            >
              <Text style={{ color: '#111', fontWeight: '800', fontSize: 12 }}>Renovar</Text>
            </Pressable>
          </View>
        )}

        {!ytToken ? (
          <View>
            <Text style={s.hint}>
              Conectá tu cuenta de YouTube directamente para ver y reproducir todas tus listas guardadas.
            </Text>
            <Pressable
              style={[s.googleBtn, { backgroundColor: '#FF0000', marginBottom: 6 }]}
              onPress={conectarYouTubeDirecto}
            >
              <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>▶</Text>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Vincular cuenta de YouTube</Text>
            </Pressable>
          </View>
        ) : cargandoYT ? (
          <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 16 }} />
        ) : listasYT.length === 0 ? (
          <Text style={s.hint}>No se encontraron listas en tu cuenta de YouTube.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {listasYT.map((p) => {
              const abierta = ytListaSeleccionada?.id === p.id;
              return (
                <View key={p.id} style={{ borderWidth: 1, borderColor: abierta ? theme.colors.gold : theme.colors.border, borderRadius: 10, padding: 12, backgroundColor: theme.colors.surface2 }}>
                  <Pressable onPress={() => verItemsYT(p)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>🎵 {p.nombre}</Text>
                        {p.items_count !== undefined && (
                          <Text style={{ color: theme.colors.textDim, fontSize: 12, marginTop: 2 }}>
                            {p.items_count} canciones · {abierta ? 'Tocar para cerrar' : 'Tocar para ver'}
                          </Text>
                        )}
                      </View>
                      <Text style={{ color: theme.colors.gold, fontSize: 18 }}>{abierta ? '▲' : '▼'}</Text>
                    </View>
                  </Pressable>

                  {abierta && (
                    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10 }}>
                      {cargandoYTItems ? (
                        <ActivityIndicator color={theme.colors.gold} size="small" />
                      ) : ytItems.length === 0 ? (
                        <Text style={{ color: theme.colors.textDim, fontSize: 12, fontStyle: 'italic' }}>Lista vacía.</Text>
                      ) : (
                        <View style={{ gap: 8 }}>
                          {ytItems.map((it, idx) => (
                            <Pressable
                              key={it.id}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                              onPress={() => {
                                const queue = ytItems.map((song) => ({
                                  id: song.id,
                                  title: song.title,
                                  channel: song.channel,
                                  thumb: song.thumb,
                                  duration: song.duration || 0,
                                }));
                                navigation.navigate('Buscar' as never, {
                                  autoPlayId: it.id,
                                  autoPlayTitle: it.title,
                                  autoPlayQueue: queue,
                                  autoPlayIndex: idx,
                                } as never);
                              }}
                            >
                              {it.thumb ? (
                                <Image source={{ uri: it.thumb }} style={{ width: 56, height: 32, borderRadius: 4, backgroundColor: '#000' }} />
                              ) : (
                                <View style={{ width: 56, height: 32, borderRadius: 4, backgroundColor: theme.colors.surface }} />
                              )}
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{it.title}</Text>
                                {it.channel ? <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{it.channel}</Text> : null}
                              </View>
                              <Text style={{ color: theme.colors.gold, fontSize: 18 }}>▶</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {!user && (
        /* ── SIN SESIÓN ── */
        <View style={s.card}>
          <Text style={s.cardTitle}>Iniciá sesión</Text>
          <Text style={s.hint}>
            Usá tu cuenta de Google para guardar listas de reproducción y acceder desde cualquier dispositivo.
          </Text>

          {error ? <Text style={s.err}>{error}</Text> : null}

          <Pressable
            style={[s.googleBtn, signing && { opacity: 0.6 }]}
            onPress={loginGoogle}
            disabled={signing}
          >
            {signing ? (
              <ActivityIndicator color="#111" size="small" />
            ) : (
              <>
                <Text style={s.googleLetter}>G</Text>
                <Text style={s.googleText}>Continuar con Google</Text>
              </>
            )}
          </Pressable>

          <Text style={s.legal}>
            Al iniciar sesión aceptás los términos de uso. No compartimos tus datos con terceros.
          </Text>
        </View>
      )}

      {/* Info sobre la cuenta */}
      <View style={s.card}>
        <Text style={s.cardTitle}>¿Para qué sirve la cuenta?</Text>
        <View style={s.infoRow}><Text style={s.infoIcon}>📋</Text><Text style={s.infoText}>Guardar listas de reproducción personalizadas</Text></View>
        <View style={s.infoRow}><Text style={s.infoIcon}>⬇️</Text><Text style={s.infoText}>Historial de descargas sincronizado</Text></View>
        <View style={s.infoRow}><Text style={s.infoIcon}>🔄</Text><Text style={s.infoText}>Accedé desde cualquier dispositivo</Text></View>
        <View style={s.infoRow}><Text style={s.infoIcon}>⭐</Text><Text style={s.infoText}>Canciones favoritas siempre disponibles</Text></View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg },

  hero: { alignItems: 'center', paddingVertical: 28 },
  heroIcon: { fontSize: 48, marginBottom: 8 },
  heroTitle: { color: theme.colors.text, fontSize: 28, fontWeight: '900', letterSpacing: 1 },
  heroSub: { color: theme.colors.textDim, fontSize: 14, marginTop: 6, textAlign: 'center' },

  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
  },
  cardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  hint: { color: theme.colors.textDim, fontSize: 13, marginBottom: 18, lineHeight: 20 },
  err: { color: theme.colors.danger, fontSize: 13, marginBottom: 12 },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface2 },
  avatarPlaceholder: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.colors.gold,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: '#111', fontSize: 24, fontWeight: '900' },
  userName: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  userEmail: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },

  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 14 },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 },
  infoIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  infoText: { color: theme.colors.text, fontSize: 14, flex: 1, lineHeight: 20 },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 14,
  },
  googleLetter: {
    color: '#4285F4',
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: -1,
  },
  googleText: { color: '#111', fontSize: 16, fontWeight: '700' },

  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },

  legal: { color: theme.colors.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
