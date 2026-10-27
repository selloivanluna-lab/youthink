import React, { useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
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
  const [error, setError] = useState<string | null>(null);

  const iniciarEstacion = async (seed: string, nombreVisible: string) => {
    setCargando(true);
    setError(null);
    setEstacionActual(nombreVisible);
    try {
      const res = await api.radio(seed, 30);
      if (res.ok && res.tracks && res.tracks.length > 0) {
        setTracks(res.tracks);
        // Si el usuario toca una estación, también podemos iniciarla directamente
      } else {
        setError('No se pudieron obtener temas para esta estación.');
      }
    } catch (e: any) {
      setError(e?.message || 'Error iniciando la radio.');
    } finally {
      setCargando(false);
    }
  };

  const reproducirRadioCompleta = (startIndex = 0) => {
    if (!tracks.length) return;
    const track = tracks[startIndex];
    navigation.navigate('Play' as never, {
      autoPlayId: track.id,
      autoPlayTitle: track.title,
      autoPlayQueue: tracks,
      autoPlayIndex: startIndex,
    } as never);
  };

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
      <View style={{ marginBottom: 16 }}>
        <Text style={[s.sectionHeader, { paddingHorizontal: 16, marginBottom: 8 }]}>🌟 Géneros y Estaciones</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {GENEROS.map((g) => {
            const activo = estacionActual === g.nombre;
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

      {/* Lista de temas de la estación */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {estacionActual ? (
          <View style={s.estacionHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.estacionTitle}>Estación: {estacionActual}</Text>
              <Text style={s.estacionCount}>{tracks.length} temas sintonizados</Text>
            </View>
            {tracks.length > 0 && (
              <Pressable style={s.playAllBtn} onPress={() => reproducirRadioCompleta(0)}>
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
            data={tracks}
            keyExtractor={(it) => 'r-' + it.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item, index }) => (
              <Pressable style={s.trackRow} onPress={() => reproducirRadioCompleta(index)}>
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
                <View style={{ alignItems: 'center', marginTop: 40 }}>
                  <Text style={{ fontSize: 40 }}>📻</Text>
                  <Text style={[s.subText, { textAlign: 'center', marginTop: 12 }]}>
                    Elegí un género arriba o buscá cualquier artista para arrancar la radio.
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
