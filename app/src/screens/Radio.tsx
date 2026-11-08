import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, YtResult } from '../lib/api';
import { theme } from '../theme';

const GENEROS = [
  { id: 'rock-nacional', nombre: '🇦🇷 Rock Nacional', seed: 'Spinetta Charly Fito Soda' },
  { id: 'trap-arg', nombre: '🔥 Trap & Urbano', seed: 'Duki Bizarrap Milo J Wos' },
  { id: 'cumbia', nombre: '🕺 Cumbia & Cuarteto', seed: 'La Konga Damas Gratis Ke Personajes Rodrigo' },
  { id: 'pop-latino', nombre: '✨ Pop Latino', seed: 'Tini Maria Becerra Emilia Lali' },
  { id: 'rkt', nombre: '🎧 RKT & Turreo', seed: 'Callejero Fino L-Gante La Joaqui' },
  { id: '80s-90s', nombre: '📼 Éxitos 80s y 90s', seed: 'Michael Jackson Queen Madonna Phil Collins' },
  { id: 'lofi', nombre: '☕ Lo-Fi Chill', seed: 'Lofi hip hop beats chill study' },
  { id: 'reggaeton', nombre: '🌴 Reggaeton Clásico', seed: 'Daddy Yankee Don Omar Wisin y Yandel' },
  { id: 'indie', nombre: '🎸 Indie & Alternativo', seed: 'Bandalos Chinos Conociendo Rusia Usted Señalemelo' },
  { id: 'electronica', nombre: '⚡ Electrónica & House', seed: 'Daft Punk David Guetta Avicii Calvin Harris' },
];

export default function Radio() {
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [cargando, setCargando] = useState(false);
  const [tracks, setTracks] = useState<YtResult[]>([]);
  const [estacionActual, setEstacionActual] = useState<string>('');
  const [historialRadio, setHistorialRadio] = useState<YtResult[]>([]);
  const [vistaActiva, setVistaActiva] = useState<'estacion' | 'descubiertos'>('estacion');
  const [error, setError] = useState<string | null>(null);

  // Sincronizar cola y temas descubiertos cada vez que el usuario abre la pestaña Radio
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.multiGet(['qp_radio_estacion_nombre', 'qp_radio_cola', 'qp_radio_historial_temas']).then(
        (rows) => {
          const map: Record<string, string | null> = {};
          rows.forEach(([k, v]) => (map[k] = v));

          if (map.qp_radio_estacion_nombre) {
            setEstacionActual(map.qp_radio_estacion_nombre);
          }
          if (map.qp_radio_cola) {
            try {
              const parsed = JSON.parse(map.qp_radio_cola);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setTracks(parsed);
              }
            } catch (_) {}
          }
          if (map.qp_radio_historial_temas) {
            try {
              const hist = JSON.parse(map.qp_radio_historial_temas);
              if (Array.isArray(hist)) {
                setHistorialRadio(hist);
              }
            } catch (_) {}
          }
        }
      ).catch(() => {});
    }, [])
  );

  const iniciarEstacion = async (seed: string, nombreVisible: string) => {
    setCargando(true);
    setError(null);
    const nombreFinal = `📻 ${nombreVisible}`;
    setEstacionActual(nombreFinal);
    setVistaActiva('estacion');
    try {
      let tracksRadio: YtResult[] = [];
      try {
        const res = await api.radio(seed, 30);
        if (res.ok && res.tracks && res.tracks.length > 0) {
          tracksRadio = res.tracks;
        }
      } catch (_) {}

      if (tracksRadio.length === 0) {
        try {
          const busq = await api.search(`${seed} mix`, 25);
          if (busq.ok && busq.results && busq.results.length > 0) {
            tracksRadio = busq.results;
          }
        } catch (_) {}
      }

      if (tracksRadio.length > 0) {
        const canciones = tracksRadio.map((t) => ({ ...t, kind: 'song' as const }));
        setTracks(canciones);
        AsyncStorage.setItem('qp_radio_estacion_nombre', nombreFinal).catch(() => {});
        AsyncStorage.setItem('qp_radio_cola', JSON.stringify(canciones)).catch(() => {});

        // Reproducir de inmediato en Play con auto-radio activado
        reproducirRadio(0, canciones);
      } else {
        setError('No se pudieron obtener temas para esta estación.');
      }
    } catch (e: any) {
      setError(e?.message || 'Error iniciando la radio.');
    } finally {
      setCargando(false);
    }
  };

  const reproducirRadio = (startIndex = 0, lista: YtResult[] = tracks) => {
    if (!lista.length) return;
    const track = lista[startIndex];
    navigation.navigate('Play' as never, {
      autoPlayId: track.id,
      autoPlayTitle: track.title,
      autoPlayQueue: lista,
      autoPlayIndex: startIndex,
      autoRadio: true,
    } as never);
  };

  const limpiarDescubiertos = () => {
    setHistorialRadio([]);
    AsyncStorage.removeItem('qp_radio_historial_temas').catch(() => {});
  };

  const listaMostrar = vistaActiva === 'estacion' ? tracks : historialRadio;

  return (
    <View style={s.container}>
      {/* Buscador de Radio */}
      <View style={s.searchSection}>
        <Text style={s.sectionHeader}>📻 Buscador de Radio</Text>
        <Text style={s.subText}>Iniciá una estación infinita a partir de cualquier artista, género o canción:</Text>
        <View style={s.searchRow}>
          <TextInput
            style={s.input}
            placeholder="Ej: Charly García, Synthwave, Dua Lipa..."
            placeholderTextColor={theme.colors.textDim}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => query.trim() && iniciarEstacion(query.trim(), query.trim())}
            returnKeyType="search"
          />
          <Pressable
            style={s.btn}
            onPress={() => query.trim() && iniciarEstacion(query.trim(), query.trim())}
            disabled={!query.trim() || cargando}
          >
            <Text style={s.btnText}>{cargando ? '⏳' : '▶ Radio'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Categorías Rápidas */}
      <View style={{ marginBottom: 12 }}>
        <Text style={[s.sectionHeader, { paddingHorizontal: 16, marginBottom: 8 }]}>🌟 Géneros y Estaciones</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {GENEROS.map((g) => {
            const activo = estacionActual.includes(g.nombre);
            return (
              <Pressable
                key={g.id}
                style={[s.chip, activo && s.chipActivo]}
                onPress={() => iniciarEstacion(g.seed, g.nombre)}
              >
                <Text style={[s.chipText, activo && s.chipTextActivo]}>{g.nombre}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Selector de Vista: Estación Activa vs Temas Descubiertos */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 10 }}>
        <Pressable
          style={[s.tabPill, vistaActiva === 'estacion' && s.tabPillActivo]}
          onPress={() => setVistaActiva('estacion')}
        >
          <Text style={[s.tabPillText, vistaActiva === 'estacion' && s.tabPillTextActivo]}>
            📻 Estación ({tracks.length})
          </Text>
        </Pressable>
        <Pressable
          style={[s.tabPill, vistaActiva === 'descubiertos' && s.tabPillActivo]}
          onPress={() => setVistaActiva('descubiertos')}
        >
          <Text style={[s.tabPillText, vistaActiva === 'descubiertos' && s.tabPillTextActivo]}>
            💾 Descubiertos ({historialRadio.length})
          </Text>
        </Pressable>
        {vistaActiva === 'descubiertos' && historialRadio.length > 0 && (
          <Pressable style={s.limpiarBtn} onPress={limpiarDescubiertos}>
            <Text style={{ fontSize: 11, color: theme.colors.textDim, fontWeight: '700' }}>Limpiar</Text>
          </Pressable>
        )}
      </View>

      {/* Lista de temas */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {vistaActiva === 'estacion' && estacionActual ? (
          <View style={s.estacionHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.estacionTitle}>{estacionActual}</Text>
              <Text style={s.estacionCount}>{tracks.length} temas en cola infinita</Text>
            </View>
            {tracks.length > 0 && (
              <Pressable style={s.playAllBtn} onPress={() => reproducirRadio(0, tracks)}>
                <Text style={s.playAllBtnText}>▶ Sintonizar Todo</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        {cargando ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={theme.colors.gold} />
            <Text style={{ color: theme.colors.textDim, marginTop: 12 }}>Sintonizando estación...</Text>
          </View>
        ) : (
          <FlatList
            data={listaMostrar}
            keyExtractor={(it, index) => 'r-' + it.id + '-' + index}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item, index }) => (
              <Pressable style={s.trackRow} onPress={() => reproducirRadio(index, listaMostrar)}>
                {item.thumb ? (
                  <Image source={{ uri: item.thumb }} style={s.trackThumb} />
                ) : (
                  <View style={[s.trackThumb, { backgroundColor: '#222' }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.trackTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.trackArtist} numberOfLines={1}>{item.channel || 'Artista desconocido'}</Text>
                </View>
                <Text style={s.trackPlay}>▶</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              !cargando ? (
                <View style={{ alignItems: 'center', marginTop: 32 }}>
                  <Text style={{ fontSize: 40 }}>📻</Text>
                  <Text style={[s.subText, { textAlign: 'center', marginTop: 12 }]}>
                    {vistaActiva === 'estacion'
                      ? 'Iniciá una estación desde la búsqueda, tocando un género o con el botón "📻 Iniciar Radio" de cualquier tema en Play.'
                      : 'Acá se van guardando automáticamente los temas que vas descubriendo en la radio mientras escuchás.'}
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    paddingTop: 12,
  },
  searchSection: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.gold,
    marginBottom: 4,
  },
  subText: {
    fontSize: 12,
    color: theme.colors.textDim,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: theme.colors.text,
    fontSize: 14,
  },
  btn: {
    height: 44,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.gold,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 13,
  },
  chip: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipActivo: {
    backgroundColor: theme.colors.gold,
    borderColor: theme.colors.gold,
  },
  chipText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActivo: {
    color: '#111',
    fontWeight: '800',
  },
  tabPill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabPillActivo: {
    backgroundColor: theme.colors.gold + '22',
    borderColor: theme.colors.gold,
  },
  tabPillText: {
    fontSize: 12,
    color: theme.colors.textDim,
    fontWeight: '600',
  },
  tabPillTextActivo: {
    color: theme.colors.gold,
    fontWeight: '800',
  },
  limpiarBtn: {
    marginLeft: 'auto',
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  estacionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    marginBottom: 10,
  },
  estacionTitle: {
    color: theme.colors.text,
    fontWeight: '800',
    fontSize: 15,
  },
  estacionCount: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  playAllBtn: {
    backgroundColor: theme.colors.gold,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  playAllBtnText: {
    color: '#111',
    fontWeight: '800',
    fontSize: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface2,
  },
  trackThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  trackTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  trackArtist: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  trackPlay: {
    color: theme.colors.gold,
    fontSize: 18,
    paddingHorizontal: 6,
  },
  error: {
    color: theme.colors.danger,
    marginBottom: 10,
    fontSize: 13,
  },
});
