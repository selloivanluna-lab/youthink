import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';
import { getPlaylists, getPlaylistItems, deletePlaylist, removeFromPlaylist, Playlist, PlaylistItem } from '../lib/playlists';

type UserInfo = {
  id: string;
  email?: string;
  full_name?: string;
  avatar_url?: string;
};

export default function Sesion() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [cargandoPlaylists, setCargandoPlaylists] = useState(false);
  const [listaSeleccionada, setListaSeleccionada] = useState<Playlist | null>(null);
  const [itemsLista, setItemsLista] = useState<PlaylistItem[]>([]);
  const [cargandoItems, setCargandoItems] = useState(false);

  const cargarMisListas = async () => {
    setCargandoPlaylists(true);
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch {}
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
    cargarMisListas();
    supabase.auth.getUser().then(({ data, error: e }: any) => {
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
      } else {
        setUser(null);
      }
    });
    // Escucha de Deep Links cuando el navegador externo vuelve a la app (youthink://auth/callback)
    const handleUrl = (event: { url: string }) => {
      const url = event.url;
      if (url && url.includes('auth/callback')) {
        const hashIdx = url.indexOf('#');
        const queryIdx = url.indexOf('?');
        const paramsStr = hashIdx !== -1 ? url.substring(hashIdx + 1) : queryIdx !== -1 ? url.substring(queryIdx + 1) : '';
        const params = new URLSearchParams(paramsStr);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          supabase.auth.setSession({ access_token, refresh_token }).then(() => {
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
          // En web, abre en la misma pestaña para que Supabase pueda leer el hash de vuelta.
          skipBrowserRedirect: false,
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

        {cargandoPlaylists ? (
          <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 16 }} />
        ) : playlists.length === 0 ? (
          <Text style={s.hint}>Todavía no tenés listas. Podés crearlas o añadir canciones desde la pestaña Buscar con el botón ➕ Añadir a lista.</Text>
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
                          {itemsLista.map((it) => (
                            <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                              <Image source={{ uri: it.thumb }} style={{ width: 44, height: 26, borderRadius: 4, backgroundColor: '#000' }} />
                              <View style={{ flex: 1 }}>
                                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{it.title}</Text>
                                <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{it.channel}</Text>
                              </View>
                              <Pressable onPress={() => borrarItem(it.yt_id)} style={{ padding: 4 }}>
                                <Text style={{ color: theme.colors.textDim, fontSize: 13 }}>✕</Text>
                              </Pressable>
                            </View>
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
