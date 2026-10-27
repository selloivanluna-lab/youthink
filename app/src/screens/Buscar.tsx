import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { api, YtResult } from '../lib/api';
import { NATIVE_AUDIO, useNativeAudio } from '../lib/nativeAudio';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';
import { buscarLyrics, traducirLyrics, LyricsData } from '../lib/lyrics';
import { getPlaylists, createPlaylist, addToPlaylist, Playlist } from '../lib/playlists';
import { supabase } from '../lib/supabase';
import { API_URL, GEMINI_KEY } from '../config';
import { theme } from '../theme';
import { useNavigation, useRoute } from '@react-navigation/native';

function CargaAnim({ texto = 'Cargando…' }: { texto?: string }) {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.2))).current;
  useEffect(() => {
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 480 + i * 90, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.2, duration: 480 + i * 90, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={s.cargaWrap}>
      <View style={s.cargaRow}>
        {bars.map((v, i) => (
          <Animated.View key={i} style={[s.barrita, { opacity: v, transform: [{ scaleY: v }] }]} />
        ))}
      </View>
      <Text style={s.cargaTexto}>{texto}</Text>
    </View>
  );
}

function fmtTiempo(seg?: number) {
  if (!seg || seg <= 0 || !isFinite(seg)) return '0:00';
  const m = Math.floor(seg / 60);
  const s = Math.floor(seg % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type Modo = 'video' | 'audio';
type Repeat = 'off' | 'all' | 'one';
type ModoLetra = 'original' | 'traducida' | 'bilingue';

const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: 'Plano', gains: [0, 0, 0, 0, 0, 0] },
  bass: { label: 'Graves', gains: [7, 5, 2, 0, 0, 0] },
  voz: { label: 'Voz', gains: [-3, -1, 3, 4, 3, -1] },
  agudos: { label: 'Agudos', gains: [0, 0, 0, 2, 5, 7] },
  rock: { label: 'Rock', gains: [5, 3, 0, -1, 3, 5] },
  pop: { label: 'Pop', gains: [-1, 1, 3, 3, 1, -1] },
};
const EQ_BANDS = [60, 170, 350, 1000, 3500, 10000];

function Barra({ pos, dur, onSeek }: { pos: number; dur: number; onSeek: (t: number) => void }) {
  const [w, setW] = useState(0);
  const [seekingPos, setSeekingPos] = useState<number | null>(null);

  const currentPos = seekingPos != null ? seekingPos : pos;
  const pct = dur > 0 ? Math.min(1, Math.max(0, currentPos / dur)) : 0;

  const handleTouch = (e: any, isRelease = false) => {
    if (w <= 0 || dur <= 0) return;
    const ne = e?.nativeEvent || e;
    let clientX: number | undefined = ne.clientX;
    if (clientX == null && ne.touches && ne.touches[0]) {
      clientX = ne.touches[0].clientX;
    }
    if (clientX == null && ne.changedTouches && ne.changedTouches[0]) {
      clientX = ne.changedTouches[0].clientX;
    }

    let x = ne.locationX ?? 0;
    if (Platform.OS === 'web' && clientX != null && e.currentTarget?.getBoundingClientRect) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = clientX - rect.left;
    }

    const ratio = Math.max(0, Math.min(1, x / w));
    const target = ratio * dur;

    if (isRelease) {
      setSeekingPos(null);
      onSeek(target);
    } else {
      setSeekingPos(target);
    }
  };

  return (
    <View
      style={s.barWrap}
      hitSlop={{ top: 20, bottom: 20, left: 10, right: 10 }}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => handleTouch(e, false)}
      onResponderMove={(e) => handleTouch(e, false)}
      onResponderRelease={(e) => handleTouch(e, true)}
      onResponderTerminate={() => setSeekingPos(null)}
    >
      <View style={s.barTrack} pointerEvents="none">
        <View style={[s.barFill, { width: `${pct * 100}%` }]} pointerEvents="none" />
        <View style={[s.barKnob, { left: `${pct * 100}%` }]} pointerEvents="none" />
      </View>
    </View>
  );
}

export default function Buscar() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<YtResult[]>([]);
  const [recomendaciones, setRecomendaciones] = useState<YtResult[]>([]);
  const [cargandoRecomendaciones, setCargandoRecomendaciones] = useState(false);
  const [iniciandoRadio, setIniciandoRadio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actual, setActual] = useState<YtResult | null>(null);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('video');
  const [soloAudio, setSoloAudio] = useState(false);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [audioTimeout, setAudioTimeout] = useState(false);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auto-retry en Source Error: reintentar play hasta 3 veces automáticamente
  const sourceRetryRef = useRef(0);
  const sourceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actualRetryRef = useRef<YtResult | null>(null);

  // Cola / modos
  const [cola, setCola] = useState<YtResult[]>([]);
  const [qIdx, setQIdx] = useState(-1);
  const colaRef = useRef<YtResult[]>([]);
  const idxRef = useRef(-1);
  const audioRef = useRef(false);
  const reproduciendoRef = useRef(false);
  useEffect(() => { reproduciendoRef.current = reproduciendo; }, [reproduciendo]);
  const actualRef = useRef<YtResult | null>(null);
  useEffect(() => { actualRef.current = actual; }, [actual]);
  const [autoSiguiente, setAutoSiguiente] = useState(true);
  const autoRef = useRef(true);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const repeatRef = useRef<Repeat>('off');
  const [crossover, setCrossover] = useState(false);
  const crossoverRef = useRef(false);
  const crossoverTriggeredRef = useRef(false);
  const [eq, setEq] = useState('flat');
  const [eqOpen, setEqOpen] = useState(false);
  const eqGraph = useRef<any>(null);
  const mediaUriRef = useRef<string | null>(null);

  // Control de modal de reproductor (minimizar para buscar canciones sin cortar audio)
  const [playerVisible, setPlayerVisible] = useState(false);

  // Control de velocidad de reproducción (playback speed / tempo)
  const [velocidad, setVelocidad] = useState<number>(1);
  const velocidadRef = useRef<number>(1);
  const [velocidadOpen, setVelocidadOpen] = useState(false);

  // Cargar velocidad guardada al iniciar
  useEffect(() => {
    AsyncStorage.getItem('qp_playback_speed').then((val) => {
      if (val) {
        const rate = parseFloat(val);
        if (rate > 0 && !isNaN(rate)) {
          setVelocidad(rate);
          velocidadRef.current = rate;
        }
      }
    }).catch(() => {});
  }, []);

  function aplicarVelocidad(rate: number) {
    const r = Math.max(0.25, Math.min(2.0, Math.round(rate * 100) / 100));
    setVelocidad(r);
    velocidadRef.current = r;
    AsyncStorage.setItem('qp_playback_speed', r.toString()).catch(() => {});

    if (Platform.OS === 'web') {
      const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
      if (iframe?.contentWindow) {
        try {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [r] }), '*');
        } catch (_) {}
      }
      const el = (globalThis as any).document?.querySelector('video') as any;
      if (el) el.playbackRate = r;
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          (navigator.mediaSession as any).setPositionState({
            duration: dur || 1,
            position: Math.min(pos, dur || 1),
            playbackRate: r,
          });
        } catch (_) {}
      }
    } else {
      try { player.playbackRate = r; } catch (_) {}
    }
  }

  // Audio silencioso persistente para mantener MediaSession viva y controles en pantalla de bloqueo
  const silentAudioRef = useRef<any>(null);

  // Reordenar canciones en la cola (mover arriba / mover abajo)
  function moverEnCola(fromIndex: number, toIndex: number) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= cola.length || toIndex >= cola.length) return;
    const nueva = [...cola];
    const [removido] = nueva.splice(fromIndex, 1);
    nueva.splice(toIndex, 0, removido);
    setCola(nueva);
    colaRef.current = nueva;
    if (qIdx === fromIndex) {
      setQIdx(toIndex);
      idxRef.current = toIndex;
    } else if (fromIndex < qIdx && toIndex >= qIdx) {
      setQIdx(qIdx - 1);
      idxRef.current = qIdx - 1;
    } else if (fromIndex > qIdx && toIndex <= qIdx) {
      setQIdx(qIdx + 1);
      idxRef.current = qIdx + 1;
    }
  }

  // Quitar cancion de la cola
  function quitarDeCola(index: number) {
    if (index < 0 || index >= cola.length) return;
    const nueva = cola.filter((_, i) => i !== index);
    setCola(nueva);
    colaRef.current = nueva;
    if (index < qIdx) {
      setQIdx(qIdx - 1);
      idxRef.current = qIdx - 1;
    } else if (index === qIdx) {
      if (nueva.length > 0) {
        const nextIdx = Math.min(index, nueva.length - 1);
        aplicar(nueva[nextIdx], audioRef.current, nextIdx, true);
      } else {
        cerrar();
      }
    }
  }

  // Agregar cancion al final de la cola sin cortar la reproducción
  function encolarCancion(item: YtResult) {
    const nueva = [...cola, item];
    setCola(nueva);
    colaRef.current = nueva;
  }

  // Letras (Lyrics) sincronizadas y traducción
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsData, setLyricsData] = useState<LyricsData | null>(null);
  const [cargandoLyrics, setCargandoLyrics] = useState(false);
  const [traduciendoLyrics, setTraduciendoLyrics] = useState(false);
  const [modoLetra, setModoLetra] = useState<ModoLetra>('original');
  const [autoScrollLyrics, setAutoScrollLyrics] = useState(true);
  const lyricsListRef = useRef<FlatList>(null);
  const autoPlayRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);

  // Listas de reproducción
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [cargandoPlaylists, setCargandoPlaylists] = useState(false);
  const [nuevaListaNombre, setNuevaListaNombre] = useState('');
  const [creandoLista, setCreandoLista] = useState(false);
  const [addingToPlaylist, setAddingToPlaylist] = useState(false);

  // Descarga
  const [descargando, setDescargando] = useState(false);

  // Info (IA sobre artista/canción)
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoData, setInfoData] = useState<string | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState('');

  // Instalación iOS PWA
  const [iosInstallOpen, setIosInstallOpen] = useState(false);
  const esIosSafari =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    /iPhone|iPad|iPod/.test((window.navigator as any)?.userAgent || '') &&
    !(window.navigator as any)?.standalone;

  const player = useVideoPlayer(null, (p) => { p.loop = false; p.timeUpdateEventInterval = 0.5; });

  // Reproductor nativo (Android): audio sin anuncios, en segundo plano y con EQ real.
  const native = useNativeAudio();
  const usarNativo = NATIVE_AUDIO && modo === 'audio';
  const usarNativoRef = useRef(false);
  const modoRef = useRef<Modo>(modo);
  const eqRef = useRef(eq);
  const siguienteRef = useRef<(auto?: any) => void>(() => {});
  const [nativeBuffering, setNativeBuffering] = useState(false);
  const [nativeResolving, setNativeResolving] = useState(false);

  useEffect(() => { usarNativoRef.current = usarNativo; }, [usarNativo]);
  useEffect(() => { modoRef.current = modo; }, [modo]);
  useEffect(() => { eqRef.current = eq; }, [eq]);
  useEffect(() => { siguienteRef.current = siguiente; });

  // Estado del reproductor nativo: llega por eventos (se actualiza fuera del render).
  useEffect(() => {
    if (!NATIVE_AUDIO || !QpAudio || typeof (QpAudio as any).addListener !== 'function') return;
    try {
      const sub = (QpAudio as any).addListener('onPlaybackState', (st: any) => {
        if (modoRef.current !== 'audio') return;
        if (typeof st.isPlaying === 'boolean') setReproduciendo(st.isPlaying);
        if (isFinite(st.position) && st.position >= 0) {
          setPos(st.position);
          // Crossover / Crossfade: cuando falten 4 segundos o menos para el final, pasar suave a la siguiente
          if (
            crossoverRef.current &&
            !crossoverTriggeredRef.current &&
            isFinite(st.duration) &&
            st.duration > 15 &&
            st.position >= st.duration - 4
          ) {
            crossoverTriggeredRef.current = true;
            siguienteRef.current(true);
          }
        }
        if (isFinite(st.duration) && st.duration > 0) setDur(st.duration);
        setNativeBuffering(Boolean(st.buffering));
        setNativeResolving(Boolean(st.resolving));
        if (st.error) {
          // Auto-retry hasta 3 veces en errores de source/stream (URLs de YouTube expiran rápido)
          const isSourceError = /source|http|403|stream|failed to load/i.test(st.error);
          if (isSourceError && sourceRetryRef.current < 3 && actualRetryRef.current) {
            sourceRetryRef.current += 1;
            const itemToRetry = actualRetryRef.current;
            const retryN = sourceRetryRef.current;
            if (sourceRetryTimerRef.current) clearTimeout(sourceRetryTimerRef.current);
            sourceRetryTimerRef.current = setTimeout(async () => {
              try {
                await native.play(itemToRetry.id, itemToRetry.title);
              } catch (_) {}
            }, 800 * retryN); // backoff: 800ms, 1600ms, 2400ms
          } else {
            setError(st.error);
          }
        }
        if (st.ended && !crossoverTriggeredRef.current) siguienteRef.current(true);
      });
      return () => {
        try { sub?.remove?.(); } catch (_) {}
      };
    } catch (_) {}
  }, []);

  useEffect(() => { mediaUriRef.current = mediaUri; }, [mediaUri]);

  useEffect(() => { colaRef.current = cola; }, [cola]);
  useEffect(() => { idxRef.current = qIdx; }, [qIdx]);
  useEffect(() => { audioRef.current = soloAudio; }, [soloAudio]);
  useEffect(() => { autoRef.current = autoSiguiente; }, [autoSiguiente]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { crossoverRef.current = crossover; }, [crossover]);
  useEffect(() => { try { player.loop = repeat === 'one'; } catch (e) {} }, [repeat, player]);

  useEffect(() => {
    AsyncStorage.multiGet(['qp_soloAudio', 'qp_autoSig', 'qp_shuffle', 'qp_repeat', 'qp_eq', 'qp_crossover']).then((rows) => {
      const m: any = {}; rows.forEach(([k, v]) => (m[k] = v));
      if (m.qp_soloAudio != null) setSoloAudio(m.qp_soloAudio === '1');
      if (m.qp_autoSig != null) setAutoSiguiente(m.qp_autoSig === '1');
      if (m.qp_shuffle != null) setShuffle(m.qp_shuffle === '1');
      if (m.qp_repeat) setRepeat(m.qp_repeat);
      if (m.qp_eq) setEq(m.qp_eq);
      if (m.qp_crossover != null) setCrossover(m.qp_crossover === '1');
    }).catch(() => {});

    // Cargar recomendaciones iniciales para el feed de inicio
    cargarRecomendaciones();
  }, []);

  async function cargarRecomendaciones() {
    setCargandoRecomendaciones(true);
    try {
      // 1. Intentar obtener artistas/temas a partir del usuario logueado en YouTube
      const ytToken = await AsyncStorage.getItem('qp_yt_access_token');
      let queryPersonalizada = '';

      if (ytToken) {
        try {
          const r = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=5', {
            headers: { Authorization: 'Bearer ' + ytToken },
          });
          const d = await r.json();
          if (d.items && d.items.length > 0) {
            const titulos = d.items.map((it: any) => it.snippet?.title).filter(Boolean);
            if (titulos.length > 0) {
              queryPersonalizada = titulos[Math.floor(Math.random() * titulos.length)];
            }
          }
        } catch (_) {}
      }

      // 2. Si no hay token o no tiene listas, buscar por sus listas locales de Supabase/storage
      if (!queryPersonalizada) {
        try {
          const misListas = await getPlaylists();
          if (misListas && misListas.length > 0) {
            const nom = misListas.map((l) => l.nombre).filter(Boolean);
            if (nom.length > 0) {
              queryPersonalizada = nom[Math.floor(Math.random() * nom.length)];
            }
          }
        } catch (_) {}
      }

      // 3. Fallback a tendencias generales si no hay datos del usuario aún
      const queryFinal = queryPersonalizada
        ? queryPersonalizada
        : ['musica argentina tendencias 2026', 'top exitos spotify 2026', 'rock nacional clasicos'][Math.floor(Math.random() * 3)];

      const res = await api.search(queryFinal, 20);
      if (res.ok && res.results) {
        setRecomendaciones(res.results);
      }
    } catch (_) {}
    setCargandoRecomendaciones(false);
  }

  // Iniciar estación de radio a partir de una canción
  async function iniciarRadioDesdeActual(track: YtResult) {
    if (!track) return;
    setIniciandoRadio(true);
    try {
      const res = await api.radio(track.id, 25);
      if (res.ok && res.tracks && res.tracks.length > 0) {
        // Encolar y reproducir
        reproducir(res.tracks, 0, soloAudio);
      } else {
        // Fallback: búsqueda de temas del mismo artista o canal
        const busq = await api.search(track.channel || track.title, 15);
        if (busq.ok && busq.results && busq.results.length > 0) {
          reproducir(busq.results, 0, soloAudio);
        }
      }
    } catch (e) {
      console.warn('[Iniciar Radio]', e);
    } finally {
      setIniciandoRadio(false);
    }
  }

  // Ecualizador Web Audio (solo web). Se activa al elegir un preset distinto de "Plano".
  function aplicarEQ(preset: string) {
    setEq(preset);
    AsyncStorage.setItem('qp_eq', preset).catch(() => {});
    if (NATIVE_AUDIO) { native.setEq(preset).catch(() => {}); return; }
    if (Platform.OS !== 'web') return;
    try {
      const doc = (globalThis as any).document;
      const el = doc?.querySelector('video') as any;
      const uri = mediaUriRef.current;
      const gains = (EQ_PRESETS[preset] || EQ_PRESETS.flat).gains;

      if (eqGraph.current) { eqGraph.current.bands.forEach((b: any, i: number) => { b.gain.value = gains[i] || 0; }); return; }

      if (preset === 'flat') return;
      if (!el || !uri) return;
      // Recargamos el medio en modo CORS para que createMediaElementSource no mutee el audio.
      try { el.crossOrigin = 'anonymous'; } catch (e) {}
      try { player.replace({ uri }); } catch (e) {}

      const anyWin: any = typeof window !== 'undefined' ? window : {};
      const AC = anyWin.AudioContext || anyWin.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const src = ctx.createMediaElementSource(el);
      const bands = EQ_BANDS.map((f) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1; b.gain.value = 0; return b; });
      let node: any = src;
      bands.forEach((b: any) => { node.connect(b); node = b; });
      const gain = ctx.createGain();
      node.connect(gain); gain.connect(ctx.destination);
      eqGraph.current = { ctx, bands, gain };
      bands.forEach((b: any, i: number) => { b.gain.value = gains[i] || 0; });
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }

  useEffect(() => {
    const subP = player.addListener('playingChange', (e: any) => setReproduciendo(!!e?.isPlaying));
    const subE = player.addListener('playToEnd', () => {
      setReproduciendo(false);
      // Avanza siempre que haya cola o repetición activa (el toggle autoSiguiente no bloquea el avance natural).
      siguiente(true);
    });
    const subErr = player.addListener('statusChange', (e: any) => {
      if (e?.status === 'error') {
        const msg = String(e?.error?.message || e?.error || e?.message || '');
        if (/abort/i.test(msg)) return; // clip reemplazado / carga cancelada: no es error real
        setError(msg || 'Error del reproductor');
      } else if (e?.status === 'readyToPlay') setDur(player.duration || 0);
    });
    return () => { try { subP.remove(); subE.remove(); subErr.remove(); } catch (e) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // Polling robusto de posición/duración (en web a veces no llega timeUpdate).
  // También sincroniza el botón play/pausa con el estado real del DOM.
  // IMPORTANTE: en Android nativo (modo === 'audio'), la posición la reporta QpAudio por eventos;
  // consultar `player.currentTime` (expo-video vacío) pisaba el tiempo a 0:00 cada 400ms alternando.
  useEffect(() => {
    const t = setInterval(() => {
      try {
        // En Web con iframe de YouTube embed: avanzamos la barra de tiempo en tiempo real
        if (Platform.OS === 'web' && mediaUriRef.current?.includes('/embed/')) {
          if (reproduciendoRef.current) {
            setPos((prev) => {
              const durTotal = actualRef.current?.duration || 0;
              const next = prev + 0.4;
              if (durTotal > 0 && next >= durTotal) {
                setTimeout(() => siguienteRef.current(true), 0);
                return durTotal;
              }
              return next;
            });
          }
          return;
        }

        if (!usarNativoRef.current) {
          const ct = player.currentTime;
          if (ct != null && isFinite(ct)) setPos(ct);
          const d = player.duration;
          if (d != null && isFinite(d) && d > 0) setDur(d);
        }
        if (Platform.OS === 'web') {
          const el = (globalThis as any).document?.querySelector('video') as any;
          if (el) {
            if (el.currentTime != null && isFinite(el.currentTime)) setPos(el.currentTime);
            if (el.duration != null && isFinite(el.duration) && el.duration > 0) setDur(el.duration);
            // Fuente de verdad: el.paused del DOM. Así el ícono siempre refleja la realidad.
            const realmenteSonando = !el.paused && !el.ended && Boolean(mediaUriRef.current);
            setReproduciendo(realmenteSonando);
          }
        }
      } catch (e) {}
    }, 400);
    return () => clearInterval(t);
  }, [player]);

  // Keepalive: despierta y mantiene el server Fly despierto para que el audio cargue al instante.
  useEffect(() => {
    const ping = () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000); // timeout 8s — si el server duerme y tarda no se cuelga
        fetch(API_URL + '/api/health', { signal: ctrl.signal })
          .then(() => clearTimeout(t))
          .catch(() => clearTimeout(t)); // silencioso: solo despierta el server
      } catch (e) {}
    };
    ping(); // Ping inmediato al abrir
    const t = setInterval(ping, 25000); // Y cada 25s
    return () => clearInterval(t);
  }, []);

  // ── Generar un WAV silencioso real de 2 segundos en memoria (16.000 muestras PCM) ──
  // Safari iOS exige que el audio tenga duración real > 0 para activar AVAudioSession en segundo plano y pantalla bloqueada
  function generarWavSilencioUrl(): string {
    try {
      const sampleRate = 8000;
      const durationSec = 2;
      const dataSize = sampleRate * durationSec;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, 'WAVE');
      writeStr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // Mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true); // 8-bit
      writeStr(36, 'data');
      view.setUint32(40, dataSize, true);
      new Uint8Array(buffer, 44).fill(128); // 128 = silencio PCM 8-bit
      const blob = new Blob([buffer], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    } catch (_) {
      return '';
    }
  }

  // ── Audio silencioso looped para mantener MediaSession activa en pantalla bloqueada / minimizada ──
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = generarWavSilencioUrl();
    if (!url) return;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.01; // Inaudible pero con flujo activo
    silentAudioRef.current = audio;
    return () => {
      try { audio.pause(); audio.remove(); URL.revokeObjectURL(url); } catch (_) {}
    };
  }, []);

  // Desbloqueo de AudioContext para Safari WebKit en iOS y macOS
  function unlockWebAudio() {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) {
        if (!(window as any).__qp_ac) (window as any).__qp_ac = new AC();
        if ((window as any).__qp_ac.state === 'suspended') {
          (window as any).__qp_ac.resume().catch(() => {});
        }
      }
      // Arrancar el audio silencioso persistente (requiere gesto de usuario para Safari)
      if (silentAudioRef.current && silentAudioRef.current.paused) {
        silentAudioRef.current.play().catch(() => {});
      }
    } catch (_) {}
  }

  // Escuchar eventos de la API IFrame de YouTube en Web para sincronización exacta y unMute automático
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onMsg = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!data) return;
        if (data.event === 'infoDelivery' && data.info) {
          if (data.info.playerState === 1) {
            setReproduciendo(true);
          } else if (data.info.playerState === 2) {
            setReproduciendo(false);
          } else if (data.info.playerState === 0) {
            siguienteRef.current(true);
          }
          if (typeof data.info.currentTime === 'number' && isFinite(data.info.currentTime)) {
            setPos(data.info.currentTime);
          }
          if (typeof data.info.duration === 'number' && isFinite(data.info.duration) && data.info.duration > 0) {
            setDur(data.info.duration);
          }
        }
        if (data.event === 'onReady') {
          const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
          if (el?.contentWindow) {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
            if (velocidadRef.current !== 1) {
              el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [velocidadRef.current] }), '*');
            }
            if (reproduciendoRef.current) {
              el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
            }
          }
        }
      } catch (_) {}
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ── Sincronizar posición de MediaSession para controles de lock screen ──
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      if (dur > 0 && pos >= 0) {
        (navigator.mediaSession as any).setPositionState({
          duration: dur,
          position: Math.min(pos, dur),
          playbackRate: velocidadRef.current || 1,
        });
      }
    } catch (_) {}
  }, [Math.floor(pos / 5), dur]); // Actualizar cada ~5s

  useEffect(() => {
    if (!mediaUri) return;
    if (mediaUri.startsWith('native:') || mediaUri.includes('/embed/')) return;
    setPos(0);
    setDur(0);
    pendingSeekRef.current = null;
    player.replace({ uri: mediaUri });
    if (Platform.OS === 'web') {
      const el = (globalThis as any).document?.querySelector('video') as any;
      if (el) {
        try {
          el.src = mediaUri;
          el.load();
        } catch (e) {}
      }
    }
    if (autoPlayRef.current) {
      player.play();
      if (Platform.OS === 'web') {
        const el = (globalThis as any).document?.querySelector('video') as any;
        if (el) el.play().catch(() => {});
      }
    } else {
      setReproduciendo(false);
      player.pause();
    }
  }, [mediaUri, player]);

  // En web, el estado real de reproducción y fin de canción lo dicta el <video> nativo.
  // Además aplica seek pendiente cuando el media ya tiene metadatos cargados.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = (globalThis as any).document?.querySelector('video') as any;
    if (!el) return;
    const onPlay = () => setReproduciendo(true);
    const onPause = () => setReproduciendo(false);
    const onEnded = () => {
      setReproduciendo(false);
      // Avanza siempre al terminar; el toggle autoSiguiente no debería bloquear el avance natural de la cola.
      siguiente(true);
    };
    // Cuando hay metadatos (duración conocida), aplicar seek pendiente si existe.
    const applyPendingSeek = () => {
      if (pendingSeekRef.current != null) {
        try { el.currentTime = pendingSeekRef.current; } catch (e) {}
        pendingSeekRef.current = null;
      }
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', applyPendingSeek);
    el.addEventListener('canplay', applyPendingSeek);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', applyPendingSeek);
      el.removeEventListener('canplay', applyPendingSeek);
    };
  }, [mediaUri]);

  function setAudio(v: boolean) {
    setSoloAudio(v); AsyncStorage.setItem('qp_soloAudio', v ? '1' : '0').catch(() => {});
    if (actual) aplicar(actual, v, idxRef.current);
  }
  function setAuto(v: boolean) { setAutoSiguiente(v); AsyncStorage.setItem('qp_autoSig', v ? '1' : '0').catch(() => {}); }
  function toggleShuffle() { const v = !shuffle; setShuffle(v); AsyncStorage.setItem('qp_shuffle', v ? '1' : '0').catch(() => {}); }
  function ciclarRepeat() {
    const next: Repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    setRepeat(next); AsyncStorage.setItem('qp_repeat', next).catch(() => {});
  }

  async function buscar() {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(null);
    try { const data = await api.search(q, 15); setResults(data.results || []); }
    catch (e: any) { setError(e?.message || 'Error de búsqueda'); setResults([]); }
    finally { setLoading(false); }
  }

  async function cargarLyrics(item: YtResult) {
    setCargandoLyrics(true);
    setLyricsData(null);
    try {
      const data = await buscarLyrics(item.id, item.title, item.channel, item.duration);
      setLyricsData(data);
      if (data && (modoLetra === 'traducida' || modoLetra === 'bilingue')) {
        ejecutarTraduccion(item.id, data.lines);
      }
    } catch (e) {
      setLyricsData(null);
    } finally {
      setCargandoLyrics(false);
    }
  }

  async function ejecutarTraduccion(id: string, lines: any[]) {
    setTraduciendoLyrics(true);
    try {
      const traducidas = await traducirLyrics(id, lines);
      setLyricsData((prev) => (prev ? { ...prev, lines: traducidas } : null));
    } catch (e) {
    } finally {
      setTraduciendoLyrics(false);
    }
  }

  async function cambiarModoLetra(nuevoModo: ModoLetra) {
    setModoLetra(nuevoModo);
    if ((nuevoModo === 'traducida' || nuevoModo === 'bilingue') && lyricsData && actual) {
      const yaTraducido = lyricsData.lines.some((l) => l.translation && l.translation !== l.text);
      if (!yaTraducido && !traduciendoLyrics) {
        ejecutarTraduccion(actual.id, lyricsData.lines);
      }
    }
  }

  async function aplicar(item: YtResult, audio: boolean, idx: number, autoPlay = true) {
    autoPlayRef.current = autoPlay;
    setActual(item);
    setPlayerVisible(true);
    setMediaUri(null);
    setError(null);
    setAudioTimeout(false);
    // Resetear auto-retry counter para esta canción
    sourceRetryRef.current = 0;
    actualRetryRef.current = item;
    if (sourceRetryTimerRef.current) { clearTimeout(sourceRetryTimerRef.current); sourceRetryTimerRef.current = null; }
    // Resetear ambos flags de carga nativa para que no queden pegados de la canción anterior
    setNativeBuffering(false);
    setNativeResolving(false);
    crossoverTriggeredRef.current = false;
    if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
    setModo(audio ? 'audio' : 'video');
    setReproduciendo(autoPlay);
    if (idx >= 0) {
      setQIdx(idx);
      idxRef.current = idx;
    }
    cargarLyrics(item);
    // Timeout de 12s: si en ese tiempo no llegó ningún evento del reproductor nativo,
    // mostramos botón de reintento en lugar del spinner infinito.
    if (audio) {
      audioTimeoutRef.current = setTimeout(() => {
        setAudioTimeout((prev) => {
          if (!prev) return true;
          return prev;
        });
      }, 12000);
    }
    // En Web (PC / iPhone Safari): reproducir directo vía iframe de YouTube sin depender del backend en la nube
    if (Platform.OS === 'web') {
      unlockWebAudio();
      if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
      const embedUrl = `https://www.youtube.com/embed/${item.id}?autoplay=1&enablejsapi=1&playsinline=1&controls=1&rel=0&origin=${encodeURIComponent(window.location?.origin || '')}`;
      setMediaUri(embedUrl);
      setReproduciendo(true);
      setError(null);
      setAudioTimeout(false);
      setPos(0);
      if (item.duration) setDur(item.duration);

      // Si el iframe ya existe en el DOM, forzar cambio directo de video con la API de YouTube
      const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
      if (el?.contentWindow) {
        try {
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'loadVideoById', args: [item.id] }), '*');
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          if (velocidadRef.current !== 1) {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [velocidadRef.current] }), '*');
          }
        } catch (_) {}
      }

      // Despertar y forzar reproducción inmediata para Safari iOS / Chrome / PC
      const forzarPlay = () => {
        const iframe = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          if (velocidadRef.current !== 1) {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [velocidadRef.current] }), '*');
          }
        }
      };

      setTimeout(forzarPlay, 200);
      setTimeout(forzarPlay, 600);
      setTimeout(forzarPlay, 1200);
      setTimeout(forzarPlay, 2200);

      // Registrar MediaSession para controles en pantalla de bloqueo de iPhone / Mac / Windows
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new (window as any).MediaMetadata({
            title: item.title,
            artist: item.channel || 'YouThink',
            album: 'YouThink Music',
            artwork: item.thumb ? [{ src: item.thumb, sizes: '512x512', type: 'image/jpeg' }] : [],
          });
          navigator.mediaSession.playbackState = 'playing';
          navigator.mediaSession.setActionHandler('play', () => {
            forzarPlay();
            setReproduciendo(true);
            navigator.mediaSession.playbackState = 'playing';
          });
          navigator.mediaSession.setActionHandler('pause', () => {
            const iframe = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
            if (iframe?.contentWindow) iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
            setReproduciendo(false);
            navigator.mediaSession.playbackState = 'paused';
          });
          navigator.mediaSession.setActionHandler('previoustrack', () => anterior());
          navigator.mediaSession.setActionHandler('nexttrack', () => siguiente(true));
          navigator.mediaSession.setActionHandler('seekto', (details: any) => {
            if (details?.seekTime != null) saltar(details.seekTime);
          });
          navigator.mediaSession.setActionHandler('seekforward', () => saltar(pos + 10));
          navigator.mediaSession.setActionHandler('seekbackward', () => saltar(pos - 10));
        } catch (e) {}
      }
      return;
    }
    try {
      if (audio && NATIVE_AUDIO) {
        setMediaUri('native:' + item.id);
        setError(null);
        await native.setEq(eqRef.current);
        if (autoPlay) await native.play(item.id, item.title);
        if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
      } else if (audio) { 
        await api.previewAudio(item.id); 
        setMediaUri(api.audioClipUrl(item.id));
        if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
      } else if (NATIVE_AUDIO && QpAudio) {
        // En Android: resolvemos el video directamente con NewPipe desde el celular (IP del usuario, sin bloqueo de bot ni demoras de servidor)
        const v = await QpAudio.resolveVideo(item.id);
        if (!v || !v.url) throw new Error('No se pudo extraer el video desde YouTube');
        setMediaUri(v.url);
      } else {
        await api.preview(item.id);
        setMediaUri(api.clipUrl(item.id));
      }
    } catch (e: any) { 
      setError(e?.message || 'No se pudo cargar el medio');
      if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
      setAudioTimeout(false);
    }
  }

  const versoActivoIdx = lyricsData?.lines
    ? (() => {
        const lines = lyricsData.lines;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (pos >= lines[i].time - 0.25) {
            return i;
          }
        }
        return -1;
      })()
    : -1;

  useEffect(() => {
    if (lyricsOpen && autoScrollLyrics && versoActivoIdx >= 0 && lyricsListRef.current) {
      try {
        lyricsListRef.current.scrollToIndex({
          index: versoActivoIdx,
          viewPosition: 0.35,
          animated: true,
        });
      } catch (e) {}
    }
  }, [versoActivoIdx, lyricsOpen, autoScrollLyrics]);

  function reproducir(lista: YtResult[], idx: number, audio: boolean) {
    if (!lista.length) return;
    unlockWebAudio();
    autoPlayRef.current = true;
    setReproduciendo(true);
    let arr = lista; let start = idx;
    if (shuffleRef.current) {
      const first = lista[idx];
      const rest = lista.filter((_, k) => k !== idx);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      arr = [first, ...rest]; start = 0;
    }
    setCola(arr); colaRef.current = arr; aplicar(arr[start], audio, start, true);
  }

  function siguiente(_?: any) {
    autoPlayRef.current = true;
    const c = colaRef.current;
    const i = idxRef.current;
    if (i + 1 < c.length) {
      aplicar(c[i + 1], audioRef.current, i + 1, true);
    } else if (repeatRef.current === 'all' && c.length) {
      aplicar(c[0], audioRef.current, 0, true);
    } else {
      if (usarNativoRef.current) native.pause();
      else player.pause();
      setReproduciendo(false);
    }
  }
  function anterior(_?: any) {
    autoPlayRef.current = true;
    const c = colaRef.current;
    const i = idxRef.current;
    if (i - 1 >= 0) {
      aplicar(c[i - 1], audioRef.current, i - 1, true);
    }
  }

  // Reproducir automáticamente cuando viene de la pantalla Sesion (tocar tema de YouTube o de YouThink)
  useEffect(() => {
    const pId = route.params?.autoPlayId;
    const pTitle = route.params?.autoPlayTitle || '';
    const pQueue: YtResult[] = route.params?.autoPlayQueue;
    const pIndex: number = typeof route.params?.autoPlayIndex === 'number' ? route.params?.autoPlayIndex : 0;

    if (pId) {
      setPlayerVisible(true);
      if (Array.isArray(pQueue) && pQueue.length > 0) {
        // Cargar toda la lista de canciones en la cola y arrancar desde la canción tocada
        reproducir(pQueue, Math.max(0, Math.min(pIndex, pQueue.length - 1)), soloAudio);
      } else {
        const item: YtResult = {
          id: pId,
          title: pTitle,
          url: `https://www.youtube.com/watch?v=${pId}`,
          channel: '',
          duration: 0,
          thumb: `https://i.ytimg.com/vi/${pId}/hqdefault.jpg`,
        };
        reproducir([item], 0, soloAudio);
      }
      // Limpiar params para no re-ejecutar en re-render
      navigation.setParams({
        autoPlayId: undefined,
        autoPlayTitle: undefined,
        autoPlayQueue: undefined,
        autoPlayIndex: undefined,
      });
    }

    const pSpeed = route.params?.autoSetSpeed;
    if (typeof pSpeed === 'number' && pSpeed > 0) {
      aplicarVelocidad(pSpeed);
      navigation.setParams({ autoSetSpeed: undefined });
    }
  }, [route.params?.autoPlayId, route.params?.autoSetSpeed]);
  function saltar(t: number) {
    const durTotal = dur > 0 ? dur : (actual?.duration || 0);
    const target = Math.max(0, Math.min(durTotal || 0, t || 0));
    if (usarNativoRef.current) { native.seek(target); setPos(target); return; }
    if (Platform.OS === 'web') {
      if ((mediaUri || mediaUriRef.current)?.includes('/embed/')) {
        const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [Math.round(target), true] }), '*');
        }
        setPos(target);
        return;
      }
      const el = (globalThis as any).document?.querySelector('video') as any;
      if (el) {
        if (el.readyState >= 1) {
          // Ya tiene metadatos: seek inmediato.
          try { el.currentTime = target; } catch (e) {}
        } else {
          // Aún no cargó metadatos: lo guardamos y lo aplicamos en loadedmetadata/canplay.
          pendingSeekRef.current = target;
        }
      }
    } else {
      try { player.currentTime = target; } catch (e) {}
    }
    setPos(target);
  }
  async function togglePlay() {
    if (usarNativoRef.current) {
      if (reproduciendo) {
        await native.pause();
        setReproduciendo(false);
      } else {
        await native.resume();
        setReproduciendo(true);
      }
      return;
    }
    const uri = mediaUri || mediaUriRef.current;
    // En web con iframe de YouTube: controlar via postMessage (YouTube IFrame API)
    if (Platform.OS === 'web' && uri?.includes('/embed/')) {
      const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
      if (iframe?.contentWindow) {
        if (reproduciendo) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
          setReproduciendo(false);
          try { silentAudioRef.current?.pause(); } catch (_) {}
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
          }
        } else {
          unlockWebAudio();
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          setReproduciendo(true);
          try { silentAudioRef.current?.play().catch(() => {}); } catch (_) {}
          if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
          }
        }
      }
      return;
    }
    if (Platform.OS === 'web') {
      const el = (globalThis as any).document?.querySelector('video') as any;
      if (el) {
        if (!el.src && uri) {
          try {
            el.src = uri;
            el.load();
          } catch (e) {}
        }
        if (el.paused) {
          try {
            await el.play();
            setReproduciendo(true);
            return;
          } catch (e) {
            console.warn('el.play fallo, usando player.play', e);
          }
        } else {
          el.pause();
          setReproduciendo(false);
          return;
        }
      }
    }
    try {
      if (reproduciendo) {
        player.pause();
        setReproduciendo(false);
      } else {
        player.play();
        setReproduciendo(true);
      }
    } catch (_) {}
  }
  function minimizar() {
    setPlayerVisible(false);
  }

  function cerrar() {
    if (usarNativoRef.current) native.stop();
    player.pause();
    // En web, pausar el iframe de YouTube antes de limpiar
    if (Platform.OS === 'web') {
      const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
      if (el?.contentWindow) {
        try { el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'); } catch (_) {}
      }
      // Pausar el audio silencioso de MediaSession
      if (silentAudioRef.current) {
        try { silentAudioRef.current.pause(); } catch (_) {}
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
      }
    }
    setActual(null);
    setPlayerVisible(false);
    setMediaUri(null);
    setQIdx(-1);
    setCola([]);
    colaRef.current = [];
    setLyricsOpen(false);
    setLyricsData(null);
  }

  // ── Actualizar app (abre enlace de APK) ──
  function actualizarApp() {
    try {
      Linking.openURL('https://expo.dev/artifacts/eas/_z2QQbuqUx1NnQnopPWJfk-POmYxEIWJ9K6X5RM1Wfg.apk');
    } catch (e) {}
  }

  // ── Descarga: abre la URL directa del audio/video en el navegador ──
  async function descargar() {
    if (!actual) return;
    setDescargando(true);
    const url = soloAudio ? api.audioClipUrl(actual.id) : api.clipUrl(actual.id);
    try {
      if (Platform.OS === 'web') {
        const a = (globalThis as any).document?.createElement('a');
        if (a) {
          a.href = url;
          a.download = (actual.title || actual.id) + (soloAudio ? '.m4a' : '.mp4');
          a.click();
        } else {
          (globalThis as any).window?.open(url, '_blank');
        }
      } else {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
        } else {
          await Linking.openURL(url);
        }
      }
    } catch (e: any) {
      console.warn('[Descarga]', e);
      Alert.alert('Descarga', 'Abriendo enlace de descarga en el navegador...');
      try { await Linking.openURL(url); } catch (_) {}
    } finally {
      setTimeout(() => setDescargando(false), 2500);
    }
  }

  // ── Listas de reproducción ──
  async function abrirModalPlaylists() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      // Cerrar el reproductor (no lo cerramos, solo navegamos a Sesión)
      navigation.navigate('Sesión');
      return;
    }
    setPlaylistModalOpen(true);
    setCargandoPlaylists(true);
    try {
      const data = await getPlaylists();
      setPlaylists(data);
    } catch (e) {}
    setCargandoPlaylists(false);
  }

  async function agregarALista(playlist: Playlist) {
    if (!actual) return;
    setAddingToPlaylist(true);
    try {
      await addToPlaylist(playlist.id, actual);
      setPlaylistModalOpen(false);
      setNuevaListaNombre('');
    } catch (e: any) {
      alert('Error: ' + (e?.message || 'no se pudo agregar'));
    }
    setAddingToPlaylist(false);
  }

  async function crearYAgregar() {
    const nombre = nuevaListaNombre.trim();
    if (!nombre) return;
    setCreandoLista(true);
    try {
      const pl = await createPlaylist(nombre);
      if (actual) await addToPlaylist(pl.id, actual);
      setPlaylists((prev) => [pl, ...prev]);
      setPlaylistModalOpen(false);
      setNuevaListaNombre('');
    } catch (e: any) {
      alert('Error: ' + (e?.message || 'no se pudo crear la lista'));
    }
    setCreandoLista(false);
  }

  // ── Info IA: pide a Gemini un párrafo sobre el artista/canción ──
  async function fetchInfo(item: YtResult) {
    setInfoOpen(true);
    setInfoData(null);
    setInfoError('');
    setInfoLoading(true);
    try {
      // Usamos la Gemini API con fallback de modelos disponibles
      const apiKey = GEMINI_KEY;
      if (!apiKey) throw new Error('Sin clave Gemini (EXPO_PUBLIC_GEMINI_KEY). Configurala en .env');
      const prompt = `Eres un musicólogo y crítico de cultura. Dame UN párrafo corto (máximo 120 palabras) en español rioplatense sobre:
Canción/video: "${item.title}"
Canal/Artista: "${item.channel}"

Contá algo interesante: curiosidades del artista, contexto del álbum, hito histórico, influencias, récords, o anécdota memorable. Sé específico y entretenido. Sin markdown, solo texto corrido.`;

      const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
      let lastErr: any = null;
      let text = '';

      for (const m of models) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
              }),
            }
          );
          if (res.ok) {
            const json = await res.json();
            text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text.trim()) {
              text = text.trim();
              break;
            }
          } else {
            const errBody = await res.json().catch(() => null);
            lastErr = new Error(errBody?.error?.message || 'HTTP ' + res.status);
          }
        } catch (e: any) {
          lastErr = e;
        }
      }

      if (!text) throw lastErr || new Error('Sin respuesta de la IA');
      setInfoData(text);
    } catch (e: any) {
      setInfoError(e?.message || 'No se pudo obtener info');
    }
    setInfoLoading(false);
  }

  const listaActiva = cola.length > 0 ? cola : results;
  const idxEfectivo = qIdx >= 0 ? qIdx : 0;
  const enCola = listaActiva.length > 1;
  const proximos = enCola ? listaActiva.slice(idxEfectivo + 1) : [];
  const durEfectiva = dur > 0 ? dur : (actual?.duration || 0);
  const estaSonando = Boolean(mediaUri && reproduciendo);

  const renderPlayerList = () => (
    <FlatList
      data={proximos}
      keyExtractor={(it) => 'q-' + it.id}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          {/* Slot de Video (Placeholder en Web para preservar espacio; iframe vive persistente en el portal) */}
          {Platform.OS === 'web' && mediaUri?.includes('/embed/') ? (
            modo === 'video' ? <View style={s.videoWeb} /> : null
          ) : Platform.OS !== 'web' && modo === 'video' ? (
            <VideoView
              player={player}
              style={s.video}
              nativeControls={true}
              fullscreenOptions={{ enable: true }}
              allowsPictureInPicture={true}
              contentFit="contain"
            />
          ) : null}

          {/* Portada en modo audio */}
          {modo === 'audio' ? (
            actual?.thumb ? (
              <Image
                source={{ uri: actual.thumb }}
                style={{
                  width: 220,
                  height: 220,
                  borderRadius: 16,
                  marginBottom: 16,
                  alignSelf: 'center',
                  backgroundColor: '#111',
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              />
            ) : (
              <View style={{ width: 180, height: 180, borderRadius: 16, backgroundColor: '#222', alignSelf: 'center', marginBottom: 16 }} />
            )
          ) : null}

          <View style={s.audioBox}>
            <Text style={s.audioTitle} numberOfLines={2}>{actual?.title}</Text>
            <Text style={s.audioSub}>{actual?.channel}</Text>
            {!mediaUri || (usarNativo && (nativeResolving || nativeBuffering) && !reproduciendo) ? (
              error || audioTimeout ? (
                <View style={{ alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <Text style={s.audioErr}>{error || 'Tiempo de espera agotado'}</Text>
                  {actual ? (
                    <Pressable
                      style={[s.updateBtn, { paddingHorizontal: 16 }]}
                      onPress={() => { setError(null); setMediaUri(null); setAudioTimeout(false); if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; } aplicar(actual, soloAudio, idxRef.current, true); }}
                    >
                      <Text style={s.updateBtnText}>🔄 Reintentar</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : <CargaAnim texto={nativeResolving ? "Resolviendo audio…" : "Cargando reproducción…"} />
            ) : null}
            <Barra pos={pos} dur={durEfectiva} onSeek={saltar} />
            <View style={s.timeRow}><Text style={s.timeText}>{fmtTiempo(pos)}</Text><Text style={s.timeText}>{fmtTiempo(durEfectiva)}</Text></View>
            <View style={s.ctrlRow}>
              <Pressable style={s.ctrlBtn} onPress={anterior} disabled={!enCola || qIdx <= 0}>
                <Text style={[s.ctrl, (!enCola || qIdx <= 0) && s.ctrlOff]}>⏮</Text>
              </Pressable>
              <Pressable style={s.ctrlBtn} onPress={() => saltar(pos - 15)}><Text style={s.ctrl}>⏪</Text></Pressable>
              <Pressable style={s.playBtnCenter} onPress={togglePlay}>
                <Text style={[s.playBtnCenterIcon, !estaSonando && { marginLeft: 3 }]}>
                  {estaSonando ? '⏸' : '▶'}
                </Text>
              </Pressable>
              <Pressable style={s.ctrlBtn} onPress={() => saltar(pos + 15)}><Text style={s.ctrl}>⏩</Text></Pressable>
              <Pressable style={s.ctrlBtn} onPress={siguiente} disabled={!enCola || (qIdx >= listaActiva.length - 1 && repeat !== 'all')}>
                <Text style={[s.ctrl, (!enCola || (qIdx >= listaActiva.length - 1 && repeat !== 'all')) && s.ctrlOff]}>⏭</Text>
              </Pressable>
            </View>

            {/* ── Botones de Descarga y Lista ── */}
            <View style={s.actionRow}>
              <Pressable
                style={[s.actionBtn, descargando && { opacity: 0.5 }]}
                onPress={descargar}
                disabled={!mediaUri || descargando}
              >
                <Text style={s.actionBtnIcon}>⬇️</Text>
                <Text style={s.actionBtnText}>{descargando ? 'Descargando…' : 'Descargar'}</Text>
              </Pressable>
              <Pressable
                style={s.actionBtn}
                onPress={abrirModalPlaylists}
                disabled={addingToPlaylist}
              >
                <Text style={s.actionBtnIcon}>➕</Text>
                <Text style={s.actionBtnText}>Añadir a lista</Text>
              </Pressable>
            </View>
          </View>

          <Text style={s.queueTitle}>A continuación{proximos.length ? ` (${proximos.length})` : ''}</Text>
        </View>
      }
      renderItem={({ item }) => {
        const realIdx = cola.length > 0 ? cola.indexOf(item) : results.indexOf(item);
        const isUpcoming = cola.length > 0 && realIdx > qIdx;
        const canMoveUp = isUpcoming && realIdx > qIdx + 1;
        const canMoveDown = isUpcoming && realIdx < cola.length - 1;

        return (
          <View style={s.qRow}>
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
              onPress={() => aplicar(item, soloAudio, realIdx, true)}
            >
              <Image source={{ uri: item.thumb }} style={s.qThumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.qTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={s.qSub} numberOfLines={1}>
                  {item.channel} {item.duration ? `· ${fmtTiempo(item.duration)}` : ''}
                </Text>
              </View>
            </Pressable>

            {/* Controles de orden de cola si está en la cola activa y es un tema próximo */}
            {isUpcoming ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 4 }}>
                <Pressable
                  style={[s.qActionBtn, !canMoveUp && { opacity: 0.25 }]}
                  disabled={!canMoveUp}
                  onPress={() => moverEnCola(realIdx, realIdx - 1)}
                >
                  <Text style={s.qActionText}>▲</Text>
                </Pressable>
                <Pressable
                  style={[s.qActionBtn, !canMoveDown && { opacity: 0.25 }]}
                  disabled={!canMoveDown}
                  onPress={() => moverEnCola(realIdx, realIdx + 1)}
                >
                  <Text style={s.qActionText}>▼</Text>
                </Pressable>
                <Pressable
                  style={[s.qActionBtn, { backgroundColor: 'rgba(255, 60, 60, 0.15)' }]}
                  onPress={() => quitarDeCola(realIdx)}
                >
                  <Text style={[s.qActionText, { color: '#ff5555' }]}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => aplicar(item, soloAudio, realIdx, true)} style={{ padding: 6 }}>
                <Text style={s.play}>▶</Text>
              </Pressable>
            )}
          </View>
        );
      }}
      ListEmptyComponent={<Text style={s.empty}>{enCola ? 'Es el último de la cola.' : 'Sin cola. Usá "Reproducir todo".'}</Text>}
    />
  );

  const renderPlayerContent = () => (
    <View style={s.modalContent}>
      <View style={s.modalHead}>
        <Pressable onPress={minimizar} style={{ padding: 8, marginRight: 6 }}>
          <Text style={{ color: theme.colors.textDim, fontSize: 22, fontWeight: '700' }}>⌄</Text>
        </Pressable>
        <Text style={s.modalTitle} numberOfLines={1}>{actual?.title}</Text>
        <Pressable onPress={cerrar} style={s.closeBtn}><Text style={s.closeText}>✕</Text></Pressable>
      </View>

      {/* Herramientas: Solo audio · Velocidad · Aleatorio · Repetir · Ecualizador · Listas · Info */}
      <View style={s.toolsRow}>
        <Pressable style={[s.tool, soloAudio && s.toolOn]} onPress={() => setAudio(!soloAudio)}>
          <Text style={[s.toolText, soloAudio && s.toolTextOn]}>🔊 {soloAudio ? 'Audio' : 'Video'}</Text>
        </Pressable>
        <Pressable style={[s.tool, velocidad !== 1 && s.toolOn]} onPress={() => setVelocidadOpen(true)}>
          <Text style={[s.toolText, velocidad !== 1 && s.toolTextOn]}>
            ⏱️ {velocidad !== 1 ? `${velocidad}x` : 'Velocidad'}
          </Text>
        </Pressable>
        <Pressable style={[s.tool, shuffle && s.toolOn]} onPress={toggleShuffle}>
          <Text style={[s.toolText, shuffle && s.toolTextOn]}>🔀 Aleatorio</Text>
        </Pressable>
        <Pressable style={[s.tool, repeat !== 'off' && s.toolOn]} onPress={ciclarRepeat}>
          <Text style={[s.toolText, repeat !== 'off' && s.toolTextOn]}>
            {repeat === 'one' ? '🔂 Repetir 1' : repeat === 'all' ? '🔁 Repetir todo' : '🔁 Repetir'}
          </Text>
        </Pressable>
        <Pressable style={[s.tool, eq !== 'flat' && s.toolOn]} onPress={() => setEqOpen(true)}>
          <Text style={[s.toolText, eq !== 'flat' && s.toolTextOn]}>🎚️ EQ</Text>
        </Pressable>
        <Pressable
          style={[s.tool, crossover && s.toolOn]}
          onPress={() => {
            const nuevo = !crossover;
            setCrossover(nuevo);
            crossoverRef.current = nuevo;
            AsyncStorage.setItem('qp_crossover', nuevo ? '1' : '0').catch(() => {});
          }}
        >
          <Text style={[s.toolText, crossover && s.toolTextOn]}>⚡ Crossover</Text>
        </Pressable>
        <Pressable
          style={[s.tool, lyricsOpen && s.toolOn]}
          onPress={() => {
            setLyricsOpen(true);
            if (actual && !lyricsData && !cargandoLyrics) {
              cargarLyrics(actual);
            }
          }}
        >
          <Text style={[s.toolText, lyricsOpen && s.toolTextOn]}>🎤 Letras</Text>
        </Pressable>
        <Pressable
          style={[s.tool, iniciandoRadio && s.toolOn]}
          onPress={() => actual && iniciarRadioDesdeActual(actual)}
          disabled={iniciandoRadio || !actual}
        >
          <Text style={[s.toolText, iniciandoRadio && s.toolTextOn]}>
            {iniciandoRadio ? '⏳ Sintonizando…' : '📻 Iniciar Radio'}
          </Text>
        </Pressable>
        <Pressable style={s.tool} onPress={abrirModalPlaylists}>
          <Text style={s.toolText}>📋 Listas</Text>
        </Pressable>
        <Pressable style={s.tool} onPress={() => actual && fetchInfo(actual)}>
          <Text style={s.toolText}>💡 Info</Text>
        </Pressable>
      </View>
      {eqOpen && !NATIVE_AUDIO && Platform.OS !== 'web' ? <Text style={s.eqNote}>El ecualizador requiere Web Audio (disponible en la versión web por ahora).</Text> : null}

      {renderPlayerList()}

      <Text style={s.hint}>
        {modo === 'video' ? 'Reproduciendo video.' : 'Audio optimizado.'}
        {enCola ? ' · Cola activa' : ''}{repeat !== 'off' ? (repeat === 'one' ? ' · Repetir 1' : ' · Repetir todo') : ''}{shuffle ? ' · Aleatorio' : ''}
      </Text>
    </View>
  );

  return (
    <View style={s.container}>
      {esIosSafari ? (
        <Pressable style={s.iosBanner} onPress={() => setIosInstallOpen(true)}>
          <Text style={s.iosBannerIcon}>📲</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.iosBannerTitle}>Instalar YouThink en este iPhone</Text>
            <Text style={s.iosBannerSub}>Usalo a pantalla completa como una app real</Text>
          </View>
          <Text style={s.iosBannerBtn}>Instalar ›</Text>
        </Pressable>
      ) : null}

      {/* ── LOGO YOUTHINK OFICIAL ── */}
      <View style={{ alignItems: 'center', marginBottom: 12, paddingTop: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            source={require('../../assets/youthink-logo.png')}
            style={{ width: 44, height: 44, resizeMode: 'contain' }}
          />
          <Text style={{ fontSize: 28, fontWeight: '900', color: theme.colors.gold, letterSpacing: 0.5 }}>
            YouThink
          </Text>
        </View>
      </View>

      <View style={s.searchRow}>
        <TextInput style={s.input} placeholder="Buscar música y videos…" placeholderTextColor={theme.colors.textDim}
          value={query} onChangeText={setQuery} onSubmitEditing={buscar} returnKeyType="search" autoCorrect={false} />
        <Pressable style={s.btn} onPress={buscar}><Text style={s.btnText}>🔎</Text></Pressable>
      </View>

      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>🔊 Solo audio (ahorra datos)</Text>
        <Switch value={soloAudio} onValueChange={setAudio} trackColor={{ true: theme.colors.gold, false: theme.colors.border }} />
      </View>
      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>⏭️ Avanzar solo a la siguiente</Text>
        <Switch value={autoSiguiente} onValueChange={setAuto} trackColor={{ true: theme.colors.gold, false: theme.colors.border }} />
      </View>
      <Pressable style={s.updateBtn} onPress={actualizarApp}>
        <Text style={s.updateBtnText}>🔄 Actualizar app</Text>
      </Pressable>

      {results.length > 0 ? (
        <Pressable style={s.playAll} onPress={() => reproducir(results, 0, soloAudio)}>
          <Text style={s.playAllText}>▶ Reproducir todo ({results.length})</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.colors.gold} style={{ marginTop: 24 }} /> : null}

      <FlatList data={results} keyExtractor={(it) => it.id} contentContainerStyle={{ paddingBottom: actual ? 90 : 24 }}
        renderItem={({ item, index }) => (
          <View style={[s.row, qIdx === index && cola[qIdx]?.id === item.id ? s.rowActiva : null]}>
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }} onPress={() => reproducir(results, index, soloAudio)}>
              <Image source={{ uri: item.thumb }} style={s.thumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={2}>{item.title}</Text>
                <Text style={s.sub} numberOfLines={1}>{item.channel} {item.duration ? `· ${fmtTiempo(item.duration)}` : ''}</Text>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              {actual ? (
                <Pressable
                  style={{ padding: 8, backgroundColor: theme.colors.surface2, borderRadius: 8 }}
                  onPress={() => encolarCancion(item)}
                >
                  <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>➕ Cola</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => reproducir(results, index, soloAudio)} style={{ padding: 6 }}>
                <Text style={s.play}>{qIdx === index && cola[qIdx]?.id === item.id ? '🔊' : soloAudio ? '🔊' : '▶'}</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            recomendaciones.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: theme.colors.gold }}>
                    🔥 Recomendados & Tendencias
                  </Text>
                  <Pressable onPress={cargarRecomendaciones} style={{ padding: 4 }}>
                    <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>🔄 Actualizar</Text>
                  </Pressable>
                </View>
                {cargandoRecomendaciones ? (
                  <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 20 }} />
                ) : (
                  recomendaciones.map((it, idx) => (
                    <View key={'rec-' + it.id} style={[s.row, { marginBottom: 10 }]}>
                      <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }} onPress={() => reproducir(recomendaciones, idx, soloAudio)}>
                        <Image source={{ uri: it.thumb }} style={s.thumb} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.title} numberOfLines={2}>{it.title}</Text>
                          <Text style={s.sub} numberOfLines={1}>
                            {it.channel} {it.duration ? `· ${fmtTiempo(it.duration)}` : ''}
                          </Text>
                        </View>
                      </Pressable>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                        {actual ? (
                          <Pressable
                            style={{ padding: 8, backgroundColor: theme.colors.surface2, borderRadius: 8 }}
                            onPress={() => encolarCancion(it)}
                          >
                            <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>➕ Cola</Text>
                          </Pressable>
                        ) : null}
                        <Pressable onPress={() => reproducir(recomendaciones, idx, soloAudio)} style={{ padding: 6 }}>
                          <Text style={s.play}>▶</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ) : (
              <Text style={s.empty}>Buscá un video o canción para empezar.</Text>
            )
          ) : null
        }
      />

      {/* Mini-reproductor flotante para móvil nativo (en Web se gestiona en el portal persistente) */}
      {actual && !playerVisible && Platform.OS !== 'web' ? (
        <Pressable
          style={s.miniPlayer}
          onPress={() => setPlayerVisible(true)}
        >
          <Image source={{ uri: actual.thumb }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#000' }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{actual.title}</Text>
            <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{actual.channel}</Text>
          </View>
          <Pressable onPress={togglePlay} style={{ padding: 8 }}>
            <Text style={{ color: theme.colors.gold, fontSize: 18 }}>{reproduciendo ? '⏸' : '▶'}</Text>
          </Pressable>
          <Pressable onPress={cerrar} style={{ padding: 8 }}>
            <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>✕</Text>
          </Pressable>
        </Pressable>
      ) : null}

      {/* ── Reproductor Web persistente via portal (escapa stacking context y mantiene audio en segundo plano) ── */}
      {Platform.OS === 'web' && (actual || mediaUri?.includes('/embed/')) && typeof document !== 'undefined' ? (
        (require('react-dom') as any).createPortal(
          <>
            {/* 1. Iframe persistente de YouTube: SIEMPRE montado, nunca se destruye al minimizar */}
            <View
              style={
                playerVisible && modo === 'video'
                  ? [
                      s.videoWeb,
                      {
                        position: 'fixed' as any,
                        top: 156,
                        left: 0,
                        right: 0,
                        marginLeft: 'auto' as any,
                        marginRight: 'auto' as any,
                        width: 'calc(100% - 32px)' as any,
                        maxWidth: 720,
                        zIndex: 100002,
                      },
                    ]
                  : {
                      position: 'fixed' as any,
                      bottom: 22,
                      left: 26,
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      overflow: 'hidden' as any,
                      zIndex: playerVisible ? 99999 : 100002,
                      opacity: 0.99,
                      pointerEvents: 'none' as any,
                    }
              }
            >
              {React.createElement('iframe', {
                id: 'yt-player-iframe',
                src: mediaUri || '',
                style: { width: '100%', height: '100%', border: 'none' },
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
                allowFullScreen: true,
              })}
            </View>

            {/* 2. Full Player Overlay (visible únicamente cuando playerVisible === true) */}
            {playerVisible && actual ? (
              <View
                style={[
                  s.modal,
                  {
                    position: 'fixed' as any,
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 100000,
                  } as any,
                ]}
              >
                {actual?.thumb ? (
                  <View
                    pointerEvents="none"
                    style={[s.modalBg, {
                      opacity: 0.35,
                      filter: 'blur(32px)',
                      transform: [{ scale: 1.15 }],
                      backgroundImage: `url(${actual.thumb})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    } as any]}
                  />
                ) : null}
                {renderPlayerContent()}
              </View>
            ) : null}

            {/* 3. Mini Player Web (visible cuando playerVisible === false) */}
            {!playerVisible && actual ? (
              <Pressable
                style={[s.miniPlayer, { position: 'fixed' as any, zIndex: 100001 }]}
                onPress={() => setPlayerVisible(true)}
              >
                <Image source={{ uri: actual.thumb }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#000' }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{actual.title}</Text>
                  <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{actual.channel}</Text>
                </View>
                <Pressable onPress={togglePlay} style={{ padding: 8 }}>
                  <Text style={{ color: theme.colors.gold, fontSize: 18 }}>{reproduciendo ? '⏸' : '▶'}</Text>
                </Pressable>
                <Pressable onPress={cerrar} style={{ padding: 8 }}>
                  <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>✕</Text>
                </Pressable>
              </Pressable>
            ) : null}
          </>,
          document.body
        )
      ) : Platform.OS !== 'web' ? (
        <Modal visible={Boolean(actual && playerVisible)} animationType="slide" onRequestClose={minimizar} statusBarTranslucent>
          <View style={s.modal}>
            {actual?.thumb ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Image
                  source={{ uri: actual.thumb }}
                  style={[s.modalBg, { opacity: 0.35, transform: [{ scale: 1.15 }] }]}
                  blurRadius={24}
                  resizeMode="cover"
                />
              </View>
            ) : null}
            {renderPlayerContent()}
          </View>
        </Modal>
      ) : null}

      {/* Panel de Ecualizador */}
      <Modal visible={eqOpen} transparent animationType="fade" onRequestClose={() => setEqOpen(false)}>
        <Pressable style={s.eqBackdrop} onPress={() => setEqOpen(false)}>
          <Pressable style={s.eqPanel} onPress={() => {}}>
            <Text style={s.eqTitle}>🎚️ Ecualizador</Text>
            <View style={s.eqGrid}>
              {Object.keys(EQ_PRESETS).map((k) => (
                <Pressable key={k} style={[s.eqItem, eq === k && s.eqItemOn]} onPress={() => aplicarEQ(k)}>
                  <Text style={[s.eqItemText, eq === k && s.toolTextOn]}>{EQ_PRESETS[k].label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.eqFoot}>
              {Platform.OS === 'web'
                ? 'Se aplica en vivo (Web Audio).'
                : NATIVE_AUDIO
                  ? 'Se aplica en vivo al reproductor nativo.'
                  : 'Ajuste guardado.'}
            </Text>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Panel de Modificador de Velocidad / Tempo */}
      <Modal visible={velocidadOpen} transparent animationType="fade" onRequestClose={() => setVelocidadOpen(false)}>
        <Pressable style={s.eqBackdrop} onPress={() => setVelocidadOpen(false)}>
          <Pressable style={s.eqPanel} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={s.eqTitle}>⏱️ Velocidad de Reproducción</Text>
              <Text style={{ color: theme.colors.gold, fontSize: 22, fontWeight: '900' }}>{velocidad}x</Text>
            </View>

            {/* Presets de velocidad */}
            <View style={s.eqGrid}>
              {[0.5, 0.75, 0.85, 0.9, 1.0, 1.1, 1.15, 1.25, 1.5, 1.75, 2.0].map((rate) => {
                const activo = velocidad === rate;
                return (
                  <Pressable
                    key={rate}
                    style={[s.eqItem, activo && s.eqItemOn]}
                    onPress={() => aplicarVelocidad(rate)}
                  >
                    <Text style={[s.eqItemText, activo && s.toolTextOn]}>
                      {rate === 1.0 ? '1.0x Normal' : `${rate}x`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Ajuste fino (+ / -) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}>
              <Pressable
                style={[s.eqItem, { flex: 1, paddingVertical: 10 }]}
                onPress={() => aplicarVelocidad(velocidad - 0.05)}
              >
                <Text style={s.eqItemText}>-0.05x</Text>
              </Pressable>
              <Pressable
                style={[s.eqItem, { flex: 1, paddingVertical: 10, backgroundColor: theme.colors.surface2 }]}
                onPress={() => aplicarVelocidad(1.0)}
              >
                <Text style={[s.eqItemText, { color: theme.colors.gold }]}>Restablecer (1x)</Text>
              </Pressable>
              <Pressable
                style={[s.eqItem, { flex: 1, paddingVertical: 10 }]}
                onPress={() => aplicarVelocidad(velocidad + 0.05)}
              >
                <Text style={s.eqItemText}>+0.05x</Text>
              </Pressable>
            </View>

            {/* Atajo hacia Tap Tempo */}
            <Pressable
              style={{
                marginTop: 16,
                backgroundColor: 'rgba(229, 178, 31, 0.15)',
                borderWidth: 1,
                borderColor: theme.colors.gold,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
              onPress={() => {
                setVelocidadOpen(false);
                minimizar();
                navigation.navigate('Tap Tempo');
              }}
            >
              <Text style={{ fontSize: 16 }}>🥁</Text>
              <Text style={{ color: theme.colors.gold, fontWeight: '800', fontSize: 13 }}>
                Abrir Tap Tempo & Sincronizador
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de Listas de Reproducción */}
      <Modal visible={playlistModalOpen} transparent animationType="fade" onRequestClose={() => setPlaylistModalOpen(false)}>
        <Pressable style={s.eqBackdrop} onPress={() => setPlaylistModalOpen(false)}>
          <Pressable style={[s.eqPanel, { maxHeight: '80%' }]} onPress={() => {}}>
            <Text style={s.eqTitle}>➕ Añadir a lista</Text>

            {/* Nueva lista */}
            <View style={s.plNewRow}>
              <TextInput
                style={s.plInput}
                placeholder="Nueva lista…"
                placeholderTextColor={theme.colors.textDim}
                value={nuevaListaNombre}
                onChangeText={setNuevaListaNombre}
                autoCorrect={false}
              />
              <Pressable
                style={[s.plCreateBtn, !nuevaListaNombre.trim() && { opacity: 0.4 }]}
                onPress={crearYAgregar}
                disabled={!nuevaListaNombre.trim() || creandoLista}
              >
                {creandoLista ? (
                  <ActivityIndicator color="#111" size="small" />
                ) : (
                  <Text style={s.plCreateBtnText}>Crear</Text>
                )}
              </Pressable>
            </View>

            {/* Listas existentes */}
            {cargandoPlaylists ? (
              <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 16 }} />
            ) : playlists.length === 0 ? (
              <Text style={[s.eqFoot, { marginTop: 12 }]}>No tenés listas. ¡Creá una arriba!</Text>
            ) : (
              <FlatList
                data={playlists}
                keyExtractor={(p) => p.id}
                style={{ maxHeight: 300 }}
                renderItem={({ item }) => (
                  <Pressable
                    style={s.plItem}
                    onPress={() => agregarALista(item)}
                    disabled={addingToPlaylist}
                  >
                    <Text style={s.plItemIcon}>🎵</Text>
                    <Text style={s.plItemText} numberOfLines={1}>{item.nombre}</Text>
                    {addingToPlaylist ? <ActivityIndicator color={theme.colors.gold} size="small" /> : <Text style={s.plItemArrow}>›</Text>}
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de Info IA */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable style={s.eqBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable style={s.eqPanel} onPress={() => {}}>
            {/* Cabecera con miniatura */}
            <View style={s.infoHead}>
              {actual?.thumb ? (
                <Image source={{ uri: actual.thumb }} style={s.infoThumb} />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={s.infoTitle} numberOfLines={2}>{actual?.title}</Text>
                <Text style={s.infoArtist} numberOfLines={1}>{actual?.channel}</Text>
              </View>
            </View>

            <View style={s.infoDivider} />

            {infoLoading ? (
              <View style={s.infoLoadingWrap}>
                <ActivityIndicator color={theme.colors.gold} />
                <Text style={s.infoLoadingText}>Consultando IA…</Text>
              </View>
            ) : infoError ? (
              <Text style={s.infoErrorText}>{infoError}</Text>
            ) : (
              <Text style={s.infoBody}>{infoData}</Text>
            )}

            <View style={s.infoFoot}>
              <Text style={s.infoFootLabel}>✨ Gemini</Text>
              <Pressable
                style={s.infoRefreshBtn}
                onPress={() => actual && fetchInfo(actual)}
                disabled={infoLoading}
              >
                <Text style={s.infoRefreshText}>↻ Regenerar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de instrucciones de instalación para iPhone */}
      <Modal visible={iosInstallOpen} transparent animationType="fade" onRequestClose={() => setIosInstallOpen(false)}>
        <Pressable style={s.eqBackdrop} onPress={() => setIosInstallOpen(false)}>
          <Pressable style={s.eqPanel} onPress={() => {}}>
            <Text style={s.eqTitle}>📲 Instalar en tu iPhone</Text>
            <Text style={[s.eqFoot, { textAlign: 'left', marginBottom: 14, color: theme.colors.text }]}>
              Instalalo en 5 segundos para usarlo a pantalla completa sin barras de Safari:
            </Text>

            <View style={{ gap: 12, marginVertical: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 20 }}>1️⃣</Text>
                <Text style={{ color: theme.colors.text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                  Tocá el botón <Text style={{ fontWeight: '800', color: theme.colors.gold }}>Compartir</Text> (el cuadradito con la flecha ⎋) abajo en Safari.
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 20 }}>2️⃣</Text>
                <Text style={{ color: theme.colors.text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                  Buscá y tocá <Text style={{ fontWeight: '800', color: theme.colors.gold }}>"Añadir a pantalla de inicio"</Text> ➕.
                </Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 20 }}>3️⃣</Text>
                <Text style={{ color: theme.colors.text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                  Tocá <Text style={{ fontWeight: '800', color: theme.colors.gold }}>"Añadir"</Text> arriba a la derecha.
                </Text>
              </View>
            </View>

            <View style={{ marginTop: 14, backgroundColor: theme.colors.surface2, padding: 10, borderRadius: 8 }}>
              <Text style={{ color: theme.colors.textDim, fontSize: 11, textAlign: 'center' }}>
                ✨ ¡Listo! Se abre independiente con su ícono en tu pantalla de inicio.
              </Text>
            </View>

            <Pressable
              style={[s.btn, { backgroundColor: theme.colors.gold, marginTop: 14, width: '100%' }]}
              onPress={() => setIosInstallOpen(false)}
            >
              <Text style={[s.btnText, { color: '#111' }]}>Entendido</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de Letras (Lyrics) en tiempo real con traducción */}
      <Modal visible={lyricsOpen} animationType="slide" onRequestClose={() => setLyricsOpen(false)} statusBarTranslucent>
        <View style={s.lyricsModal}>
          <View style={s.lyricsHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.lyricsTitle} numberOfLines={1}>{actual?.title}</Text>
              <Text style={s.lyricsArtist} numberOfLines={1}>{lyricsData?.artist || actual?.channel}</Text>
            </View>
            <Pressable onPress={() => setLyricsOpen(false)} style={s.closeBtn}>
              <Text style={s.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Selector de modo de idioma: Original | Traducida | Bilingüe */}
          <View style={s.lyricsTabs}>
            <Pressable style={[s.lyricsTab, modoLetra === 'original' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('original')}>
              <Text style={[s.lyricsTabText, modoLetra === 'original' && s.lyricsTabTextOn]}>🔤 Original</Text>
            </Pressable>
            <Pressable style={[s.lyricsTab, modoLetra === 'traducida' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('traducida')}>
              <Text style={[s.lyricsTabText, modoLetra === 'traducida' && s.lyricsTabTextOn]}>🌐 Español</Text>
            </Pressable>
            <Pressable style={[s.lyricsTab, modoLetra === 'bilingue' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('bilingue')}>
              <Text style={[s.lyricsTabText, modoLetra === 'bilingue' && s.lyricsTabTextOn]}>👥 Bilingüe</Text>
            </Pressable>
          </View>

          {traduciendoLyrics && (
            <View style={s.traduciendoBadge}>
              <ActivityIndicator size="small" color={theme.colors.gold} />
              <Text style={s.traduciendoText}>Traduciendo versos al español…</Text>
            </View>
          )}

          {cargandoLyrics ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={theme.colors.gold} />
              <Text style={[s.empty, { marginTop: 14 }]}>Buscando letra sincronizada en LRCLIB…</Text>
            </View>
          ) : !lyricsData || lyricsData.lines.length === 0 ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🎵</Text>
              <Text style={s.empty}>No se encontró letra disponible para esta canción.</Text>
              {actual ? (
                <Pressable style={[s.btn, { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16 }]} onPress={() => cargarLyrics(actual)}>
                  <Text style={{ fontWeight: '700', color: '#111' }}>🔄 Reintentar búsqueda</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <FlatList
              ref={lyricsListRef}
              data={lyricsData.lines}
              keyExtractor={(_, i) => `lyric-${i}`}
              contentContainerStyle={{ paddingVertical: 32, paddingHorizontal: 16 }}
              onScrollBeginDrag={() => setAutoScrollLyrics(false)}
              renderItem={({ item, index }) => {
                const activo = index === versoActivoIdx;
                const textoMostrar =
                  modoLetra === 'traducida'
                    ? item.translation || item.text
                    : item.text;

                return (
                  <Pressable
                    style={[s.lyricRow, activo && s.lyricRowActivo]}
                    onPress={() => {
                      if (item.time != null && isFinite(item.time)) {
                        saltar(item.time);
                        setAutoScrollLyrics(true);
                      }
                    }}
                  >
                    <Text style={[s.lyricText, activo && s.lyricTextActivo]}>
                      {textoMostrar}
                    </Text>
                    {modoLetra === 'bilingue' && item.translation && item.translation !== item.text && (
                      <Text style={[s.lyricTranslation, activo && s.lyricTranslationActivo]}>
                        {item.translation}
                      </Text>
                    )}
                  </Pressable>
                );
              }}
            />
          )}

          {/* Mini-player en el pie del modal de letras */}
          <View style={s.lyricsFooter}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Barra pos={pos} dur={durEfectiva} onSeek={saltar} />
              <View style={s.timeRow}>
                <Text style={s.timeText}>{fmtTiempo(pos)}</Text>
                <Text style={s.timeText}>{fmtTiempo(durEfectiva)}</Text>
              </View>
            </View>
            <Pressable style={s.lyricsPlayBtn} onPress={togglePlay}>
              <Text style={[s.lyricsPlayIcon, !estaSonando && { marginLeft: 2 }]}>
                {estaSonando ? '⏸' : '▶'}
              </Text>
            </Pressable>
            {!autoScrollLyrics && (
              <Pressable style={s.lyricsResumeBtn} onPress={() => setAutoScrollLyrics(true)}>
                <Text style={{ color: theme.colors.gold, fontSize: 12, fontWeight: '700' }}>⬇ Seguir</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg, padding: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: { flex: 1, backgroundColor: theme.colors.surface2, color: theme.colors.text, borderRadius: theme.radius, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  btn: { backgroundColor: theme.colors.gold, borderRadius: theme.radius, paddingHorizontal: 18, justifyContent: 'center' },
  btnText: { fontSize: 18 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  toggleLabel: { color: theme.colors.textDim, fontSize: 13 },
  updateBtn: { backgroundColor: theme.colors.surface2, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginBottom: 8 },
  updateBtnText: { color: theme.colors.gold, fontWeight: '600', fontSize: 13 },
  playAll: { backgroundColor: theme.colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginVertical: 8 },
  playAllText: { color: '#001b1f', fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8 },
  rowActiva: { backgroundColor: theme.colors.surface2 },
  thumb: { width: 96, height: 54, borderRadius: 8, backgroundColor: theme.colors.surface2 },
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
  play: { color: theme.colors.gold, fontSize: 18, paddingHorizontal: 8 },
  empty: { color: theme.colors.textDim, textAlign: 'center', marginTop: 24 },
  error: { color: theme.colors.danger, marginBottom: 8 },
  modal: { flex: 1, backgroundColor: '#000', padding: 16, paddingTop: 56 },
  modalBg: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    width: '100%', height: '100%',
    zIndex: 0,
  },
  modalContent: { flex: 1, zIndex: 1, position: 'relative' },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  closeBtn: { padding: 8 },
  closeText: { color: theme.colors.text, fontSize: 20 },
  toolsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  tool: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.border },
  toolOn: { backgroundColor: theme.colors.gold, borderColor: theme.colors.gold },
  toolText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  toolTextOn: { color: '#111' },
  eqNote: { color: theme.colors.textDim, fontSize: 12, marginBottom: 8 },
  miniPlayer: {
    position: 'absolute',
    bottom: 12,
    left: 16,
    right: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9000,
  },
  video: { width: '100%', height: 240, borderRadius: theme.radius, backgroundColor: '#111' },
  videoWeb: { width: '100%', maxWidth: 720, aspectRatio: 16 / 9, maxHeight: 360, alignSelf: 'center', borderRadius: theme.radius, overflow: 'hidden', backgroundColor: '#111', marginBottom: 12 },
  videoHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  audioBox: { width: '100%', borderRadius: theme.radius, backgroundColor: '#111', padding: 20, gap: 8 },
  audioIcon: { fontSize: 44, textAlign: 'center' },
  audioTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  audioSub: { color: theme.colors.textDim, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  cargaWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 10 },
  cargaRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 34 },
  barrita: { width: 6, height: 34, borderRadius: 3, backgroundColor: theme.colors.gold },
  cargaTexto: { color: theme.colors.textDim, fontSize: 13 },
  audioErr: { color: theme.colors.danger, fontSize: 13, textAlign: 'center' },
  barWrap: { width: '100%', paddingVertical: 10, justifyContent: 'center', cursor: 'pointer' } as any,
  barTrack: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, justifyContent: 'center', width: '100%', overflow: 'visible' as any },
  barFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, backgroundColor: theme.colors.gold },
  barKnob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.gold, marginLeft: -7, top: -4 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: theme.colors.textDim, fontSize: 12 },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  ctrlBtn: { padding: 8 },
  ctrl: { color: theme.colors.text, fontSize: 26 },
  ctrlOff: { opacity: 0.3 },
  playBtnCenter: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.gold,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  playBtnCenterIcon: {
    color: '#0a0a0a',
    fontSize: 26,
    fontWeight: '900',
  },
  playBig: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  playBigText: { color: '#111', fontSize: 26, fontWeight: '800' },
  queueTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  qThumb: { width: 72, height: 40, borderRadius: 6, backgroundColor: theme.colors.surface2 },
  qTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  qSub: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  qDurText: { color: theme.colors.textDim, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  navBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  navText: { color: theme.colors.text, fontWeight: '600' },
  navPos: { color: theme.colors.textDim, fontSize: 13 },
  hint: { color: theme.colors.textDim, fontSize: 12, marginTop: 12, textAlign: 'center' },
  eqBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  eqPanel: { width: '100%', maxWidth: 360, backgroundColor: theme.colors.surface, borderRadius: 16, padding: 20 },
  eqTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginBottom: 14, textAlign: 'center' },
  eqGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  eqItem: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  eqItemOn: { backgroundColor: theme.colors.gold, borderColor: theme.colors.gold },
  eqItemText: { color: theme.colors.text, fontWeight: '600' },
  eqFoot: { color: theme.colors.textDim, fontSize: 12, marginTop: 14, textAlign: 'center' },
  lyricsModal: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 16, paddingTop: 48 },
  lyricsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  lyricsTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800' },
  lyricsArtist: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
  lyricsTabs: { flexDirection: 'row', backgroundColor: theme.colors.surface, borderRadius: 12, padding: 4, gap: 6, marginBottom: 10 },
  lyricsTab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  lyricsTabOn: { backgroundColor: theme.colors.gold },
  lyricsTabText: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  lyricsTabTextOn: { color: '#111', fontWeight: '800' },
  traduciendoBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6, backgroundColor: 'rgba(244,207,63,0.1)', borderRadius: 8, marginBottom: 8 },
  traduciendoText: { color: theme.colors.gold, fontSize: 12, fontWeight: '600' },
  lyricRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, marginVertical: 3 },
  lyricRowActivo: { backgroundColor: 'rgba(244,207,63,0.14)' },
  lyricText: { color: 'rgba(255,255,255,0.45)', fontSize: 18, fontWeight: '600', lineHeight: 26 },
  lyricTextActivo: { color: theme.colors.gold, fontSize: 22, fontWeight: '800', lineHeight: 30 },
  lyricTranslation: { color: 'rgba(255,255,255,0.3)', fontSize: 14, fontStyle: 'italic', marginTop: 4, lineHeight: 20 },
  lyricTranslationActivo: { color: '#ffffff', opacity: 0.9, fontSize: 16, fontStyle: 'normal', fontWeight: '600' },
  lyricsFooter: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: '#0a0a0a' },
  lyricsPlayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.gold, alignItems: 'center', justifyContent: 'center' },
  lyricsPlayIcon: { color: '#0a0a0a', fontSize: 20, fontWeight: '900' },
  lyricsResumeBtn: { marginLeft: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },

  // Botones de acción del reproductor (Descargar / Añadir a lista)
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14, justifyContent: 'center' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  actionBtnIcon: { fontSize: 16 },
  actionBtnText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },

  // Modal de playlist
  plNewRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  plInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface2,
    fontSize: 14,
  },
  plCreateBtn: {
    backgroundColor: theme.colors.gold,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  plCreateBtnText: { color: '#111', fontWeight: '800', fontSize: 13 },
  plItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  plItemIcon: { fontSize: 18 },
  plItemText: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '600' },
  plItemArrow: { color: theme.colors.textDim, fontSize: 22, fontWeight: '300' },

  // Modal Info IA
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  infoThumb: { width: 64, height: 36, borderRadius: 6, backgroundColor: theme.colors.surface2 },
  infoTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700', lineHeight: 19 },
  infoArtist: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  infoDivider: { height: 1, backgroundColor: theme.colors.border, marginBottom: 14 },
  infoLoadingWrap: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  infoLoadingText: { color: theme.colors.textDim, fontSize: 13 },
  infoErrorText: { color: theme.colors.danger, fontSize: 13, lineHeight: 20 },
  infoBody: { color: theme.colors.text, fontSize: 15, lineHeight: 24, fontWeight: '400' },
  infoFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  infoFootLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: '600' },
  infoRefreshBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border },
  infoRefreshText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },

  // Banner instalador iPhone
  iosBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(244, 207, 63, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(244, 207, 63, 0.35)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  iosBannerIcon: { fontSize: 24 },
  iosBannerTitle: { color: theme.colors.gold, fontSize: 14, fontWeight: '700' },
  iosBannerSub: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  iosBannerBtn: { color: theme.colors.gold, fontSize: 13, fontWeight: '800' },

  // Botones de cola (mover arriba, mover abajo, quitar)
  qActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
    marginHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qActionText: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
});
