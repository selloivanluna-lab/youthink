import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVideoPlayer, VideoView } from 'expo-video';
import { api, YtResult } from '../lib/api';
// WebView: fallback de reproducción en Android cuando el módulo nativo no está
// disponible. Se carga sólo en nativo para no romper el bundle de web.
const NativeWebView: any =
  Platform.OS === 'web' ? null : require('react-native-webview').WebView;
import { NATIVE_AUDIO, useNativeAudio } from '../lib/nativeAudio';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';
import { buscarLyrics, traducirLyrics, LyricsData } from '../lib/lyrics';
import { getPlaylists, getLocalPlaylists, createPlaylist, addToPlaylist, getPlaylistItems, removeFromPlaylist, updatePlaylist, deletePlaylist, Playlist, PlaylistItem } from '../lib/playlists';
import { obtenerListasYouTube, agregarItemAPlaylistYouTube, obtenerItemsPlaylistYouTube, CACHE_YT_ITEMS_PREFIX } from '../lib/youtubeAuth';
import { useCast, CAST_ANDROID } from '../lib/cast';
import { TvPressable } from '../lib/useTvFocus';
import * as ScreenOrientation from 'expo-screen-orientation';
import { supabase } from '../lib/supabase';
import { API_URL, GEMINI_KEY } from '../config';
import { theme } from '../theme';
import { useNavigation, useRoute } from '@react-navigation/native';
import { playerStore } from '../lib/playerStore';
import MarqueeText from '../components/MarqueeText';
import { guardarProgreso, guardarProgresoInmediato, obtenerProgreso, borrarProgreso } from '../lib/playbackHistory';

// En Android se carga el botón nativo de Chromecast. En web el paquete ni se evalúa.
const CastButtonHost: any =
  CAST_ANDROID ? require('../components/CastButtonHost').default : null;

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
  const total = Math.floor(seg);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
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
  const wRef = useRef(0);
  const durRef = useRef(dur);
  const viewRef = useRef<any>(null);
  const pageXRef = useRef(0);
  durRef.current = dur;

  const calcFromPageX = (pageX: number) => {
    const width = wRef.current;
    if (width <= 0 || durRef.current <= 0) return null;
    const x = Math.max(0, Math.min(pageX - pageXRef.current, width));
    return (x / width) * durRef.current;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (e) => {
        const t = calcFromPageX(e.nativeEvent.pageX);
        if (t !== null) setSeekingPos(t);
      },
      onPanResponderMove: (e) => {
        const t = calcFromPageX(e.nativeEvent.pageX);
        if (t !== null) setSeekingPos(t);
      },
      onPanResponderRelease: (e) => {
        const t = calcFromPageX(e.nativeEvent.pageX);
        setSeekingPos(null);
        if (t !== null) onSeek(t);
      },
      onPanResponderTerminate: () => setSeekingPos(null),
    })
  ).current;

  const currentPos = seekingPos != null ? seekingPos : pos;
  const pct = dur > 0 ? Math.min(1, Math.max(0, currentPos / dur)) : 0;

  return (
    <View
      ref={viewRef}
      style={s.barWrap}
      hitSlop={{ top: 20, bottom: 20, left: 10, right: 10 }}
      onLayout={(e) => {
        wRef.current = e.nativeEvent.layout.width;
        setW(e.nativeEvent.layout.width);
        // Medir posición absoluta en pantalla
        viewRef.current?.measure((_x: number, _y: number, _w: number, _h: number, px: number) => {
          pageXRef.current = px;
        });
      }}
      {...panResponder.panHandlers}
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
  const tv = useCast();
  const tvRef = useRef(false);
  const tvCargandoRef = useRef('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<YtResult[]>([]);
  const [searchType, setSearchType] = useState<'all' | 'videos' | 'songs' | 'playlists'>('all');
  const [cargandoPlaylistId, setCargandoPlaylistId] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const searchReqRef = useRef(0);
  const [recomendaciones, setRecomendaciones] = useState<YtResult[]>([]);
  const [cargandoRecomendaciones, setCargandoRecomendaciones] = useState(false);
  const [historial, setHistorial] = useState<YtResult[]>([]);
  const historialRef = useRef<YtResult[]>([]);
  useEffect(() => { historialRef.current = historial; }, [historial]);
  const [iniciandoRadio, setIniciandoRadio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actual, setActual] = useState<YtResult | null>(null);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  // Fallback Android: si no hay módulo nativo, el video de YouTube se reproduce
  // dentro de un WebView (usa la IP del teléfono, no depende del backend).
  const [webEmbedUri, setWebEmbedUri] = useState<string | null>(null);
  // APK download banner (web only) — se actualiza automáticamente con el último GitHub Release
  const [apkRelease, setApkRelease] = useState<{ url: string; version: string; build: string } | null>(null);
  const webViewRef = useRef<any>(null);
  const [modo, setModo] = useState<Modo>('audio');
  const [soloAudio, setSoloAudio] = useState(true);
  const [reproduciendo, setReproduciendo] = useState(false);
  const reproduciendoRef = useRef(false);
  useEffect(() => { reproduciendoRef.current = reproduciendo; }, [reproduciendo]);
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  useEffect(() => { posRef.current = pos; }, [pos]);
  const [dur, setDur] = useState(0);
  const durRef = useRef(0);
  useEffect(() => { durRef.current = dur; }, [dur]);
  const finDisparadoRef = useRef(false);
  // Guarda anti-duplicado: varios listeners (ended del nativo, playerState 0 del
  // iframe, polling web) pueden avisar del mismo final. Sin esto se salteaba un tema.
  const finGuardRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const trackStartTimeRef = useRef(0);
  const currentTrackIdRef = useRef<string>('');
  const hasStartedPlayingCurrentTrackRef = useRef<boolean>(false);
  const crossoverFadingRef = useRef<boolean>(false);
  const crossoverFadeTimerRef = useRef<any>(null);
  const [audioTimeout, setAudioTimeout] = useState(false);
  const audioTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resumingInfo, setResumingInfo] = useState<{ pos: number; trackId: string } | null>(null);
  // Auto-retry en Source Error: reintentar play hasta 3 veces automáticamente
  const sourceRetryRef = useRef(0);
  const sourceRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackWebViewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actualRetryRef = useRef<YtResult | null>(null);
  const forzarPlayTimersRef = useRef<any[]>([]);

  // Función auxiliar para graduar volumen del iframe de YouTube (Web) sin mutear
  function setWebPlayerVolume(vol: number) {
    if (Platform.OS !== 'web') return;
    try {
      const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
      if (el?.contentWindow) {
        el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [Math.max(0, Math.min(100, Math.round(vol)))] }), '*');
      }
    } catch (_) {}
  }

  // ── Fallback WebView (Android sin módulo nativo) ──────────────────────────
  // Si `QpAudio` no está disponible, reproducimos el embed oficial de YouTube
  // dentro de un WebView. Usa la IP del teléfono (no pasa por el backend de
  // Render, que YouTube bloquea) y funciona en cualquier Android con WebView.
  const WEBVIEW_MONITOR = `
    (function () {
      if (window.__qpMonitor) return;
      window.__qpMonitor = true;
      var last = -1;
      function tick() {
        try {
          var v = document.querySelector('video');
          if (v && window.ReactNativeWebView) {
            var t = v.currentTime || 0;
            var d = v.duration || 0;
            if (Math.abs(t - last) >= 0.25 || v.paused) {
              last = t;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                __qp: 1, t: t, d: d, p: !v.paused, e: !!v.ended
              }));
            }
          }
        } catch (e) {}
      }
      setInterval(tick, 500);
      tick();
    })();
    true;
  `;

  function webViewCmd(js: string) {
    try { webViewRef.current?.injectJavaScript(js + ';true;'); } catch (_) {}
  }

  function abrirEnYoutube(id?: string) {
    const vid = id || actual?.id;
    if (!vid) return;
    Linking.openURL('https://www.youtube.com/watch?v=' + vid).catch(() => {});
  }

  function usarWebView(item: YtResult) {
    if (!item?.id) return;
    // Si la pista activa cambió antes del fallback, descartar para no superponer audio
    if (currentTrackIdRef.current && item.id !== currentTrackIdRef.current) return;
    try { native.pause(); native.stop(); } catch (_) {}
    try { player.pause(); } catch (_) {}
    const cleanId = (item.id || '').trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
    // Embeber reproductor con HTML limpio y YouTube IFrame API oficial en WebView
    const embedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          * { margin:0; padding:0; overflow:hidden; background:#000; width:100%; height:100%; }
        </style>
      </head>
      <body>
        <div id="player"></div>
        <script>
          var tag = document.createElement('script');
          tag.src = "https://www.youtube.com/iframe_api";
          var firstScriptTag = document.getElementsByTagName('script')[0];
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
          var player;
          function onYouTubeIframeAPIReady() {
            player = new YT.Player('player', {
              videoId: '${cleanId}',
              playerVars: {
                'autoplay': 1,
                'playsinline': 1,
                'controls': 1,
                'rel': 0,
                'modestbranding': 1,
                'iv_load_policy': 3,
                'origin': 'https://www.youtube.com'
              },
              events: {
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
              }
            });
          }
          function onPlayerError(e) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ __qpErr: e.data }));
            }
          }
          function onPlayerStateChange(e) {
            if (e.data === 0 && window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ __qp: 1, e: true }));
            }
          }
        </script>
      </body>
      </html>
    `;
    setWebEmbedUri(embedHtml);
    setMediaUri('webview:' + item.id);
    mediaUriRef.current = 'webview:' + item.id;
    setPos(0); posRef.current = 0;
    const initialDur = item.duration || 0;
    setDur(initialDur); durRef.current = initialDur;
    setReproduciendo(true);
    reproduciendoRef.current = true;
    setError(null);
    setAudioTimeout(false);
    if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
  }

  function onWebViewMessage(ev: any) {
    try {
      const d = JSON.parse(ev?.nativeEvent?.data || '{}');
      if (d && d.__qpErr != null) {
        // Error de YouTube detectado (101, 150, 152, 153, etc.) -> avanzar
        setTimeout(() => avanzarPorFin(), 1200);
        return;
      }
      if (!d || d.__qp !== 1) return;
      if (isFinite(d.t) && d.t >= 0) { setPos(d.t); posRef.current = d.t; }
      if (isFinite(d.d) && d.d > 0) { setDur(d.d); durRef.current = d.d; }
      setReproduciendo(Boolean(d.p));
      if (d.e) {
        // Igual que en nativo: sólo avanzamos si terminó de verdad (evita
        // saltear temas cuando el embed falla al instante o en audios largos).
        const t = Number(d.t || 0);
        const dd = Number(d.d || 0);
        const dEsperada = Math.max(dd, durRef.current || 0, actualRef.current?.duration || 0);
        const terminoDeVerdad = dEsperada > 0 ? (t >= dEsperada - 6) : (t > 15);
        if (terminoDeVerdad) avanzarPorFin();
      }
    } catch (_) {}
  }

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'youthink-modal-zindex';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
          div[aria-modal="true"],
          body > div:has([aria-modal="true"]),
          body > div:has([aria-modal="true"]) > div {
            z-index: 110000 !important;
          }
        `;
        document.head.appendChild(style);
      }
    }
  }, []);

  // Cola / modos
  const [cola, setCola] = useState<YtResult[]>([]);
  const [qIdx, setQIdx] = useState(-1);
  const colaRef = useRef<YtResult[]>([]);
  const idxRef = useRef(-1);
  const audioRef = useRef(true);
  const actualRef = useRef<YtResult | null>(null);
  useEffect(() => { actualRef.current = actual; }, [actual]);
  const [autoSiguiente, setAutoSiguiente] = useState(true);
  const autoRef = useRef(true);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  // Solo las colas generadas automáticamente (radio / recomendados) se extienden
  // solas. Una lista del usuario debe respetarse tal cual.
  const autoExtenderRef = useRef(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const repeatRef = useRef<Repeat>('off');
  const [crossover, setCrossover] = useState(true);
  const crossoverRef = useRef(true);
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

  // Control de rotación de pantalla (modo horizontal / landscape para video)
  const [esLandscape, setEsLandscape] = useState(false);

  useEffect(() => {
    return () => {
      if (Platform.OS !== 'web') {
        ScreenOrientation.unlockAsync().catch(() => {});
      }
    };
  }, []);

  async function alternarRotacion() {
    const next = !esLandscape;
    setEsLandscape(next);
    if (Platform.OS !== 'web') {
      try {
        if (next) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch (_) {}
    } else if (typeof window !== 'undefined') {
      try {
        if (next) {
          (window.screen?.orientation as any)?.lock?.('landscape').catch(() => {});
        } else {
          (window.screen?.orientation as any)?.unlock?.();
        }
      } catch (_) {}
    }
  }

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
      const sendIframeSpeed = () => {
        const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [r] }), '*');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [r] }), 'https://www.youtube.com');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [r, true] }), '*');
          } catch (_) {}
        }
        try {
          if ((window as any).ytPlayer?.setPlaybackRate) {
            (window as any).ytPlayer.setPlaybackRate(r);
          }
        } catch (_) {}
      };
      sendIframeSpeed();
      setTimeout(sendIframeSpeed, 100);
      setTimeout(sendIframeSpeed, 300);
      setTimeout(sendIframeSpeed, 700);
      setTimeout(sendIframeSpeed, 1500);

      // Aplicar incondicionalmente a todos los tags de audio y video
      try {
        const medias = (globalThis as any).document?.querySelectorAll('video, audio');
        if (medias) {
          medias.forEach((m: any) => {
            try {
              m.playbackRate = r;
              m.defaultPlaybackRate = r;
            } catch (_) {}
          });
        }
      } catch (_) {}

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
      try { (player as any).playbackRate = r; } catch (_) {}
      if (webEmbedUri) {
        try {
          webViewCmd(`if(window.player && window.player.setPlaybackRate){ window.player.setPlaybackRate(${r}); } else { var vs=document.querySelectorAll('video,audio'); for(var i=0;i<vs.length;i++){ vs[i].playbackRate=${r}; vs[i].defaultPlaybackRate=${r}; } }`);
        } catch (_) {}
      }
      if (usarNativoRef.current) {
        try { native.setSpeed(r); } catch (_) {}
      }
    }
  }

  function recargarConVelocidad(rate: number) {
    if (!actual) return;
    aplicarVelocidad(rate);
    const targetSeek = pos > 0 ? pos : 0;
    pendingSeekRef.current = targetSeek;
    aplicar(actual, soloAudio, qIdx, true);
    setTimeout(() => {
      saltar(targetSeek);
    }, 600);
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
  const [managingPlaylist, setManagingPlaylist] = useState<Playlist | null>(null);
  const [managingItems, setManagingItems] = useState<PlaylistItem[]>([]);
  const [loadingManagingItems, setLoadingManagingItems] = useState(false);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  // Renombrar playlist
  const [renombrando, setRenombrando] = useState<Playlist | null>(null);
  const [renombreTexto, setRenombreTexto] = useState('');

  // Radio inteligente: Likes y Dislikes para afinar la estación en vivo
  const [radioLikes, setRadioLikes] = useState<Set<string>>(new Set());
  const [radioDislikes, setRadioDislikes] = useState<Set<string>>(new Set());
  const [radioLikedArtists, setRadioLikedArtists] = useState<Set<string>>(new Set());
  const [radioDislikedArtists, setRadioDislikedArtists] = useState<Set<string>>(new Set());
  const radioLikesRef = useRef<Set<string>>(new Set());
  const radioDislikesRef = useRef<Set<string>>(new Set());
  const radioDislikedArtistsRef = useRef<Set<string>>(new Set());
  const [toastFeedback, setToastFeedback] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  function mostrarToast(msg: string) {
    setToastFeedback(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastFeedback(null);
    }, 2800);
  }

  // ── Radio inteligente: dar like / dislike ──
  function darLike() {
    if (!actual) return;
    const id = actual.id;
    const artist = actual.channel || '';
    // Quitar de dislikes si estaba
    const dl = new Set(radioDislikesRef.current);
    dl.delete(id);
    setRadioDislikes(dl);
    radioDislikesRef.current = dl;
    // Quitar artista de disliked si no quedan dislikes de ese artista
    if (artist) {
      const da = new Set(radioDislikedArtistsRef.current);
      da.delete(artist);
      setRadioDislikedArtists(da);
      radioDislikedArtistsRef.current = da;
    }
    // Agregar a likes
    const lk = new Set(radioLikesRef.current);
    lk.add(id);
    setRadioLikes(lk);
    radioLikesRef.current = lk;
    // Agregar artista a liked
    if (artist) {
      const la = new Set(radioLikedArtists);
      la.add(artist);
      setRadioLikedArtists(la);
    }
    // Persistir
    AsyncStorage.setItem('qp_radio_likes', JSON.stringify([...lk])).catch(() => {});
    AsyncStorage.setItem('qp_radio_dislikes', JSON.stringify([...dl])).catch(() => {});
    mostrarToast('👍 Te gusta — más temas así');
  }

  function darDislike() {
    if (!actual) return;
    const id = actual.id;
    const artist = actual.channel || '';
    // Quitar de likes si estaba
    const lk = new Set(radioLikesRef.current);
    lk.delete(id);
    setRadioLikes(lk);
    radioLikesRef.current = lk;
    // Agregar a dislikes
    const dl = new Set(radioDislikesRef.current);
    dl.add(id);
    setRadioDislikes(dl);
    radioDislikesRef.current = dl;
    // Agregar artista a disliked
    if (artist) {
      const da = new Set(radioDislikedArtistsRef.current);
      da.add(artist);
      setRadioDislikedArtists(da);
      radioDislikedArtistsRef.current = da;
    }
    // Persistir
    AsyncStorage.setItem('qp_radio_likes', JSON.stringify([...lk])).catch(() => {});
    AsyncStorage.setItem('qp_radio_dislikes', JSON.stringify([...dl])).catch(() => {});
    mostrarToast('👎 No te gusta — menos temas así');
    // Auto-skip al siguiente
    setTimeout(() => siguiente(), 600);
  }

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
  const lastAutoPlayConsumedRef = useRef('');
  const modoRef = useRef<Modo>(modo);
  const eqRef = useRef(eq);
  const siguienteRef = useRef<(auto?: any) => void>(() => {});
  const [nativeBuffering, setNativeBuffering] = useState(false);
  const [nativeResolving, setNativeResolving] = useState(false);

  useEffect(() => { usarNativoRef.current = usarNativo; }, [usarNativo]);
  useEffect(() => { modoRef.current = modo; }, [modo]);
  useEffect(() => { eqRef.current = eq; }, [eq]);
  const anteriorRef = useRef<any>(() => {});
  useEffect(() => { siguienteRef.current = siguiente; });
  useEffect(() => { anteriorRef.current = anterior; });
  const recomendacionesRef = useRef<YtResult[]>([]);
  useEffect(() => { recomendacionesRef.current = recomendaciones; }, [recomendaciones]);

  // ── Fin de pista: un único avance por canción ──────────────────────────────
  // Antes, el reproductor nativo, el iframe de YouTube y el polling web podían
  // disparar "siguiente" dos veces por el mismo final (o un evento tardío de la
  // canción anterior), lo que hacía saltar temas de la cola sin reproducirlos.
  function avanzarPorFin(trackId?: string) {
    const id = String(trackId || '').trim();
    // Evento de una pista vieja que llega después del cambio: ignorar.
    if (id && currentTrackIdRef.current && id !== currentTrackIdRef.current) return;
    const g = finGuardRef.current;
    if (g.id && g.id === currentTrackIdRef.current && Date.now() - g.at < 4000) return;
    finGuardRef.current = { id: currentTrackIdRef.current, at: Date.now() };
    finDisparadoRef.current = true;
    if (currentTrackIdRef.current) {
      borrarProgreso(currentTrackIdRef.current);
    }
    siguienteRef.current(true);
  }

  // Reinicia la canción actual desde 0 (para "Repetir 1").
  function reiniciarActual() {
    setPos(0);
    posRef.current = 0;
    finDisparadoRef.current = false;
    finGuardRef.current = { id: '', at: 0 };
    if (tvRef.current) {
      if (actual) {
        tvCargandoRef.current = '';
        const esAudio = actual.kind === 'song';
        const itemActual = actual;
        (async () => {
          const directo = await resolverParaTv(itemActual, esAudio);
          tv.transmitir(
            {
              id: itemActual.id,
              title: itemActual.title,
              channel: itemActual.channel,
              thumb: itemActual.thumb,
              url: directo?.url || (esAudio ? api.audioClipUrl(itemActual.id) : api.clipUrl(itemActual.id)),
              contentType: directo?.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
              duration: itemActual.duration,
              startTime: 0,
            },
            () => resolverParaTv(itemActual, esAudio, true),
            async () => (await pedidosTv()) > 0,
          );
        })();
      }
      setReproduciendo(true);
      return;
    }
    if (usarNativoRef.current) {
      try { native.seek(0); native.resume(); } catch (_) {}
      setReproduciendo(true);
      return;
    }
    if (webEmbedUri) {
      webViewCmd("var v=document.querySelector('video'); if(v){v.currentTime=0; v.play();}");
      setPos(0); posRef.current = 0;
      setReproduciendo(true);
      return;
    }
    if (Platform.OS === 'web') {
      const uri = mediaUriRef.current || '';
      if (uri.includes('/embed/')) {
        const iframe = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          try {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [0, true] }), '*');
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          } catch (_) {}
        }
        setReproduciendo(true);
        reproduciendoRef.current = true;
        return;
      }
    }
    saltar(0);
    try { player.play(); } catch (_) {}
    setReproduciendo(true);
  }

  // Estado del reproductor nativo: llega por eventos (se actualiza fuera del render).
  useEffect(() => {
    if (!NATIVE_AUDIO || !QpAudio || typeof (QpAudio as any).addListener !== 'function') return;
    try {
      const sub = (QpAudio as any).addListener('onPlaybackState', (st: any) => {
        // Eventos de botones multimedia Bluetooth (Next / Prev / Doble-click)
        if (st.action === 'next') {
          siguienteRef.current(true);
          return;
        }
        if (st.action === 'prev') {
          anteriorRef.current();
          return;
        }

        if (modoRef.current !== 'audio') return;

        // Ignorar eventos que llegan tarde de la pista anterior (mediaId distinto).
        const evId = st.mediaId ? String(st.mediaId) : '';
        if (evId && currentTrackIdRef.current && evId !== currentTrackIdRef.current) return;

        if (typeof st.isPlaying === 'boolean') setReproduciendo(st.isPlaying);
        if (isFinite(st.position) && st.position >= 0) {
          setPos(st.position);
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
                const retryPos = posRef.current > 0 ? posRef.current : 0;
                await native.play(itemToRetry.id, itemToRetry.title, itemToRetry.channel || '', itemToRetry.thumb || '', retryPos);
              } catch (_) {}
            }, 800 * retryN); // backoff: 800ms, 1600ms, 2400ms
          } else {
            setError(st.error);
            // Si el reproductor nativo no puede con este tema, seguimos con el
            // embed de YouTube en el WebView solo si el usuario sigue en esta pista.
            const tr = actualRetryRef.current;
            if (tr && !tvRef.current && tr.id === currentTrackIdRef.current) {
              if (fallbackWebViewTimerRef.current) clearTimeout(fallbackWebViewTimerRef.current);
              fallbackWebViewTimerRef.current = setTimeout(() => {
                if (tr.id === currentTrackIdRef.current) {
                  try { usarWebView(tr); } catch (_) {}
                }
              }, 600);
            }
          }
        }
        // Fin natural de la pista: NO adelantamos por "crossover" (cortaba el
        // último segundo). ExoPlayer avisa `ended` cuando termina de verdad.
        // Guard: algunos streams inválidos pasan a ENDED sin haber sonado; en ese
        // caso NO salteamos el tema (era el "carga pero se saltea sola"), usamos
        // el fallback de WebView solo si la pista sigue activa.
        if (st.ended) {
          const ppos = Number(st.position || 0);
          const pdur = Number(st.duration || 0);
          const dEsperada = Math.max(pdur, durRef.current || 0, actualRef.current?.duration || 0);
          const terminoDeVerdad = dEsperada > 0 ? (ppos >= dEsperada - 6) : false;
          if (terminoDeVerdad) {
            avanzarPorFin(evId);
          } else if (dEsperada > 30 && ppos < dEsperada - 20) {
            // Fin prematuro por corte de stream HTTP en audios largos: reanudar inmediatamente en la posición actual
            const tr = actualRetryRef.current;
            if (tr && !tvRef.current && tr.id === currentTrackIdRef.current) {
              native.play(tr.id, tr.title, tr.channel || '', tr.thumb || '', ppos).catch(() => {});
            }
          } else {
            const tr = actualRetryRef.current;
            if (tr && !tvRef.current && tr.id === currentTrackIdRef.current) {
              if (fallbackWebViewTimerRef.current) clearTimeout(fallbackWebViewTimerRef.current);
              fallbackWebViewTimerRef.current = setTimeout(() => {
                if (tr.id === currentTrackIdRef.current) {
                  try { usarWebView(tr); } catch (_) {}
                }
              }, 300);
            }
          }
        }
      });
      return () => {
        try { sub?.remove?.(); } catch (_) {}
      };
    } catch (_) {}
  }, []);

  useEffect(() => { mediaUriRef.current = mediaUri; }, [mediaUri]);

  // Guardado periódico de progreso cada 4 segundos para recuperación exacta
  useEffect(() => {
    const iv = setInterval(() => {
      if (reproduciendoRef.current && actualRef.current?.id && posRef.current > 8) {
        guardarProgreso(actualRef.current.id, posRef.current, durRef.current, actualRef.current.title);
      }
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => { colaRef.current = cola; }, [cola]);
  useEffect(() => { idxRef.current = qIdx; }, [qIdx]);
  useEffect(() => { audioRef.current = soloAudio; }, [soloAudio]);
  useEffect(() => { autoRef.current = autoSiguiente; }, [autoSiguiente]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);
  useEffect(() => { crossoverRef.current = crossover; }, [crossover]);
  useEffect(() => { try { player.loop = repeat === 'one'; } catch (e) {} }, [repeat, player]);

  // Fetch del último APK release para el banner de descarga en web
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    fetch('https://api.github.com/repos/selloivanluna-lab/youthink/releases/latest')
      .then((r) => r.json())
      .then((data) => {
        const asset = Array.isArray(data?.assets)
          ? data.assets.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.apk'))
          : null;
        if (asset?.browser_download_url) {
          const match = (asset.name as string).match(/v([\d.]+)-build-(\d+)/);
          setApkRelease({
            url: asset.browser_download_url,
            version: match?.[1] || (data.tag_name || ''),
            build: match?.[2] || '',
          });
        }
      })
      .catch(() => {});
  }, []);

  // ── Chromecast: mantener el TV sincronizado con el tema actual ──────────────
  useEffect(() => { tvRef.current = tv.conectado; }, [tv.conectado]);

  // Al conectar o desconectar el TV hay que volver a cargar el tema.
  useEffect(() => { tvCargandoRef.current = ''; }, [tv.conectado]);

  // Último error al preparar el medio local (para mostrarlo en vez de fallar en silencio).
  const tvLocalErrorRef = useRef('');

  // ── Chromecast: servir el stream desde el teléfono ─────────────────────────
  // El receptor (Default Media Receiver) sólo reproduce archivos directos
  // (mp4/m4a). Mandarle una URL de googlevideo.com falla: esa URL está atada a
  // la IP y a los headers con los que se resolvió, así que el TV se quedaba en
  // el logo con el spinner girando.
  // Ahora el teléfono abre un servidor HTTP en la red Wi-Fi y el TV descarga el
  // medio desde el teléfono (`http://192.168.x.x:PUERTO/cast?v=...`), que lo
  // reenvía con los headers correctos y soporte de Range (seek).
  // Cuántas veces el TV pidió el archivo al teléfono (-1 = sin módulo nativo).
  async function pedidosTv(): Promise<number> {
    try {
      const st: any = await (QpAudio as any)?.castStats?.();
      return Number(st?.hits ?? -1);
    } catch (_) {
      return -1;
    }
  }

  async function resolverParaTv(item: YtResult, esAudio: boolean, fresh = false): Promise<{ url: string; contentType: string } | null> {
    tvLocalErrorRef.current = '';
    if (QpAudio) {
      try {
        if (typeof (QpAudio as any).castUrl === 'function') {
          const r: any = await (QpAudio as any).castUrl(item.id, esAudio ? 'audio' : 'video', fresh);
          if (r?.url) return { url: r.url, contentType: r.mime || (esAudio ? 'audio/mp4' : 'video/mp4') };
        }
      } catch (e: any) {
        tvLocalErrorRef.current = String(e?.message || e || 'no se pudo preparar el servidor local');
      }
      if (fresh) return null;
      try {
        if (esAudio) {
          const r: any = await QpAudio.resolveAudio(item.id);
          if (r?.url) return { url: r.url, contentType: r.mime || 'audio/mp4' };
        } else {
          const r: any = await QpAudio.resolveVideo(item.id);
          if (r?.url) return { url: r.url, contentType: r.mime || 'video/mp4' };
        }
      } catch (_) {
        // Sin módulo nativo o NewPipe no pudo: probamos el backend de siempre.
      }
    }
    return null;
  }

  useEffect(() => {
    if (!tv.conectado || !actual) return;
    // En el TV priorizamos VIDEO (el usuario castea para ver el contenido).
    // Sólo los temas de YouTube Music se mandan como audio.
    const esAudio = actual.kind === 'song';
    const clave = actual.id + '|' + (esAudio ? 'a' : 'v');
    if (tvCargandoRef.current === clave) return;
    tvCargandoRef.current = clave;
    // El audio sale por el TV: pausamos el reproductor local para no superponer.
    try { if (usarNativoRef.current) native.pause(); } catch (_) {}
    try { player.pause(); } catch (_) {}
    setReproduciendo(true);

    let cancelado = false;
    (async () => {
      const directo = await resolverParaTv(actual, esAudio);
      if (cancelado) return;
      // Contamos los pedidos del TV para detectar si llegó al teléfono.
      try { await (QpAudio as any)?.castResetStats?.(); } catch (_) {}
      const res = await tv.transmitir(
        {
          id: actual.id,
          title: actual.title,
          channel: actual.channel,
          thumb: actual.thumb,
          url: directo?.url || (esAudio ? api.audioClipUrl(actual.id) : api.clipUrl(actual.id)),
          contentType: directo?.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
          duration: actual.duration,
          startTime: 0,
        },
        // En los reintentos el teléfono resuelve una URL nueva: YouTube vence
        // las viejas y el receptor se queda en el logo.
        () => resolverParaTv(actual, esAudio, true),
        async () => (await pedidosTv()) > 0,
      );
      if (cancelado) return;
      if (!res?.ok) {
        tvCargandoRef.current = '';
        setError(res?.error || 'No se pudo transmitir al Chromecast.');
        return;
      }
      // Verificación a los 5 segundos: si el TV nunca pidió el archivo, informar red/aislamiento
      setTimeout(async () => {
        if (cancelado) return;
        try {
          const st: any = await (QpAudio as any)?.castStats?.();
          if (st && Number(st.hits) === 0) {
            setError(
              tvLocalErrorRef.current
                ? 'No se pudo preparar el video en el teléfono: ' + tvLocalErrorRef.current
                : 'El TV no llegó a pedirle el video al teléfono. Verificá que estén en la misma red Wi-Fi y desactivá "aislamiento de clientes" en el router.'
            );
          }
        } catch (_) {}
      }, 5000);
    })();

    return () => { cancelado = true; };
  }, [tv.conectado, actual?.id, actual?.kind]);

  // Mientras hay sesión de TV, el teléfono mantiene el servicio en primer plano:
  // así el servidor HTTP local sigue sirviendo el video aunque se apague la pantalla.
  useEffect(() => {
    if (!QpAudio || typeof (QpAudio as any).castKeepAlive !== 'function') return;
    try { (QpAudio as any).castKeepAlive(Boolean(tv.conectado)); } catch (_) {}
  }, [tv.conectado]);

  // Autoprueba del servidor local: dice si el teléfono puede servir el video y
  // si el TV llegó a pedirlo. Es la forma rápida de saber dónde está la falla.
  // También sirve como REINTENTO MANUAL: resetea la clave de "ya se cargó" para
  // que el efecto principal pueda volver a dispararse con URL nueva.
  async function probarTv() {
    if (!actual) return;
    const esAudio = actual.kind === 'song';
    try {
      // 1) ¿El teléfono puede servir el video? (resuelve y baja 64 KB)
      const r: any = await (QpAudio as any)?.castSelfTest?.(actual.id, esAudio ? 'audio' : 'video');
      // 2) Reintento manual: forzamos recargar aunque la clave ya coincida.
      let recarga = 'No hay TV conectado.';
      if (tv.conectado) {
        // Limpiar la clave guardada para que el reintento no se bloquee a sí mismo.
        tvCargandoRef.current = '';
        try { await (QpAudio as any)?.castResetStats?.(); } catch (_) {}
        const urlFresh = await resolverParaTv(actual, esAudio, true);
        const res = await tv.transmitir(
          {
            id: actual.id,
            title: actual.title,
            channel: actual.channel,
            thumb: actual.thumb,
            url: urlFresh?.url || (esAudio ? api.audioClipUrl(actual.id) : api.clipUrl(actual.id)),
            contentType: urlFresh?.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
            duration: actual.duration,
            startTime: 0,
          },
          () => resolverParaTv(actual, esAudio, true),
          async () => (await pedidosTv()) > 0,
        );
        recarga = res?.ok ? '✅ Se volvió a cargar el tema en el TV' : '❌ No se pudo recargar: ' + (res?.error || '');
      }
      const st: any = await (QpAudio as any)?.castStats?.();
      const hits = Number(st?.hits || 0);
      const lineas = [
        r?.ok ? '✅ El teléfono sirve el video' : '❌ El teléfono NO pudo servir el video',
        '',
        'URL del servidor: ' + (r?.url || '-'),
        'MIME: ' + (r?.mime || '-'),
        'HTTP ' + Number(r?.status || 0) + ' · ' + Number(r?.bytes || 0) + ' bytes · ' + Number(r?.ms || 0) + ' ms',
        r?.error ? 'Error: ' + r.error : null,
        '',
        'Pedidos del TV al teléfono: ' + hits,
        recarga,
        '',
        r?.ok && hits === 0
          ? '⚠️ El TV no llegó al teléfono. Verificá que estén en la misma red Wi-Fi y desactivá "aislamiento de clientes" en el router.'
          : null,
        r?.ok && hits > 0
          ? '✅ El TV sí llegó al teléfono (la red funciona).'
          : null,
      ].filter((x) => x !== null) as string[];
      Alert.alert('Diagnóstico Chromecast', lineas.join('\n'));
    } catch (e: any) {
      Alert.alert('Diagnóstico Chromecast', 'Error: ' + String(e?.message || e));
    }
  }

  // Fin natural en el TV: avanzar la cola (una sola vez, con el guard de fin).
  useEffect(() => {
    if (!tv.conectado) return;
    const off = tv.alTerminarEnTv(() => avanzarPorFin());
    return () => { try { off(); } catch (_) {} };
  }, [tv.conectado]);


  // ── Historial de reproducción ──
  async function guardarEnHistorial(item: YtResult) {
    if (!item || !item.id) return;
    try {
      const prev = historialRef.current || [];
      const filtrado = prev.filter((it) => it.id !== item.id);
      const nuevo = [item, ...filtrado].slice(0, 30);
      setHistorial(nuevo);
      historialRef.current = nuevo;
      await AsyncStorage.setItem('qp_historial', JSON.stringify(nuevo));

      if (autoExtenderRef.current) {
        const rawRadio = await AsyncStorage.getItem('qp_radio_historial_temas');
        let histRadio: YtResult[] = [];
        try { if (rawRadio) histRadio = JSON.parse(rawRadio); } catch (_) {}
        const sinDup = histRadio.filter((it) => it.id !== item.id);
        const actual = [item, ...sinDup].slice(0, 60);
        await AsyncStorage.setItem('qp_radio_historial_temas', JSON.stringify(actual));
      }
    } catch (_) {}
  }

  async function limpiarHistorial() {
    setHistorial([]);
    historialRef.current = [];
    try {
      await AsyncStorage.removeItem('qp_historial');
    } catch (_) {}
    cargarRecomendaciones([]);
  }

  useEffect(() => {
    AsyncStorage.multiGet(['qp_soloAudio', 'qp_autoSig', 'qp_shuffle', 'qp_repeat', 'qp_eq', 'qp_crossover', 'qp_historial', 'qp_radio_likes', 'qp_radio_dislikes']).then((rows) => {
      const m: any = {}; rows.forEach(([k, v]) => (m[k] = v));
      if (m.qp_soloAudio != null) {
        const isA = m.qp_soloAudio === '1';
        setSoloAudio(isA);
        setModo(isA ? 'audio' : 'video');
        modoRef.current = isA ? 'audio' : 'video';
        audioRef.current = isA;
      }
      if (m.qp_autoSig != null) setAutoSiguiente(m.qp_autoSig === '1');
      if (m.qp_shuffle != null) setShuffle(m.qp_shuffle === '1');
      if (m.qp_repeat) setRepeat(m.qp_repeat);
      if (m.qp_eq) setEq(m.qp_eq);
      if (m.qp_crossover != null) {
        setCrossover(m.qp_crossover === '1');
      } else {
        // Crossover activado por defecto
        setCrossover(true);
        crossoverRef.current = true;
      }
      if (m.qp_radio_likes) {
        try {
          const arr = JSON.parse(m.qp_radio_likes);
          if (Array.isArray(arr)) {
            const s = new Set<string>(arr);
            setRadioLikes(s);
            radioLikesRef.current = s;
          }
        } catch (_) {}
      }
      if (m.qp_radio_dislikes) {
        try {
          const arr = JSON.parse(m.qp_radio_dislikes);
          if (Array.isArray(arr)) {
            const s = new Set<string>(arr);
            setRadioDislikes(s);
            radioDislikesRef.current = s;
          }
        } catch (_) {}
      }
      let hist: YtResult[] = [];
      if (m.qp_historial) {
        try {
          hist = JSON.parse(m.qp_historial);
          if (Array.isArray(hist)) {
            setHistorial(hist);
            historialRef.current = hist;
          }
        } catch (_) {}
      }

      // Cargar recomendaciones iniciales basadas en el historial del usuario
      cargarRecomendaciones(hist);
    }).catch(() => {});
  }, []);

  // Despertar el backend al abrir la app: Render (free) duerme y el primer
  // request puede tardar 30-50s. Así la búsqueda ya lo encuentra despierto.
  useEffect(() => { api.health().catch(() => {}); }, []);

  async function cargarRecomendaciones(historialParaUsar?: YtResult[]) {
    setCargandoRecomendaciones(true);
    try {
      const h = (historialParaUsar && historialParaUsar.length > 0) ? historialParaUsar : historialRef.current;
      let queryPersonalizada = '';

      // 1. Prioridad: derivar inteligentemente a partir del Historial de reproducción
      if (h && h.length > 0) {
        const muestra = h.slice(0, 5);
        const elegido = muestra[Math.floor(Math.random() * muestra.length)];
        if (elegido?.channel && !elegido.channel.toLowerCase().includes('topic')) {
          queryPersonalizada = elegido.channel + ' exitos';
        } else if (elegido?.title) {
          const clean = elegido.title
            .replace(/\[.*?\]|\(.*?\)|official|video|audio|remix|lyric|en vivo|videoclip/gi, '')
            .trim();
          if (clean) queryPersonalizada = clean + ' mix';
        }
      }

      // 2. Si no hay historial, intentar por playlists de YouTube del usuario logueado
      if (!queryPersonalizada) {
        const ytToken = await AsyncStorage.getItem('qp_yt_access_token');
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
      }

      // 3. Si no hay token o no tiene listas, buscar por sus listas locales de Supabase/storage
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

      // 4. Fallback a tendencias generales si no hay datos del usuario aún
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
    autoExtenderRef.current = true;
    setShuffle(false);
    shuffleRef.current = false;
    // La radio es SIEMPRE modo audio
    setSoloAudio(true);
    audioRef.current = true;
    setModo('audio');
    modoRef.current = 'audio';
    AsyncStorage.setItem('qp_soloAudio', '1').catch(() => {});
    const trackItem: YtResult = { ...track, kind: 'song' };
    // Reproducir inmediatamente el tema seleccionado en modo audio
    reproducir([trackItem], 0, true, true);
    // Navegar a la tab Radio para mostrar la estación ahí
    const estacionNombre = (track.channel && !track.channel.toLowerCase().includes('topic'))
      ? `📻 ${track.channel}`
      : `📻 ${track.title.replace(/\[.*?\]|\(.*?\)|official|video|audio/gi, '').trim()}`;
    AsyncStorage.setItem('qp_radio_estacion_nombre', estacionNombre).catch(() => {});
    AsyncStorage.setItem('qp_radio_cola', JSON.stringify([trackItem])).catch(() => {});
    navigation.navigate('Radio' as never);
    try {
      let tracksRadio: YtResult[] = [];
      try {
        const res = await api.radio(track.id, 25);
        if (res.ok && res.tracks && res.tracks.length > 0) {
          tracksRadio = res.tracks;
        }
      } catch (_) {
        // Render backend /api/radio puede fallar si YouTube bloquea IP de datacenter
      }

      if (tracksRadio.length === 0) {
        // Fallback por búsqueda de YouTube (scraping directo / NewPipe sin 502)
        const q = (track.channel && !track.channel.toLowerCase().includes('topic'))
          ? `${track.channel} mix`
          : `${track.title.replace(/\[.*?\]|\(.*?\)|official|video|audio|remix|lyric/gi, '').trim()} mix`;
        try {
          const busq = await api.search(q, 20);
          if (busq.ok && busq.results && busq.results.length > 0) {
            tracksRadio = busq.results.filter((r) => r.id !== track.id);
          }
        } catch (_) {}
      }

      if (tracksRadio.length > 0) {
        // Encolar los temas de la estación después de la canción que ya está sonando asegurando kind song
        const radioSongs = tracksRadio.map((r) => ({ ...r, kind: 'song' as const }));
        const colaFinal = [trackItem, ...radioSongs];
        setCola(colaFinal);
        colaRef.current = colaFinal;
        // Persistir la cola completa para que Radio.tsx la lea
        AsyncStorage.setItem('qp_radio_cola', JSON.stringify(colaFinal)).catch(() => {});
      }
    } catch (e) {
      console.warn('[Iniciar Radio]', e);
    } finally {
      setIniciandoRadio(false);
    }
  }

  // Iniciar estación de radio a partir de una playlist completa
  // Estrategia: muestrear toda la playlist para capturar el ADN musical general,
  // lanzar api.radio() sobre semillas distribuidas y pesar artistas por frecuencia.
  async function iniciarRadioDesdePlaylist(seed: YtResult, queue?: YtResult[]) {
    if (!seed) return;
    setIniciandoRadio(true);
    autoExtenderRef.current = true;
    setShuffle(false);
    shuffleRef.current = false;

    // La radio es SIEMPRE modo audio
    setSoloAudio(true);
    audioRef.current = true;
    setModo('audio');
    modoRef.current = 'audio';
    AsyncStorage.setItem('qp_soloAudio', '1').catch(() => {});

    const seedItem: YtResult = { ...seed, kind: 'song' };

    // Detener reproducción previa
    try { native.pause(); native.stop(); } catch (_) {}
    try { player.pause(); } catch (_) {}
    try { webViewCmd("var v=document.querySelector('video'); if(v){v.pause(); v.src=''; v.load();}"); } catch (_) {}
    if (Platform.OS !== 'web') setWebEmbedUri(null);

    // Arrancar la reproducción con el tema semilla forzando audio
    reproducir([seedItem], 0, true, true);

    const estacionNombre = seed.channel
      ? `📻 Mix Playlist (${seed.channel})`
      : `📻 Mix Playlist (${seed.title.slice(0, 25)})`;
    AsyncStorage.setItem('qp_radio_estacion_nombre', estacionNombre).catch(() => {});
    AsyncStorage.setItem('qp_radio_cola', JSON.stringify([seedItem])).catch(() => {});
    navigation.navigate('Radio' as never);

    try {
      const idsVistos = new Set<string>([seed.id]);
      let tracksRadio: YtResult[] = [];

      const playlist = Array.isArray(queue) && queue.length > 1 ? queue : [];

      // ── 1. Semillas distribuidas: inicio, medio y fin de la playlist ──────
      //   Así la radio refleja el estilo GENERAL, no solo el primer tema.
      const semillas: YtResult[] = [seed];
      if (playlist.length >= 4) {
        const mid = playlist[Math.floor(playlist.length / 2)];
        const last = playlist[playlist.length - 1];
        if (mid && mid.id !== seed.id) semillas.push(mid);
        if (last && last.id !== seed.id && last.id !== mid?.id) semillas.push(last);
      }

      // api.radio() en paralelo para todas las semillas
      const radioResults = await Promise.allSettled(
        semillas.map((s) => api.radio(s.id, 20))
      );
      for (const r of radioResults) {
        if (r.status === 'fulfilled' && r.value?.ok && r.value.tracks?.length > 0) {
          tracksRadio = [...tracksRadio, ...r.value.tracks];
        }
      }

      // ── 2. Artistas ponderados por frecuencia en la playlist ───────────────
      //   Artistas que más aparecen → más probabilidad de ser buscados.
      if (playlist.length > 1) {
        const freqMap = new Map<string, number>();
        for (const item of playlist) {
          const ch = item.channel?.trim();
          if (ch && !ch.toLowerCase().includes('topic') && ch !== seed.channel) {
            freqMap.set(ch, (freqMap.get(ch) ?? 0) + 1);
          }
        }
        // Ordenar por frecuencia desc, tomar top 5
        const topArtistas = [...freqMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([ch]) => ch);

        // Búsquedas en paralelo (hasta 3 a la vez para no sobrecargar)
        const batches: string[][] = [];
        for (let i = 0; i < topArtistas.length; i += 3) batches.push(topArtistas.slice(i, i + 3));
        for (const batch of batches) {
          const batchResults = await Promise.allSettled(
            batch.map((art) => api.search(`${art} mix`, 10))
          );
          for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value?.ok && r.value.results?.length > 0) {
              tracksRadio = [...tracksRadio, ...r.value.results];
            }
          }
        }
      }

      // ── 3. Fallback si todo lo anterior falló ─────────────────────────────
      if (tracksRadio.length === 0) {
        const q = (seed.channel && !seed.channel.toLowerCase().includes('topic'))
          ? `${seed.channel} mix`
          : `${seed.title.replace(/\[.*?\]|\(.*?\)|official|video|audio|remix|lyric/gi, '').trim()} mix`;
        try {
          const busq = await api.search(q, 25);
          if (busq.ok && busq.results?.length > 0) tracksRadio = busq.results;
        } catch (_) {}
      }

      // ── 4. Deduplicar, filtrar dislikes, priorizar artistas con like ──────
      const likedArtists = radioLikedArtists;
      const dislikedIds = radioDislikesRef.current;
      const dislikedArtists = radioDislikedArtistsRef.current;

      const filtrados = tracksRadio.filter((t) => {
        if (!t?.id || idsVistos.has(t.id)) return false;
        if (dislikedIds.has(t.id)) return false;
        if (t.channel && dislikedArtists.has(t.channel)) return false;
        idsVistos.add(t.id);
        return true;
      });

      // Mezclar: liked artists primero, luego el resto (shuffle interno)
      const conLike = filtrados.filter((t) => t.channel && likedArtists.has(t.channel));
      const sinLike = filtrados.filter((t) => !t.channel || !likedArtists.has(t.channel));
      // Shuffle de sinLike para evitar que siempre salgan los mismos artistas al principio
      for (let i = sinLike.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sinLike[i], sinLike[j]] = [sinLike[j], sinLike[i]];
      }
      const nuevos = [...conLike, ...sinLike].map((t) => ({ ...t, kind: 'song' as const }));

      if (nuevos.length > 0 && colaRef.current.length <= 1) {
        const colaFinal = [seedItem, ...nuevos];
        setCola(colaFinal);
        colaRef.current = colaFinal;
        // Persistir para que Radio.tsx la lea al ganar focus
        AsyncStorage.setItem('qp_radio_cola', JSON.stringify(colaFinal)).catch(() => {});
      }
    } catch (e) {
      console.warn('[Radio Playlist]', e);
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
      avanzarPorFin();
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
        // Fallback WebView: la posición la reporta el propio WebView (onMessage).
        if (Platform.OS !== 'web' && mediaUriRef.current?.startsWith('webview:')) return;
        // En Web con iframe de YouTube embed: progreso suave SOLO visual + fade de
        // crossover. El avance de pista lo dispara el evento real del reproductor
        // (playerState 0), nunca este temporizador: antes iba "adelantado" y cortaba
        // la canción antes de que terminara.
        if (Platform.OS === 'web' && mediaUriRef.current?.includes('/embed/')) {
          if (reproduciendoRef.current && hasStartedPlayingCurrentTrackRef.current) {
            setPos((prev) => {
              const durTotal = durRef.current > 0 ? durRef.current : (actualRef.current?.duration || 0);
              const step = 0.4 * (velocidadRef.current || 1);
              const next = prev + step;
              posRef.current = next;

              if (durTotal > 15 && crossoverRef.current && !crossoverFadingRef.current) {
                const restante = durTotal - next;
                if (restante <= 4.0 && restante > 2.8) {
                  setWebPlayerVolume(70);
                } else if (restante <= 2.8 && restante > 1.6) {
                  setWebPlayerVolume(40);
                } else if (restante <= 1.6) {
                  crossoverFadingRef.current = true;
                  setWebPlayerVolume(10);
                }
              }
              if (durTotal > 0 && next >= durTotal) return durTotal;
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

        // Descartar mensajes residuales de canciones previas
        const msgVideoId = data.info?.videoData?.video_id;
        if (msgVideoId && currentTrackIdRef.current && msgVideoId !== currentTrackIdRef.current) {
          return;
        }

        if (data.event === 'infoDelivery' && data.info) {
          if (data.info.playerState === 1) {
            setReproduciendo(true);
            reproduciendoRef.current = true;
            hasStartedPlayingCurrentTrackRef.current = true;
          } else if (data.info.playerState === 2) {
            setReproduciendo(false);
            reproduciendoRef.current = false;
          } else if (data.info.playerState === 0) {
            avanzarPorFin(msgVideoId);
          }

          // Si el navegador en segundo plano intentó mutear el iframe, forzar unMute y restaurar volumen si no estamos en fade
          if (data.info.muted === true) {
            const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
            if (el?.contentWindow) {
              el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
              if (!crossoverFadingRef.current) {
                el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
              }
            }
          }

          if (typeof data.info.duration === 'number' && isFinite(data.info.duration) && data.info.duration > 0) {
            const newD = data.info.duration;
            const dActual = durRef.current || 0;
            // Blindaje contra chunks de buffer en streams/VODs largos (ej: 7 horas):
            // Solo pisamos si no teníamos duración previa o si el nuevo valor no es drásticamente menor (>= 80%)
            if (dActual <= 0 || newD >= dActual * 0.8) {
              setDur(newD);
              durRef.current = newD;
              if (actualRef.current && (!actualRef.current.duration || newD > actualRef.current.duration)) {
                actualRef.current.duration = Math.round(newD);
              }
            }
          }

          if (typeof data.info.currentTime === 'number' && isFinite(data.info.currentTime)) {
            const ct = data.info.currentTime;
            hasStartedPlayingCurrentTrackRef.current = true;
            setPos(ct);
            posRef.current = ct;

            const dEsperada = Math.max(durRef.current || 0, actualRef.current?.duration || 0, data.info.duration || 0);
            // Fade suave de crossover (solo volumen, sin adelantar la pista)
            if (dEsperada > 15 && crossoverRef.current && !crossoverFadingRef.current) {
              const restante = dEsperada - ct;
              if (restante <= 4.0 && restante > 2.8) {
                setWebPlayerVolume(70);
              } else if (restante <= 2.8 && restante > 1.6) {
                setWebPlayerVolume(40);
              } else if (restante <= 1.6) {
                crossoverFadingRef.current = true;
                setWebPlayerVolume(10);
              }
            }
            // Fin real según el tiempo que informa YouTube: avanza una única vez.
            if (dEsperada > 5 && ct >= dEsperada - 1.5) avanzarPorFin(msgVideoId);
          }
        }
        if (data.event === 'onStateChange' || data.event === 'initialDelivery') {
          const state = typeof data.info === 'number' ? data.info : (typeof data.data === 'number' ? data.data : data.info?.playerState);
          if (state === 1) {
            setReproduciendo(true);
            reproduciendoRef.current = true;
            hasStartedPlayingCurrentTrackRef.current = true;
            if (velocidadRef.current !== 1) {
              const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
              if (el?.contentWindow) {
                try {
                  el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [velocidadRef.current] }), '*');
                } catch (_) {}
              }
            }
          } else if (state === 2) {
            setReproduciendo(false);
            reproduciendoRef.current = false;
          } else if (state === 0) {
            const dEsperada = Math.max(durRef.current || 0, actualRef.current?.duration || 0);
            const ct = posRef.current || 0;
            if (dEsperada > 30 && ct < dEsperada - 20) {
              console.warn('[YouTube Web] Ended prematuro detectado en pos ' + ct + '/' + dEsperada + '. Reanudando...');
              saltar(ct);
            } else {
              avanzarPorFin(msgVideoId);
            }
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
        if (data.event === 'onError') {
          const errCode = Number(data.info ?? data.data);
          console.warn('[YouTube Player Error]', errCode);
          if (errCode === 101 || errCode === 150 || errCode === 153 || errCode === 100 || errCode === 2 || errCode === 5) {
            setError(`Tema bloqueado para reproducción embebida en YouTube (Error ${errCode}). Pasando al siguiente…`);
            setTimeout(() => {
              avanzarPorFin(msgVideoId);
            }, 1200);
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
    if (mediaUri.startsWith('native:') || mediaUri.startsWith('webview:') || mediaUri.includes('/embed/')) return;
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
    if (autoPlayRef.current && !tvRef.current) {
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
      avanzarPorFin();
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
    // En Web: el iframe persistente maneja tanto audio como video en vivo.
    // Solo alternamos la presentación visual sin detener ni reiniciar la reproducción.
    if (Platform.OS === 'web') {
      setSoloAudio(v);
      setModo(v ? 'audio' : 'video');
      modoRef.current = v ? 'audio' : 'video';
      audioRef.current = v;
      AsyncStorage.setItem('qp_soloAudio', v ? '1' : '0').catch(() => {});
      return;
    }

    // Android nativo:
    const currentPos = posRef.current || pos || 0;
    setSoloAudio(v);
    setModo(v ? 'audio' : 'video');
    modoRef.current = v ? 'audio' : 'video';
    audioRef.current = v;
    usarNativoRef.current = NATIVE_AUDIO && v;
    AsyncStorage.setItem('qp_soloAudio', v ? '1' : '0').catch(() => {});

    if (!actual) return;

    if (v) {
      // Pasando a MODO AUDIO: apagar video y encender motor de audio nativo con persistencia de posición
      try { player.pause(); } catch (_) {}
      try { webViewCmd("var v=document.querySelector('video'); if(v){v.pause(); v.src='';} "); } catch (_) {}
      setWebEmbedUri(null);
      if (NATIVE_AUDIO && QpAudio) {
        setMediaUri('native:' + actual.id);
        setError(null);
        native.play(actual.id, actual.title, actual.channel || '', actual.thumb || '').then(() => {
          if (currentPos > 2) {
            setTimeout(() => { try { native.seek(currentPos); } catch (_) {} }, 450);
          }
        }).catch(() => {
          if (actual) usarWebView(actual);
        });
      } else {
        usarWebView(actual);
      }
    } else {
      // Pasando a MODO VIDEO: detener nativo y activar reproductor de video
      try { native.pause(); native.stop(); } catch (_) {}
      aplicar(actual, false, idxRef.current, true, true).then(() => {
        if (currentPos > 2) {
          setTimeout(() => {
            try { player.seekBy(currentPos - (player.currentTime || 0)); } catch (_) {}
            try { webViewCmd(`var v=document.querySelector('video'); if(v){v.currentTime=${currentPos}; v.play();}`); } catch (_) {}
          }, 800);
        }
      });
    }
  }
  function setAuto(v: boolean) { setAutoSiguiente(v); AsyncStorage.setItem('qp_autoSig', v ? '1' : '0').catch(() => {}); }
  function toggleShuffle() { const v = !shuffle; setShuffle(v); AsyncStorage.setItem('qp_shuffle', v ? '1' : '0').catch(() => {}); }
  function ciclarRepeat() {
    const next: Repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    setRepeat(next); AsyncStorage.setItem('qp_repeat', next).catch(() => {});
  }

    async function reproducirPlaylist(item: YtResult) {
    setCargandoPlaylistId(item.id);
    try {
      const res = await api.playlist(item.id);
      if (res.ok && Array.isArray(res.tracks) && res.tracks.length > 0) {
        reproducir(res.tracks, 0, soloAudio);
      } else if (item.firstVideoId) {
        const primerTrack: YtResult = {
          id: item.firstVideoId,
          title: item.title,
          channel: item.channel,
          duration: 0,
          thumb: item.thumb,
          url: 'https://www.youtube.com/watch?v=' + item.firstVideoId,
          kind: 'song',
        };
        reproducir([primerTrack], 0, soloAudio);
      } else {
        Alert.alert('Lista no disponible', 'No se pudieron cargar los temas de esta lista.');
      }
    } catch (e: any) {
      if (item.firstVideoId) {
        const primerTrack: YtResult = {
          id: item.firstVideoId,
          title: item.title,
          channel: item.channel,
          duration: 0,
          thumb: item.thumb,
          url: 'https://www.youtube.com/watch?v=' + item.firstVideoId,
          kind: 'song',
        };
        reproducir([primerTrack], 0, soloAudio);
      } else {
        Alert.alert('Error', e?.message || 'No se pudo abrir la lista de reproducción');
      }
    } finally {
      setCargandoPlaylistId(null);
    }
  }

async function buscar(tipo?: 'all' | 'videos' | 'songs' | 'playlists', mas = false) {
    const q = query.trim();
    if (!q) return;
    const t = tipo || searchType;
    if (mas && (!nextPage || loadingMore || loading)) return;
    const reqId = ++searchReqRef.current;
    if (mas) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      if (tipo) setResults([]);
      setNextPage(null);
    }
    setError(null);
    try {
      const data = await api.search(q, mas ? 20 : 30, t, mas ? nextPage : null);
      if (reqId !== searchReqRef.current) return;
      const nuevos = data.results || [];
      if (mas) {
        setResults((prev) => {
          const vistos = new Set(prev.map((r) => r.id));
          return prev.concat(nuevos.filter((r) => !vistos.has(r.id)));
        });
      } else {
        setResults(nuevos);
      }
      setNextPage(data.next || null);
    } catch (e: any) {
      if (reqId !== searchReqRef.current) return;
      setError(e?.message || 'Error de búsqueda');
      if (!mas) setResults([]);
    } finally {
      if (reqId === searchReqRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  function buscarConTipo(tipo: 'all' | 'videos' | 'songs' | 'playlists') {
    setSearchType(tipo);
    // Al filtrar por Videos, cambiar automáticamente a modo video.
    // Al filtrar por Canciones o Todo, volver a audio (por defecto).
    if (tipo === 'videos') {
      setSoloAudio(false);
      setModo('video');
      audioRef.current = false;
      modoRef.current = 'video';
      AsyncStorage.setItem('qp_soloAudio', '0').catch(() => {});
    } else if (tipo === 'songs' || tipo === 'playlists') {
      setSoloAudio(true);
      setModo('audio');
      audioRef.current = true;
      modoRef.current = 'audio';
      AsyncStorage.setItem('qp_soloAudio', '1').catch(() => {});
    }
    buscar(tipo);
  }

  function cargarMas() {
    buscar(searchType, true);
  }

  function buscarDesdeInput() { buscar(searchType); }

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

  async function aplicar(item: YtResult, audio: boolean = audioRef.current, idx: number, autoPlay = true, forzarModoManual = false) {
    // Si el usuario cambia manualmente con el botón o toggle, respetamos su elección.
    // Solo forzamos video si el usuario está en la pestaña videos y no eligió audio explícitamente.
    const esVideoTab = !forzarModoManual && (searchType === 'videos');
    const isAudio = esVideoTab ? false : (typeof audio === 'boolean' ? audio : audioRef.current);
    audioRef.current = isAudio;
    modoRef.current = isAudio ? 'audio' : 'video';
    setSoloAudio(isAudio);
    setModo(isAudio ? 'audio' : 'video');
    usarNativoRef.current = NATIVE_AUDIO && isAudio;
    AsyncStorage.setItem('qp_soloAudio', isAudio ? '1' : '0').catch(() => {});
    autoPlayRef.current = autoPlay;
    setActual(item);
    guardarEnHistorial(item);
    setPlayerVisible(true);
    if (Platform.OS !== 'web') {
      setMediaUri(null);
      setWebEmbedUri(null);
    }
    setError(null);
    setAudioTimeout(false);

    currentTrackIdRef.current = item.id;
    hasStartedPlayingCurrentTrackRef.current = false;
    finDisparadoRef.current = false;
    crossoverFadingRef.current = false;
    if (crossoverFadeTimerRef.current) {
      clearTimeout(crossoverFadeTimerRef.current);
      crossoverFadeTimerRef.current = null;
    }
    if (fallbackWebViewTimerRef.current) {
      clearTimeout(fallbackWebViewTimerRef.current);
      fallbackWebViewTimerRef.current = null;
    }

    // Cancelar cualquier temporizador de forzarPlay previo para evitar solapamiento
    forzarPlayTimersRef.current.forEach((t) => clearTimeout(t));
    forzarPlayTimersRef.current = [];

    // Detener inmediatamente y de forma incondicional TODOS los motores para evitar reproducción simultánea
    try { native.pause(); native.stop(); } catch (_) {}
    try { player.pause(); } catch (_) {}
    try {
      webViewCmd("var v=document.querySelector('video'); if(v){v.pause(); v.src=''; v.load();}");
    } catch (_) {}
    if (Platform.OS !== 'web') {
      setWebEmbedUri(null);
    }

    // Resetear auto-retry counter para esta canción
    sourceRetryRef.current = 0;
    actualRetryRef.current = item;
    if (sourceRetryTimerRef.current) { clearTimeout(sourceRetryTimerRef.current); sourceRetryTimerRef.current = null; }
    // Resetear ambos flags de carga nativa para que no queden pegados de la canción anterior
    setNativeBuffering(false);
    setNativeResolving(false);
    crossoverTriggeredRef.current = false;
    if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
    setReproduciendo(autoPlay);
    if (idx >= 0) {
      setQIdx(idx);
      idxRef.current = idx;
    }
    cargarLyrics(item);
    // Consultar progreso previo guardado para reanudar en el segundo exacto
    const savedPos = await obtenerProgreso(item.id);
    const startSec = (savedPos && savedPos > 8) ? Math.floor(savedPos) : 0;
    if (startSec > 0) {
      setResumingInfo({ pos: startSec, trackId: item.id });
      setPos(startSec);
      posRef.current = startSec;
      hasStartedPlayingCurrentTrackRef.current = true;
    } else {
      setResumingInfo(null);
      setPos(0);
      posRef.current = 0;
    }

    // Timeout de 12s: si en ese tiempo no llegó ningún evento del reproductor nativo,
    // mostramos botón de reintento en lugar del spinner infinito.
    if (isAudio) {
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
      finDisparadoRef.current = false;
      crossoverFadingRef.current = false;
      trackStartTimeRef.current = Date.now();
      const cleanId = (item.id || '').trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
      const originUrl = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://www.youtube.com';
      const currentHref = typeof window !== 'undefined' && window.location?.href ? window.location.href : originUrl;
      const startParam = startSec > 0 ? `&start=${startSec}` : '';
      const embedUrl = `https://www.youtube.com/embed/${cleanId}?autoplay=1&enablejsapi=1&playsinline=1&controls=1&rel=0&origin=${encodeURIComponent(originUrl)}&widget_referrer=${encodeURIComponent(currentHref)}${startParam}`;
      setMediaUri(embedUrl);
      mediaUriRef.current = embedUrl;
      setReproduciendo(true);
      reproduciendoRef.current = true;
      setError(null);
      setAudioTimeout(false);
      const initialDur = item.duration || 0;
      setDur(initialDur);
      durRef.current = initialDur;

      // Si crossover está activo, arranque suave con rampa de volumen; si no, volumen al 100 directo
      if (crossoverRef.current) {
        setWebPlayerVolume(40);
        crossoverFadeTimerRef.current = setTimeout(() => {
          setWebPlayerVolume(75);
          crossoverFadeTimerRef.current = setTimeout(() => {
            setWebPlayerVolume(100);
          }, 450);
        }, 350);
      } else {
        setWebPlayerVolume(100);
      }

      // Si el iframe ya existe en el DOM, enviar loadVideoById para cambio directo sin recarga
      const el = (globalThis as any).document?.getElementById('yt-player-iframe') as HTMLIFrameElement | null;
      if (el?.contentWindow) {
        try {
          if (startSec > 0) {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'loadVideoById', args: [{ videoId: item.id, startSeconds: startSec }] }), '*');
          } else {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'loadVideoById', args: [item.id] }), '*');
          }
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
          if (!crossoverRef.current) {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          }
          el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          if (startSec > 0) {
            el.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [startSec, true] }), '*');
          }
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
          if (!crossoverFadingRef.current) {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setVolume', args: [100] }), '*');
          }
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          if (startSec > 0) {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [startSec, true] }), '*');
          }
          if (velocidadRef.current !== 1) {
            iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [velocidadRef.current] }), '*');
          }
        }
      };

      forzarPlayTimersRef.current.push(setTimeout(forzarPlay, 200));
      forzarPlayTimersRef.current.push(setTimeout(forzarPlay, 600));
      forzarPlayTimersRef.current.push(setTimeout(forzarPlay, 1200));
      forzarPlayTimersRef.current.push(setTimeout(forzarPlay, 2200));

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
          navigator.mediaSession.setActionHandler('nexttrack', () => siguiente());
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
      // ── Android/iOS nativo ────────────────────────────────────────────────
      // 1) Módulo nativo disponible (Android): NewPipe extrae el stream en el
      //    propio teléfono. Es el mejor camino: audio en segundo plano, sin
      //    backend y sin bloqueo de YouTube por IP de datacenter.
      if (NATIVE_AUDIO && QpAudio) {
        if (isAudio) {
          setMediaUri('native:' + item.id);
          setError(null);
          await native.setEq(eqRef.current);
          if (autoPlay && !tvRef.current) await native.play(item.id, item.title, item.channel || '', item.thumb || '', startSec);
          if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
          return;
        }
        try {
          const v = await QpAudio.resolveVideo(item.id);
          if (v && v.url) {
            setMediaUri(v.url);
            mediaUriRef.current = v.url;
            setWebEmbedUri(null);
            try { player.replace({ uri: v.url }); } catch (_) {}
            if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; }
            if (autoPlay) { try { player.play(); } catch (_) {} }
            setReproduciendo(autoPlay);
            reproduciendoRef.current = autoPlay;
            setError(null);
            setPos(0); posRef.current = 0;
            const initialDur = item.duration || 0;
            setDur(initialDur); durRef.current = initialDur;
            return;
          }
        } catch (_) {
          // Si NewPipe no puede resolver este video, seguimos con el WebView.
        }
      }

      // 2) Sin módulo nativo (o NewPipe falló): WebView con el embed oficial de
      //    YouTube. Nunca usamos /api/audio ni /api/clip para reproducir: el
      //    backend en la nube está bloqueado por YouTube y colgaba la app.
      usarWebView(item);
    } catch (e: any) {
      // Último recurso: WebView con el embed de YouTube.
      usarWebView(item);
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

  function reproducir(lista: YtResult[], idx: number, audio: boolean = audioRef.current, autoExtender = false) {
    if (!lista.length) return;
    const targetItem = lista[idx] || lista[0];
    const esVideoItem = (searchType === 'videos') && audio !== true;
    const isAudio = esVideoItem ? false : (typeof audio === 'boolean' ? audio : audioRef.current);
    unlockWebAudio();
    autoPlayRef.current = true;
    autoExtenderRef.current = autoExtender;
    setReproduciendo(true);
    let arr = lista; let start = idx;
    if (shuffleRef.current) {
      const first = lista[idx];
      const rest = lista.filter((_, k) => k !== idx);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      arr = [first, ...rest]; start = 0;
    }
    setCola(arr); colaRef.current = arr; aplicar(arr[start], isAudio, start, true, typeof audio === 'boolean');
  }

  function siguiente(auto?: any) {
    const esFinNatural = auto === true;
    autoPlayRef.current = true;
    finDisparadoRef.current = false;
    trackStartTimeRef.current = Date.now();
    const c = colaRef.current;
    const i = idxRef.current;

    // Repetir 1: al terminar naturalmente, volvemos a empezar la misma canción.
    if (esFinNatural && repeatRef.current === 'one' && actualRef.current) {
      reiniciarActual();
      return;
    }

    // Extender la "estación" solo si la cola fue generada automáticamente
    // (radio/recomendados). Una lista del usuario se respeta tal cual.
    if (autoExtenderRef.current && i >= c.length - 2 && c[i]?.id) {
      const cur = c[i];
      (async () => {
        let nuevos: YtResult[] = [];

        // Semilla principal: canción actual
        try {
          const res = await api.radio(cur.id, 20);
          if (res.ok && res.tracks && res.tracks.length > 0) nuevos = res.tracks;
        } catch (_) {}

        // Semilla aleatoria de la cola actual para diversidad de estilo
        if (c.length >= 6) {
          const randomIdx = Math.floor(Math.random() * Math.max(1, c.length - 2));
          const randomSeed = c[randomIdx];
          if (randomSeed?.id && randomSeed.id !== cur.id) {
            try {
              const res2 = await api.radio(randomSeed.id, 10);
              if (res2.ok && res2.tracks?.length > 0) nuevos = [...nuevos, ...res2.tracks];
            } catch (_) {}
          }
        }

        if (nuevos.length === 0) {
          try {
            const q = (cur.channel && !cur.channel.toLowerCase().includes('topic'))
              ? `${cur.channel} mix`
              : `${cur.title.replace(/\[.*?\]|\(.*?\)|official|video|audio/gi, '').trim()} mix`;
            const busq = await api.search(q, 15);
            if (busq.ok && busq.results && busq.results.length > 0) nuevos = busq.results;
          } catch (_) {}
        }

        if (nuevos.length > 0) {
          const idsExistentes = new Set(colaRef.current.map((t) => t.id));
          // Filtrar: excluir dislikes (ID y artista) y ya existentes
          const filtrados = nuevos.filter((t) =>
            !idsExistentes.has(t.id) &&
            !radioDislikesRef.current.has(t.id) &&
            !(t.channel && radioDislikedArtistsRef.current.has(t.channel))
          );
          if (filtrados.length > 0) {
            // Priorizar artistas con likes: ponerlos primero
            const conLike = filtrados.filter((t) => t.channel && radioLikedArtists.has(t.channel));
            const sinLike = filtrados.filter((t) => !t.channel || !radioLikedArtists.has(t.channel));
            const ordenados = [...conLike, ...sinLike];
            setCola((prev) => {
              const actualizada = [...prev, ...ordenados];
              colaRef.current = actualizada;
              AsyncStorage.setItem('qp_radio_cola', JSON.stringify(actualizada)).catch(() => {});
              return actualizada;
            });
          }
        }
      })();
    }

    if (i + 1 < c.length) {
      aplicar(c[i + 1], audioRef.current, i + 1, true);
    } else if (repeatRef.current === 'all' && c.length) {
      aplicar(c[0], audioRef.current, 0, true);
    } else if (autoExtenderRef.current && recomendacionesRef.current && recomendacionesRef.current.length > 0) {
      const rec = recomendacionesRef.current.filter((r) => r.id !== c[i]?.id);
      if (rec.length > 0) {
        setCola(rec);
        colaRef.current = rec;
        aplicar(rec[0], audioRef.current, 0, true);
      } else {
        if (usarNativoRef.current) native.pause();
        else player.pause();
        setReproduciendo(false);
      }
    } else {
      if (usarNativoRef.current) native.pause();
      else player.pause();
      setReproduciendo(false);
    }
  }
  function anterior(_?: any) {
    autoPlayRef.current = true;
    finDisparadoRef.current = false;
    trackStartTimeRef.current = Date.now();
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
    const pShuffle: boolean = Boolean(route.params?.autoShuffle);
    const pRadio: boolean = Boolean(route.params?.autoRadio);

    if (pId) {
      const autoKey = pId + (pRadio ? '_radio' : '') + (pShuffle ? '_shuffle' : '');
      if (lastAutoPlayConsumedRef.current === autoKey) return;
      lastAutoPlayConsumedRef.current = autoKey;
      if (pShuffle) {
        setShuffle(true);
        shuffleRef.current = true;
        AsyncStorage.setItem('qp_shuffle', '1').catch(() => {});
      }
      setPlayerVisible(true);
      const isAudio = audioRef.current;
      if (pRadio) {
        // Iniciar estación de radio a partir de la lista (canciones nuevas y afines a sus artistas)
        setShuffle(false);
        shuffleRef.current = false;
        autoExtenderRef.current = true;
        setSoloAudio(true);
        audioRef.current = true;
        setModo('audio');
        modoRef.current = 'audio';
        AsyncStorage.setItem('qp_soloAudio', '1').catch(() => {});
        const seed = (Array.isArray(pQueue) && pQueue.length > 0) ? pQueue[0] : null;
        const seedItem: YtResult = {
          id: seed?.id || pId,
          title: seed?.title || pTitle,
          url: seed?.url || `https://www.youtube.com/watch?v=${pId}`,
          channel: seed?.channel || '',
          duration: seed?.duration || 0,
          thumb: seed?.thumb || `https://i.ytimg.com/vi/${pId}/hqdefault.jpg`,
          kind: 'song',
        };
        iniciarRadioDesdePlaylist(seedItem, pQueue);
      } else if (Array.isArray(pQueue) && pQueue.length > 0) {
        // Cargar toda la lista de canciones en la cola y arrancar desde la canción tocada
        reproducir(pQueue, Math.max(0, Math.min(pIndex, pQueue.length - 1)), isAudio);
      } else {
        const item: YtResult = {
          id: pId,
          title: pTitle,
          url: `https://www.youtube.com/watch?v=${pId}`,
          channel: '',
          duration: 0,
          thumb: `https://i.ytimg.com/vi/${pId}/hqdefault.jpg`,
        };
        reproducir([item], 0, isAudio);
      }
      // Limpiar params para no re-ejecutar en re-render
      navigation.setParams({
        autoPlayId: undefined,
        autoPlayTitle: undefined,
        autoPlayQueue: undefined,
        autoPlayIndex: undefined,
        autoShuffle: undefined,
        autoRadio: undefined,
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
    if (tvRef.current) { tv.moverTv(target); setPos(target); return; }
    if (webEmbedUri) {
      webViewCmd("var v=document.querySelector('video'); if(v){v.currentTime=" + target + ";}");
      setPos(target);
      posRef.current = target;
      return;
    }
    if (usarNativoRef.current) { native.seek(target); setPos(target); return; }
    if (Platform.OS === 'web') {
      if ((mediaUri || mediaUriRef.current)?.includes('/embed/')) {
        const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [Math.round(target), true] }), '*');
        }
        setPos(target);
        posRef.current = target;
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
    posRef.current = target;
    if (actualRef.current) {
      if (target > 8) {
        guardarProgreso(actualRef.current.id, target, durRef.current, actualRef.current.title);
      } else if (target === 0) {
        borrarProgreso(actualRef.current.id);
      }
    }
  }
  async function togglePlay() {
    if (reproduciendo && actualRef.current && posRef.current > 8) {
      guardarProgresoInmediato(actualRef.current.id, posRef.current, durRef.current, actualRef.current.title);
    }
    // Con Chromecast conectado, play/pausa controla el TV (el reproductor local está pausado).
    if (tvRef.current) {
      if (!tv.sonando && actual) {
        tvCargandoRef.current = '';
        const esAudio = actual.kind === 'song';
        const directo = await resolverParaTv(actual, esAudio, true);
        tv.transmitir(
          {
            id: actual.id,
            title: actual.title,
            channel: actual.channel,
            thumb: actual.thumb,
            url: directo?.url || (esAudio ? api.audioClipUrl(actual.id) : api.clipUrl(actual.id)),
            contentType: directo?.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
            duration: actual.duration,
            startTime: 0,
          },
          () => resolverParaTv(actual, esAudio, true),
          async () => (await pedidosTv()) > 0,
        );
        setReproduciendo(true);
        return;
      }
      const quiereSonar = !tv.sonando;
      await tv.alternarTv(quiereSonar);
      setReproduciendo(quiereSonar);
      return;
    }
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
    if (webEmbedUri) {
      if (reproduciendo) {
        webViewCmd("var v=document.querySelector('video'); if(v)v.pause();");
        setReproduciendo(false);
      } else {
        webViewCmd("var v=document.querySelector('video'); if(v)v.play();");
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
    if (esLandscape) alternarRotacion();
    if (Platform.OS !== 'web' && modo === 'video' && actual) {
      // Si estamos en modo video en celular nativo y se minimiza, transferir
      // la reproducción fluidamente al motor de audio nativo (QpAudio) para que no se frene.
      if (NATIVE_AUDIO && QpAudio) {
        const currentPos = posRef.current || pos || 0;
        usarNativoRef.current = true;
        modoRef.current = 'audio';
        setSoloAudio(true);
        setModo('audio');
        audioRef.current = true;
        try { player.pause(); } catch (_) {}
        try { webViewCmd("var v=document.querySelector('video'); if(v){v.pause(); v.src='';}"); } catch (_) {}
        setWebEmbedUri(null);
        native.play(actual.id, actual.title, actual.channel || '', actual.thumb || '').then(() => {
          if (currentPos > 2) {
            setTimeout(() => { try { native.seek(currentPos); } catch (_) {} }, 450);
          }
        }).catch(() => {});
      }
    }
    setPlayerVisible(false);
  }

  function cerrar() {
    if (actualRef.current && posRef.current > 8) {
      guardarProgresoInmediato(actualRef.current.id, posRef.current, durRef.current, actualRef.current.title);
    }
    if (esLandscape) alternarRotacion();
    if (usarNativoRef.current) native.stop();
    if (webEmbedUri) webViewCmd("var v=document.querySelector('video'); if(v){v.pause();}");
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
    setWebEmbedUri(null);
    setQIdx(-1);
    setCola([]);
    colaRef.current = [];
    setLyricsOpen(false);
    setLyricsData(null);
  }

  // Sincronizar estado y controles con playerStore para el MiniPlayerGlobal en todas las pestañas
  useEffect(() => {
    playerStore.setState({
      actual,
      reproduciendo,
      playerVisible,
      pos,
      dur,
    });
  }, [actual, reproduciendo, playerVisible, pos, dur]);

  useEffect(() => {
    playerStore.registerControls({
      togglePlay,
      abrirPlayer: () => setPlayerVisible(true),
      cerrar,
    });
    return () => {
      playerStore.unregisterControls();
    };
  }, [togglePlay, cerrar]);

  // ── Actualizar app (abre enlace de APK) ──
  function actualizarApp() {
    try {
      Linking.openURL('https://github.com/selloivanluna-lab/youthink/releases/latest');
    } catch (e) {}
  }

  // ── Descarga: genera y descarga el archivo de audio o video ──
  async function descargar() {
    if (!actual) return;
    setDescargando(true);
    const cleanTitle = (actual.title || actual.id).replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
    const ext = soloAudio ? '.m4a' : '.mp4';
    const filename = cleanTitle + ext;
    const url = (soloAudio ? api.audioClipUrl(actual.id) : api.clipUrl(actual.id)) + `&dl=1&nombre=${encodeURIComponent(filename)}`;

    try {
      // Android con módulo nativo: resolvemos el stream EN EL TELÉFONO (IP real,
      // sin el bloqueo que YouTube aplica a los servidores de Render) y dejamos
      // que Android lo descargue/abra. Evita el backend roto por completo.
      if (Platform.OS !== 'web' && QpAudio) {
        try {
          const r: any = soloAudio
            ? await QpAudio.resolveAudio(actual.id)
            : await QpAudio.resolveVideo(actual.id);
          if (r && r.url) {
            await Linking.openURL(r.url);
            return;
          }
        } catch (_) {
          // Si el módulo no puede resolverlo, probamos el backend de siempre.
        }
      }

      // 1. Asegurar que el backend haya generado el clip en disco (evita error de archivo inexistente)
      if (soloAudio) {
        await api.previewAudio(actual.id);
      } else {
        await api.preview(actual.id);
      }

      // 2. Disparar descarga directa
      if (Platform.OS === 'web') {
        const a = (globalThis as any).document?.createElement('a');
        if (a) {
          a.href = url;
          a.download = filename;
          (globalThis as any).document.body?.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 1000);
        } else {
          (globalThis as any).window?.open(url, '_blank');
        }
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      console.warn('[Descarga] Advertencia en pre-generación:', e);
      // Intento directo vía enlace URL (el servidor ahora también autogenera en /api/aclip y /api/clip)
      try {
        if (Platform.OS === 'web') {
          (globalThis as any).window?.open(url, '_blank');
        } else {
          await Linking.openURL(url);
        }
      } catch (_) {
        Alert.alert('Descarga', 'El servidor está procesando el archivo. Por favor reintentá en unos segundos.');
      }
    } finally {
      setTimeout(() => setDescargando(false), 2000);
    }
  }

  // ── Listas de reproducción ──
  async function abrirModalPlaylists() {
    setPlaylistModalOpen(true);
    setCargandoPlaylists(true);

    // 1. Mostrar de inmediato usando getPlaylists() que ya filtra tombstones
    try {
      const locales = await getPlaylists(); // filtra eliminadas
      let cachedYT: Playlist[] = [];
      try {
        const rawYT = await AsyncStorage.getItem('qp_cache_yt_playlists');
        if (rawYT) cachedYT = JSON.parse(rawYT);
      } catch (_) {}
      const inmediatas = [...locales, ...cachedYT.filter((y) => !locales.some((l) => l.id === y.id))];
      if (inmediatas.length > 0) {
        setPlaylists(inmediatas);
        setCargandoPlaylists(false);
      }
    } catch (_) {}

    // 2. En segundo plano refrescar listas de Supabase y de YouTube
    try {
      let data = await getPlaylists(); // siempre filtra tombstones

      if (data.length === 0) {
        try {
          await supabase.auth.refreshSession();
          data = await getPlaylists();
        } catch (_) {}
      }

      let todas: Playlist[] = [...data];

      try {
        const ytListas = await obtenerListasYouTube();
        if (Array.isArray(ytListas) && ytListas.length > 0) {
          const ids = new Set(todas.map((p) => p.id));
          ytListas.forEach((yl) => {
            if (!ids.has(yl.id)) todas.push(yl);
          });
        }
      } catch (e) {
        console.warn('[ModalPlaylists] Error cargando listas de YouTube:', e);
      }

      setPlaylists(todas);
    } catch (e) {
      // Fallback: usar getPlaylists() local que filtra tombstones
      try {
        const locales = await getPlaylists();
        setPlaylists(locales);
      } catch (_) {}
    } finally {
      setCargandoPlaylists(false);
    }
  }

  async function agregarALista(playlist: Playlist) {
    if (!actual) return;
    setAddingToPlaylist(true);
    try {
      if (playlist.id.startsWith('yt_')) {
        // Para listas de YouTube: agregar SOLO vía agregarItemAPlaylistYouTube
        // que ya actualiza el caché correcto (qp_cache_yt_items_XXXXX).
        // NO llamar a addToPlaylist que usa una clave distinta y confunde.
        const res = await agregarItemAPlaylistYouTube(playlist.id, actual);
        setPlaylistModalOpen(false);
        setNuevaListaNombre('');
        Alert.alert(
          '✅ Agregada',
          `"${actual.title}" se añadió a tu lista "${playlist.nombre}"${res.enYt ? ' en YouTube 🎵' : ' (localmente — se sincronizará cuando haya conexión)'}`
        );
      } else {
        // Para listas locales / Supabase
        await addToPlaylist(playlist.id, actual);
        setPlaylistModalOpen(false);
        setNuevaListaNombre('');
        Alert.alert('✅ Agregada', `"${actual.title}" se añadió a "${playlist.nombre}"`);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo agregar a la lista');
    }
    setAddingToPlaylist(false);
  }

  async function crearYAgregar() {
    const nombre = nuevaListaNombre.trim();
    if (!nombre) return;
    setCreandoLista(true);
    try {
      // Intentar crear también en YouTube si hay token
      const ytToken = await AsyncStorage.getItem('qp_yt_access_token');
      let ytPlaylistId: string | null = null;
      if (ytToken) {
        try {
          const res = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + ytToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snippet: { title: nombre, description: 'Creada desde YouThink' },
              status: { privacyStatus: 'private' },
            }),
          });
          const data = await res.json();
          if (data?.id) ytPlaylistId = data.id;
        } catch {}
      }

      // Crear en Supabase/local
      const pl = await createPlaylist(nombre);

      // Si se creó en YouTube, agregar la canción actual también ahí
      if (actual && ytPlaylistId && ytToken) {
        try {
          await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + ytToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snippet: {
                playlistId: ytPlaylistId,
                resourceId: { kind: 'youtube#video', videoId: actual.id },
              },
            }),
          });
        } catch {}
      }

      if (actual) {
        await addToPlaylist(pl.id, actual);
        Alert.alert('✅ Lista creada', `"${actual.title}" se añadió a "${nombre}"${ytPlaylistId ? ' (y en YouTube 🎵)' : ''}`);
      }
      setPlaylists((prev) => [pl, ...prev]);
      setPlaylistModalOpen(false);
      setNuevaListaNombre('');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo crear la lista');
    }
    setCreandoLista(false);
  }

  async function abrirGestionPlaylist(playlist: Playlist) {
    setManagingPlaylist(playlist);
    setLoadingManagingItems(true);
    try {
      if (playlist.id.startsWith('yt_')) {
        const raw = await obtenerItemsPlaylistYouTube(playlist.id);
        const formateados: PlaylistItem[] = (raw || []).map((it: any) => ({
          id: it.id || it.yt_id || String(Math.random()),
          playlist_id: playlist.id,
          yt_id: (it.id || it.yt_id || '').trim(),
          title: it.title || '(sin título)',
          channel: it.channel || '',
          thumb: it.thumb || '',
          duration: it.duration || 0,
          added_at: it.added_at || new Date().toISOString(),
        }));
        setManagingItems(formateados);
      } else {
        const items = await getPlaylistItems(playlist.id, { force: true });
        setManagingItems(items);
      }
    } catch {
      setManagingItems([]);
    }
    setLoadingManagingItems(false);
  }

  async function borrarDePlaylist(ytId: string) {
    if (!managingPlaylist) return;
    setDeletingItem(ytId);
    try {
      if (managingPlaylist.id.startsWith('yt_')) {
        const cleanId = (ytId || '').trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
        const plId = managingPlaylist.id.replace(/^yt_/, '');
        const cacheKey = CACHE_YT_ITEMS_PREFIX + plId;
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            const filtrados = parsed.filter((it: any) => (it.id !== cleanId && it.yt_id !== cleanId && it.id !== ytId && it.yt_id !== ytId));
            await AsyncStorage.setItem(cacheKey, JSON.stringify(filtrados));
          }
        } catch (_) {}
        setManagingItems((prev) => prev.filter((it) => it.yt_id !== ytId && it.id !== ytId));
      } else {
        await removeFromPlaylist(managingPlaylist.id, ytId);
        setManagingItems((prev) => prev.filter((it) => it.yt_id !== ytId));
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo borrar');
    }
    setDeletingItem(null);
  }

  function abrirRenombrar(playlist: Playlist) {
    setRenombrando(playlist);
    setRenombreTexto(playlist.nombre);
  }

  async function confirmarRenombrar() {
    if (!renombrando || !renombreTexto.trim()) return;
    try {
      await updatePlaylist(renombrando.id, renombreTexto.trim());
      setPlaylists((prev) => prev.map((p) => p.id === renombrando.id ? { ...p, nombre: renombreTexto.trim() } : p));
      setRenombrando(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo renombrar');
    }
  }

  function eliminarLista(playlist: Playlist) {
    Alert.alert(
      '🗑️ Eliminar lista',
      `¿Seguro que querés borrar la lista "${playlist.nombre}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePlaylist(playlist.id);
              setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'No se pudo eliminar la lista');
            }
          },
        },
      ]
    );
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
  const durBase = dur > 0 ? dur : (actual?.duration || 0);
  const durEfectiva = Math.max(durBase, pos > 0 ? pos : 0);
  const estaSonando = Boolean(mediaUri && reproduciendo);

  const renderPlayerList = () => (
    <FlatList
      data={proximos}
      keyExtractor={(it, i) => 'q-' + i + '-' + it.id}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          {/* Slot de Video (Placeholder en Web para preservar espacio; iframe vive persistente en el portal) */}
          {Platform.OS === 'web' && mediaUri?.includes('/embed/') ? (
            modo === 'video' ? <View style={s.videoWeb} /> : null
          ) : Platform.OS !== 'web' && webEmbedUri ? (
            <View style={[s.video, { overflow: 'hidden', marginBottom: 12, position: 'relative' }, esLandscape && { height: 320 }]}>
              {NativeWebView ? (
                <NativeWebView
                  ref={webViewRef}
                  source={
                    webEmbedUri.startsWith('<')
                      ? { html: webEmbedUri, baseUrl: 'https://www.youtube.com' }
                      : { uri: webEmbedUri, headers: { Referer: 'https://www.youtube.com/' } }
                  }
                  style={{ flex: 1, backgroundColor: '#000' }}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  domStorageEnabled
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  allowsFullscreenVideo
                  setSupportMultipleWindows={false}
                  mixedContentMode="always"
                  injectedJavaScript={WEBVIEW_MONITOR}
                  onLoadEnd={() => webViewCmd(WEBVIEW_MONITOR)}
                  onMessage={onWebViewMessage}
                />
              ) : null}
              <Pressable focusable={true}
                onPress={alternarRotacion}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 99,
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.25)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {esLandscape ? '📱 Vertical' : '🔄 Rotar'}
                </Text>
              </Pressable>
            </View>
          ) : Platform.OS !== 'web' && modo === 'video' ? (
            <View style={{ position: 'relative', marginBottom: 12 }}>
              <VideoView
                player={player}
                style={[s.video, esLandscape && { height: 320 }]}
                nativeControls={true}
                fullscreenOptions={{ enable: true }}
                allowsPictureInPicture={true}
                contentFit="contain"
              />
              <Pressable focusable={true}
                onPress={alternarRotacion}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 99,
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.25)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {esLandscape ? '📱 Vertical' : '🔄 Rotar'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View style={s.audioBox}>
            {/* Portada en modo audio dentro del recuadro principal.
                Si el video corre en el WebView (fallback Android), no repetimos
                la portada: arriba ya se ve el reproductor de YouTube. */}
            {modo === 'audio' && !webEmbedUri ? (
              actual?.thumb ? (
                <Image
                  source={{ uri: actual.thumb }}
                  style={{
                    width: 220,
                    height: 220,
                    borderRadius: 16,
                    marginBottom: 14,
                    alignSelf: 'center',
                    backgroundColor: '#0a0a0a',
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                />
              ) : (
                <View style={{ width: 180, height: 180, borderRadius: 16, backgroundColor: '#222', alignSelf: 'center', marginBottom: 14 }} />
              )
            ) : null}

            <Text style={s.audioTitle} numberOfLines={2}>{actual?.title}</Text>
            <Text style={s.audioSub}>{actual?.channel}</Text>
            {!mediaUri || (usarNativo && (nativeResolving || nativeBuffering) && !reproduciendo) ? (
              error || audioTimeout ? (
                <View style={{ alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <Text style={s.audioErr}>{error || 'Tiempo de espera agotado'}</Text>
                  {actual ? (
                    <Pressable focusable={true}
                      style={[s.updateBtn, { paddingHorizontal: 16 }]}
                      onPress={() => { setError(null); setMediaUri(null); setAudioTimeout(false); if (audioTimeoutRef.current) { clearTimeout(audioTimeoutRef.current); audioTimeoutRef.current = null; } aplicar(actual, soloAudio, idxRef.current, true); }}
                    >
                      <Text style={s.updateBtnText}>🔄 Reintentar</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : <CargaAnim texto={nativeResolving ? "Resolviendo audio…" : "Cargando reproducción…"} />
            ) : null}
            {resumingInfo && actual && resumingInfo.trackId === actual.id ? (
              <View style={s.resumingBadge}>
                <Text style={s.resumingBadgeText}>⏱️ Reanudado desde {fmtTiempo(resumingInfo.pos)}</Text>
                <Pressable
                  focusable={true}
                  style={s.resumingResetBtn}
                  onPress={() => {
                    borrarProgreso(actual.id);
                    setResumingInfo(null);
                    saltar(0);
                  }}
                >
                  <Text style={s.resumingResetBtnText}>Desde 0:00</Text>
                </Pressable>
              </View>
            ) : null}
            <Barra pos={pos} dur={durEfectiva} onSeek={saltar} />
            <View style={s.timeRow}><Text style={s.timeText}>{fmtTiempo(pos)}</Text><Text style={s.timeText}>{fmtTiempo(durEfectiva)}</Text></View>
            <View style={s.ctrlRow}>
              <Pressable focusable={true} style={s.ctrlBtn} onPress={() => anterior()} disabled={!enCola || qIdx <= 0}>
                <Text style={[s.ctrl, (!enCola || qIdx <= 0) && s.ctrlOff]}>⏮</Text>
              </Pressable>
              <Pressable focusable={true} style={s.ctrlBtn} onPress={() => saltar(pos - 15)}><Text style={s.ctrl}>⏪</Text></Pressable>
              <Pressable focusable={true} style={s.playBtnCenter} onPress={togglePlay}>
                <Text style={[s.playBtnCenterIcon, !estaSonando && { marginLeft: 3 }]}>
                  {estaSonando ? '⏸' : '▶'}
                </Text>
              </Pressable>
              <Pressable focusable={true} style={s.ctrlBtn} onPress={() => saltar(pos + 15)}><Text style={s.ctrl}>⏩</Text></Pressable>
              <Pressable focusable={true} style={s.ctrlBtn} onPress={() => siguiente()} disabled={!enCola || (qIdx >= listaActiva.length - 1 && repeat !== 'all')}>
                <Text style={[s.ctrl, (!enCola || (qIdx >= listaActiva.length - 1 && repeat !== 'all')) && s.ctrlOff]}>⏭</Text>
              </Pressable>
            </View>

            {/* ── Botones de Descarga y Lista ── */}
            <View style={s.actionRow}>
              <Pressable focusable={true}
                style={[s.actionBtn, descargando && { opacity: 0.5 }]}
                onPress={descargar}
                disabled={!mediaUri || descargando}
              >
                <Text style={s.actionBtnIcon}>⬇️</Text>
                <Text style={s.actionBtnText}>{descargando ? 'Descargando…' : 'Descargar'}</Text>
              </Pressable>
              <Pressable focusable={true}
                style={s.actionBtn}
                onPress={abrirModalPlaylists}
                disabled={addingToPlaylist}
              >
                <Text style={s.actionBtnIcon}>➕</Text>
                <Text style={s.actionBtnText}>Añadir a lista</Text>
              </Pressable>
              <Pressable focusable={true} style={s.actionBtn} onPress={() => abrirEnYoutube()}>
                <Text style={s.actionBtnIcon}>▶️</Text>
                <Text style={s.actionBtnText}>YouTube</Text>
              </Pressable>
            </View>

            {/* ── Like / Dislike (solo en modo radio) ── */}
            {autoExtenderRef.current && actual ? (
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8, marginBottom: 2 }}>
                <Pressable
                  focusable={true}
                  onPress={darDislike}
                  style={[
                    s.actionBtn,
                    { flex: 0, paddingHorizontal: 20, paddingVertical: 8 },
                    radioDislikesRef.current.has(actual.id) && { backgroundColor: 'rgba(255,80,80,0.18)', borderColor: '#ff5050' },
                  ]}
                >
                  <Text style={{ fontSize: 20 }}>👎</Text>
                  <Text style={[s.actionBtnText, radioDislikesRef.current.has(actual.id) && { color: '#ff5050' }]}>No me gusta</Text>
                </Pressable>
                <Pressable
                  focusable={true}
                  onPress={darLike}
                  style={[
                    s.actionBtn,
                    { flex: 0, paddingHorizontal: 20, paddingVertical: 8 },
                    radioLikesRef.current.has(actual.id) && { backgroundColor: 'rgba(80,220,120,0.18)', borderColor: '#50dc78' },
                  ]}
                >
                  <Text style={{ fontSize: 20 }}>👍</Text>
                  <Text style={[s.actionBtnText, radioLikesRef.current.has(actual.id) && { color: '#50dc78' }]}>Me gusta</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <Text style={s.queueTitle}>A continuación{proximos.length ? ` (${proximos.length})` : ''}</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const realIdx = idxEfectivo + 1 + index;
        const isUpcoming = cola.length > 0 && realIdx > qIdx;
        const canMoveUp = isUpcoming && realIdx > qIdx + 1;
        const canMoveDown = isUpcoming && realIdx < cola.length - 1;

        return (
          <View style={s.qRow}>
            <Pressable focusable={true}
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
                <Pressable focusable={true}
                  style={[s.qActionBtn, !canMoveUp && { opacity: 0.25 }]}
                  disabled={!canMoveUp}
                  onPress={() => moverEnCola(realIdx, realIdx - 1)}
                >
                  <Text style={s.qActionText}>▲</Text>
                </Pressable>
                <Pressable focusable={true}
                  style={[s.qActionBtn, !canMoveDown && { opacity: 0.25 }]}
                  disabled={!canMoveDown}
                  onPress={() => moverEnCola(realIdx, realIdx + 1)}
                >
                  <Text style={s.qActionText}>▼</Text>
                </Pressable>
                <Pressable focusable={true}
                  style={[s.qActionBtn, { backgroundColor: 'rgba(255, 60, 60, 0.15)' }]}
                  onPress={() => quitarDeCola(realIdx)}
                >
                  <Text style={[s.qActionText, { color: '#ff5555' }]}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable focusable={true} onPress={() => aplicar(item, soloAudio, realIdx, true)} style={{ padding: 6 }}>
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
        <Pressable focusable={true} onPress={minimizar} style={{ padding: 8, marginRight: 6 }}>
          <Text style={{ color: theme.colors.textDim, fontSize: 22, fontWeight: '700' }}>⌄</Text>
        </Pressable>
        <View style={{ flex: 1, marginRight: 8, overflow: 'hidden' }}>
          <MarqueeText text={actual?.title || ''} style={s.modalTitle} speed={30} />
        </View>
        {(!soloAudio || modo === 'video') && (
          <Pressable focusable={true}
            onPress={alternarRotacion}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              marginRight: 8,
              borderRadius: 8,
              backgroundColor: esLandscape ? theme.colors.gold : 'rgba(255,255,255,0.08)',
              borderWidth: 1,
              borderColor: esLandscape ? theme.colors.gold : 'rgba(255,255,255,0.2)',
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: esLandscape ? '#001b1f' : '#fff' }}>
              {esLandscape ? '📱 Vertical' : '🔄 Rotar'}
            </Text>
          </Pressable>
        )}
        <Pressable focusable={true} onPress={cerrar} style={s.closeBtn}><Text style={s.closeText}>✕</Text></Pressable>
      </View>

      {/* Herramientas: Solo audio · Velocidad · Aleatorio · Repetir · Ecualizador · Listas · Info */}
      <View style={s.toolsRow}>
        <Pressable focusable={true} style={[s.tool, soloAudio && s.toolOn]} onPress={() => setAudio(!soloAudio)}>
          <Text style={[s.toolText, soloAudio && s.toolTextOn]}>🔊 {soloAudio ? 'Modo Audio' : 'Modo Video'}</Text>
        </Pressable>
        {(!soloAudio || modo === 'video') && (
          <Pressable focusable={true} style={[s.tool, esLandscape && s.toolOn]} onPress={alternarRotacion}>
            <Text style={[s.toolText, esLandscape && s.toolTextOn]}>
              {esLandscape ? '📱 Pantalla Vertical' : '🔄 Rotar Pantalla'}
            </Text>
          </Pressable>
        )}
        <Pressable focusable={true} style={[s.tool, velocidad !== 1 && s.toolOn]} onPress={() => setVelocidadOpen(true)}>
          <Text style={[s.toolText, velocidad !== 1 && s.toolTextOn]}>
            ⏱️ {velocidad !== 1 ? `${velocidad}x` : 'Velocidad'}
          </Text>
        </Pressable>
        <Pressable focusable={true} style={[s.tool, shuffle && s.toolOn]} onPress={toggleShuffle}>
          <Text style={[s.toolText, shuffle && s.toolTextOn]}>🔀 Aleatorio</Text>
        </Pressable>
        <Pressable focusable={true} style={[s.tool, repeat !== 'off' && s.toolOn]} onPress={ciclarRepeat}>
          <Text style={[s.toolText, repeat !== 'off' && s.toolTextOn]}>
            {repeat === 'one' ? '🔂 Repetir 1' : repeat === 'all' ? '🔁 Repetir todo' : '🔁 Repetir'}
          </Text>
        </Pressable>
        <Pressable focusable={true} style={[s.tool, eq !== 'flat' && s.toolOn]} onPress={() => setEqOpen(true)}>
          <Text style={[s.toolText, eq !== 'flat' && s.toolTextOn]}>🎚️ EQ</Text>
        </Pressable>
        {CAST_ANDROID ? (
          tv.conectado ? (
            <>
              <Pressable focusable={true} style={[s.tool, s.toolOn]} onPress={() => { tv.cortar(); setReproduciendo(false); }}>
                <Text style={[s.toolText, s.toolTextOn]}>📺 {tv.nombre || 'TV'} · Detener</Text>
              </Pressable>
              <Pressable focusable={true} style={s.tool} onPress={probarTv}>
                <Text style={s.toolText}>🔎 Probar TV</Text>
              </Pressable>
            </>
          ) : (
            <Pressable focusable={true} style={[s.tool, tv.ocupado && s.toolOn]} onPress={() => tv.conectar()} disabled={tv.ocupado}>
              <Text style={[s.toolText, tv.ocupado && s.toolTextOn]}>
                {tv.ocupado ? '⏳ Buscando TV…' : '📺 Chromecast'}
              </Text>
            </Pressable>
          )
        ) : null}
        <Pressable focusable={true}
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
        <Pressable focusable={true}
          style={[s.tool, iniciandoRadio && s.toolOn]}
          onPress={() => actual && iniciarRadioDesdeActual(actual)}
          disabled={iniciandoRadio || !actual}
        >
          <Text style={[s.toolText, iniciandoRadio && s.toolTextOn]}>
            {iniciandoRadio ? '⏳ Sintonizando…' : '📻 Iniciar Radio'}
          </Text>
        </Pressable>
        <Pressable focusable={true} style={s.tool} onPress={abrirModalPlaylists}>
          <Text style={s.toolText}>📋 Listas</Text>
        </Pressable>
        <Pressable focusable={true} style={s.tool} onPress={() => actual && fetchInfo(actual)}>
          <Text style={s.toolText}>💡 Info</Text>
        </Pressable>
      </View>
      {CAST_ANDROID && CastButtonHost ? (
        <View style={{ width: 1, height: 1, opacity: 0, overflow: 'hidden', position: 'absolute' }} pointerEvents="none">
          <CastButtonHost style={{ width: 1, height: 1 }} tintColor={theme.colors.gold} />
        </View>
      ) : null}
      {tv.error ? <Text style={s.eqNote}>{tv.error}</Text> : null}
      {tv.conectado ? (
        <Text style={s.eqNote}>📺 Transmitiendo a {tv.nombre || 'Chromecast'} · el audio sale por el TV</Text>
      ) : null}
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
        <Pressable focusable={true} style={s.iosBanner} onPress={() => setIosInstallOpen(true)}>
          <Text style={s.iosBannerIcon}>📲</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.iosBannerTitle}>Instalar YouThink en este iPhone</Text>
            <Text style={s.iosBannerSub}>Usalo a pantalla completa como una app real</Text>
          </View>
          <Text style={s.iosBannerBtn}>Instalar ›</Text>
        </Pressable>
      ) : null}

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
          value={query} onChangeText={setQuery} onSubmitEditing={buscarDesdeInput} returnKeyType="search" autoCorrect={false} />
        <TvPressable style={s.btn} onPress={buscarDesdeInput}><Text style={s.btnText}>🔎</Text></TvPressable>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 6, marginBottom: 4 }}>
        {((['all', 'songs', 'playlists', 'videos'] as const)).map((t) => {
          const activo = t === searchType;
          return (
            <TvPressable
              key={t}
              onPress={() => buscarConTipo(t)}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
                backgroundColor: activo ? theme.colors.gold + '22' : 'transparent',
                borderWidth: 1, borderColor: activo ? theme.colors.gold : theme.colors.border }}
            >
              <Text style={{ color: activo ? theme.colors.gold : theme.colors.textDim, fontSize: 12, fontWeight: activo ? '700' : '400' }}>
                {t === 'all' ? '🌐 Todo' : t === 'songs' ? '🎵 Canciones' : t === 'playlists' ? '📑 Listas' : '▶️ Videos'}
              </Text>
            </TvPressable>
          );
        })}
      </View>

      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>🔊 Solo audio (ahorra datos)</Text>
        <Switch value={soloAudio} onValueChange={setAudio} trackColor={{ true: theme.colors.gold, false: theme.colors.border }} />
      </View>
      <View style={s.toggleRow}>
        <Text style={s.toggleLabel}>⏭️ Avanzar solo a la siguiente</Text>
        <Switch value={autoSiguiente} onValueChange={setAuto} trackColor={{ true: theme.colors.gold, false: theme.colors.border }} />
      </View>
      {/* Acceso directo a listas de reproducción */}
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 6 }}>
        <TvPressable
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}
          onPress={abrirModalPlaylists}
        >
          <Text style={{ fontSize: 16 }}>📋</Text>
          <Text style={{ color: theme.colors.gold, fontWeight: '700', fontSize: 13 }}>Mis Playlists / Editar</Text>
        </TvPressable>
        <TvPressable
          style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' }}
          onPress={actualizarApp}
        >
          <Text style={{ color: theme.colors.textDim, fontWeight: '700', fontSize: 12 }}>🔄 Actualizar</Text>
        </TvPressable>
      </View>

      {results.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable focusable={true} style={[s.playAll, { flex: 1 }]} onPress={() => reproducir(results, 0, searchType === 'videos' ? false : soloAudio)}>
            <Text style={s.playAllText}>▶ Reproducir todo ({results.length})</Text>
          </Pressable>
          <Pressable focusable={true}
            style={[s.playAll, { flex: 0, paddingHorizontal: 16, backgroundColor: shuffle ? theme.colors.gold : theme.colors.surface2 }]}
            onPress={() => {
              const nuevo = !shuffle;
              setShuffle(nuevo);
              shuffleRef.current = nuevo;
              AsyncStorage.setItem('qp_shuffle', nuevo ? '1' : '0').catch(() => {});
              if (results.length > 0) {
                const idx = Math.floor(Math.random() * results.length);
                reproducir(results, idx, searchType === 'videos' ? false : soloAudio);
              }
            }}
          >
            <Text style={[s.playAllText, { color: shuffle ? '#001b1f' : theme.colors.gold }]}>🔀</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.colors.gold} style={{ marginTop: 24 }} /> : null}

      <FlatList style={{ flex: 1 }} data={results} keyExtractor={(it) => it.id} contentContainerStyle={{ paddingBottom: actual ? 90 : 24 }}
        renderItem={({ item, index }) => {
          const esPlaylist = item.kind === 'playlist' || item.kind === 'album';
          const esCargando = cargandoPlaylistId === item.id;
          const modoItem = searchType === 'videos' ? false : (searchType === 'songs' || searchType === 'playlists') ? true : soloAudio;

          if (esPlaylist) {
            return (
              <View style={[s.row, { borderLeftWidth: 3, borderLeftColor: item.kind === 'album' ? '#E5A93C' : theme.colors.gold }]}>
                <TvPressable
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, padding: 4, borderRadius: 8 }}
                  onPress={() => reproducirPlaylist(item)}
                >
                  <View style={{ position: 'relative' }}>
                    <Image source={{ uri: item.thumb }} style={s.thumb} />
                    <View style={{ position: 'absolute', right: 2, bottom: 2, backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
                      <Text style={{ color: item.kind === 'album' ? '#E5A93C' : theme.colors.gold, fontSize: 9, fontWeight: '800' }}>
                        {item.kind === 'album' ? 'DISCO' : 'LISTA'}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.title} numberOfLines={2}>
                      {item.kind === 'album' ? '💿 ' : '📑 '}
                      {item.title}
                    </Text>
                    <Text style={s.sub} numberOfLines={1}>
                      {item.channel ? `${item.channel} · ` : ''}
                      <Text style={{ color: item.kind === 'album' ? '#E5A93C' : theme.colors.gold, fontWeight: '700' }}>
                        {item.itemCountText || (item.kind === 'album' ? 'Álbum' : 'Lista')}
                      </Text>
                    </Text>
                  </View>
                </TvPressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                  <TvPressable
                    onPress={() => reproducirPlaylist(item)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.surface2, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    disabled={esCargando}
                  >
                    {esCargando ? (
                      <ActivityIndicator size="small" color={theme.colors.gold} />
                    ) : (
                      <>
                        <Text style={{ fontSize: 13 }}>▶️</Text>
                        <Text style={{ color: theme.colors.gold, fontSize: 12, fontWeight: '700' }}>Reproducir</Text>
                      </>
                    )}
                  </TvPressable>
                </View>
              </View>
            );
          }

          return (
          <View style={[s.row, qIdx === index && cola[qIdx]?.id === item.id ? s.rowActiva : null]}>
            <TvPressable style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, padding: 4, borderRadius: 8 }} onPress={() => reproducir(results, index, modoItem)}>
              <View style={{ position: 'relative' }}>
                <Image source={{ uri: item.thumb }} style={s.thumb} />
                {item.isAlbumVideo ? (
                  <View style={{ position: 'absolute', left: 2, top: 2, backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: '#E5A93C' }}>
                    <Text style={{ color: '#E5A93C', fontSize: 9, fontWeight: '900' }}>💿 ÁLBUM</Text>
                  </View>
                ) : null}
                {(item.duration > 0 || (item as any).durationText) ? (
                  <View style={{ position: 'absolute', right: 2, bottom: 2, backgroundColor: 'rgba(0,0,0,0.85)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
                      {item.duration > 0 ? fmtTiempo(item.duration) : (item as any).durationText}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={2}>
                  {item.isAlbumVideo ? '💿 ' : item.kind === 'song' ? '🎵 ' : item.kind === 'short' ? '⚡ ' : ''}
                  {item.title}
                </Text>
                <Text style={s.sub} numberOfLines={1}>
                  {item.channel}
                  {item.duration > 0 ? ` · ${fmtTiempo(item.duration)}` : ((item as any).durationText ? ` · ${(item as any).durationText}` : '')}
                  {item.isAlbumVideo ? ' · 💿 Álbum Completo' : ''}
                  {item.live ? ' · 🔴 EN VIVO' : ''}
                </Text>
              </View>
            </TvPressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              {actual ? (
                <TvPressable
                  style={{ padding: 8, backgroundColor: theme.colors.surface2, borderRadius: 8 }}
                  onPress={() => encolarCancion(item)}
                >
                  <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>➕ Cola</Text>
                </TvPressable>
              ) : null}
              <TvPressable onPress={() => reproducir(results, index, modoItem)} style={{ padding: 8, borderRadius: 8 }}>
                <Text style={s.play}>{qIdx === index && cola[qIdx]?.id === item.id ? '🔊' : modoItem ? '🔊' : '▶'}</Text>
              </TvPressable>
            </View>
          </View>
          );
        }}
        ListFooterComponent={
          results.length > 0 && nextPage ? (
            <Pressable focusable={true}
              style={{ marginTop: 12, marginBottom: 8, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
                backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}
              onPress={cargarMas}
              disabled={loadingMore}
            >
              <Text style={{ color: theme.colors.gold, fontWeight: '700' }}>
                {loadingMore ? '⏳ Cargando…' : '⬇️ Cargar más resultados'}
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            historial.length > 0 || recomendaciones.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                {/* ── 1. Historial de Reproducción ── */}
                {historial.length > 0 ? (
                  <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: theme.colors.gold }}>
                        🕒 Escuchados recientemente
                      </Text>
                      <Pressable focusable={true} onPress={limpiarHistorial} style={{ padding: 4 }}>
                        <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>🗑️ Borrar</Text>
                      </Pressable>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
                      {historial.map((item, index) => (
                        <Pressable focusable={true}
                          key={'hist-' + item.id}
                          style={{
                            width: 130,
                            backgroundColor: theme.colors.surface,
                            borderRadius: 12,
                            padding: 8,
                            borderWidth: 1,
                            borderColor: actual?.id === item.id ? theme.colors.gold : theme.colors.border,
                          }}
                          onPress={() => reproducir(historial, index, soloAudio)}
                        >
                          <View style={{ position: 'relative' }}>
                            <Image source={{ uri: item.thumb }} style={{ width: '100%', height: 76, borderRadius: 8, backgroundColor: '#111' }} />
                            <View style={{ position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Text style={{ color: theme.colors.gold, fontSize: 11, fontWeight: '700' }}>
                                {actual?.id === item.id && reproduciendo ? '🔊' : '▶'}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '700', marginTop: 6 }} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <Text style={{ color: theme.colors.textDim, fontSize: 10, marginTop: 2 }} numberOfLines={1}>
                            {item.channel}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* ── 2. Recomendados y Tendencias (derivados del historial) ── */}
                {recomendaciones.length > 0 ? (
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: theme.colors.gold }}>
                        {historial.length > 0 ? '🔥 Recomendados para vos' : '🔥 Tendencias & Recomendados'}
                      </Text>
                      <Pressable focusable={true} onPress={() => cargarRecomendaciones()} style={{ padding: 4 }}>
                        <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>🔄 Actualizar</Text>
                      </Pressable>
                    </View>
                    {cargandoRecomendaciones ? (
                      <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 20 }} />
                    ) : (
                      recomendaciones.map((it, idx) => (
                        <View key={'rec-' + it.id} style={[s.row, { marginBottom: 10 }]}>
                          <Pressable focusable={true} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }} onPress={() => reproducir(recomendaciones, idx, soloAudio)}>
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
                              <Pressable focusable={true}
                                style={{ padding: 8, backgroundColor: theme.colors.surface2, borderRadius: 8 }}
                                onPress={() => encolarCancion(it)}
                              >
                                <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '700' }}>➕ Cola</Text>
                              </Pressable>
                            ) : null}
                            <Pressable focusable={true} onPress={() => reproducir(recomendaciones, idx, soloAudio)} style={{ padding: 6 }}>
                              <Text style={s.play}>▶</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={s.empty}>Buscá un video o canción para empezar.</Text>
            )
          ) : null
        }
      />

      {/* ── BANNER DESCARGA APK ANDROID (solo web, parte inferior de la pantalla) ── */}
      {Platform.OS === 'web' && !esIosSafari && apkRelease ? (
        <Pressable
          focusable={true}
          style={[s.apkBanner, actual && !playerVisible ? { marginBottom: 82 } : null]}
          onPress={() => { try { Linking.openURL(apkRelease.url); } catch (_) {} }}
        >
          <Text style={s.apkBannerIcon}>📱</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.apkBannerTitle}>YouThink v{apkRelease.version} para Android</Text>
            <Text style={s.apkBannerSub}>Descarga directa</Text>
          </View>
          <Text style={s.apkBannerBtn}>⬇</Text>
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
                        zIndex: 5002,
                        pointerEvents: (lyricsOpen || infoOpen || eqOpen || velocidadOpen || playlistModalOpen || iosInstallOpen) ? 'none' : 'auto',
                      },
                    ]
                  : {
                      position: 'fixed' as any,
                      // Ubicado EXACTAMENTE detrás del thumbnail del mini player
                      // (tarjeta: bottom 86 + padding 10 => thumb a bottom 96, left 12+10=22).
                      // En pantallas anchas la tarjeta se centra (maxWidth 720), por eso
                      // el left usa max() para seguir el borde real de la tarjeta.
                      // Antes estaba a bottom:22 y pisaba la barra de pestañas inferior.
                      bottom: 96,
                      left: 'max(22px, calc(50vw - 360px + 10px))' as any,
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      overflow: 'hidden' as any,
                      zIndex: playerVisible ? 4999 : 5002,
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
                    zIndex: 5000,
                  } as any,
                  esLandscape && { paddingTop: 16, padding: 8 },
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

            {/* 3. Mini Player Web (flota a 74px del fondo para no pisar las pestañas inferiores) */}
            {!playerVisible && actual ? (
              <Pressable focusable={true}
                style={[
                  s.miniPlayer,
                  {
                    position: 'fixed' as any,
                    // 86px: flota bien arriba de la barra de pestañas (49px) sin pisarla
                    bottom: 86,
                    left: 12,
                    right: 12,
                    maxWidth: 720,
                    marginHorizontal: 'auto' as any,
                    zIndex: 99999,
                  },
                ]}
                onPress={() => setPlayerVisible(true)}
              >
                <Image source={{ uri: actual.thumb }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#000' }} />
                <View style={{ flex: 1, overflow: 'hidden' }}>
                  <MarqueeText text={actual.title || ''} style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }} speed={35} />
                  <Text style={{ color: theme.colors.textDim, fontSize: 11 }} numberOfLines={1}>{actual.channel}</Text>
                </View>
                <Pressable focusable={true} onPress={togglePlay} style={{ padding: 8 }}>
                  <Text style={{ color: theme.colors.gold, fontSize: 18 }}>{reproduciendo ? '⏸' : '▶'}</Text>
                </Pressable>
                <Pressable focusable={true} onPress={cerrar} style={{ padding: 8 }}>
                  <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>✕</Text>
                </Pressable>
              </Pressable>
            ) : null}
          </>,
          document.body
        )
      ) : Platform.OS !== 'web' ? (
        <Modal visible={Boolean(actual && playerVisible)} animationType={esLandscape ? "none" : "slide"} onRequestClose={esLandscape ? alternarRotacion : minimizar} statusBarTranslucent>
          {esLandscape && modo === 'video' ? (
            /* Modo Video Horizontal a Pantalla Completa Limpia (sin menús) */
            <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
              {webEmbedUri ? (
                <NativeWebView
                  ref={webViewRef}
                  source={
                    webEmbedUri.startsWith('<')
                      ? { html: webEmbedUri, baseUrl: 'https://www.youtube.com' }
                      : { uri: webEmbedUri, headers: { Referer: 'https://www.youtube.com/' } }
                  }
                  style={{ flex: 1, backgroundColor: '#000' }}
                  originWhitelist={['*']}
                  javaScriptEnabled
                  domStorageEnabled
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  allowsFullscreenVideo
                  setSupportMultipleWindows={false}
                  mixedContentMode="always"
                  injectedJavaScript={WEBVIEW_MONITOR}
                  onLoadEnd={() => webViewCmd(WEBVIEW_MONITOR)}
                  onMessage={onWebViewMessage}
                />
              ) : (
                <VideoView
                  player={player}
                  style={{ flex: 1, backgroundColor: '#000' }}
                  nativeControls={true}
                  fullscreenOptions={{ enable: true }}
                  allowsPictureInPicture={true}
                  contentFit="contain"
                />
              )}
              {/* Botón flotante para salir del modo pantalla completa / volver a vertical */}
              <Pressable
                focusable={true}
                onPress={alternarRotacion}
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  zIndex: 9999,
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.3)',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>📱 Salir Fullscreen</Text>
              </Pressable>
            </View>
          ) : (
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
          )}
        </Modal>
      ) : null}

      {/* Panel de Ecualizador */}
      <Modal visible={eqOpen} transparent animationType="fade" onRequestClose={() => setEqOpen(false)}>
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setEqOpen(false)}>
          <Pressable focusable={true} style={s.eqPanel} onPress={() => {}}>
            <Text style={s.eqTitle}>🎚️ Ecualizador</Text>
            <View style={s.eqGrid}>
              {Object.keys(EQ_PRESETS).map((k) => (
                <Pressable focusable={true} key={k} style={[s.eqItem, eq === k && s.eqItemOn]} onPress={() => aplicarEQ(k)}>
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
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setVelocidadOpen(false)}>
          <Pressable focusable={true} style={s.eqPanel} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={s.eqTitle}>⏱️ Velocidad de Reproducción</Text>
              <Text style={{ color: theme.colors.gold, fontSize: 22, fontWeight: '900' }}>{velocidad}x</Text>
            </View>

            {/* Presets de velocidad oficiales compatibles */}
            <View style={s.eqGrid}>
              {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((rate) => {
                const activo = velocidad === rate;
                return (
                  <Pressable focusable={true}
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
              <Pressable focusable={true}
                style={[s.eqItem, { flex: 1, paddingVertical: 10 }]}
                onPress={() => aplicarVelocidad(velocidad - 0.25)}
              >
                <Text style={s.eqItemText}>-0.25x</Text>
              </Pressable>
              <Pressable focusable={true}
                style={[s.eqItem, { flex: 1, paddingVertical: 10, backgroundColor: theme.colors.surface2 }]}
                onPress={() => aplicarVelocidad(1.0)}
              >
                <Text style={[s.eqItemText, { color: theme.colors.gold }]}>1.0x Normal</Text>
              </Pressable>
              <Pressable focusable={true}
                style={[s.eqItem, { flex: 1, paddingVertical: 10 }]}
                onPress={() => aplicarVelocidad(velocidad + 0.25)}
              >
                <Text style={s.eqItemText}>+0.25x</Text>
              </Pressable>
            </View>

            {/* Recarga forzada opcional: garantiza velocidad si la transmisión en vivo no tomó el cambio al vuelo */}
            {actual ? (
              <Pressable focusable={true}
                style={{
                  marginTop: 12,
                  backgroundColor: 'rgba(229, 178, 31, 0.12)',
                  borderWidth: 1,
                  borderColor: 'rgba(229, 178, 31, 0.4)',
                  borderRadius: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={() => recargarConVelocidad(velocidad)}
              >
                <Text style={{ fontSize: 16 }}>🔄</Text>
                <Text style={{ color: theme.colors.gold, fontSize: 12, fontWeight: '700' }}>
                  Recargar tema actual a {velocidad}x
                </Text>
              </Pressable>
            ) : null}

            {/* Atajo hacia Tap Tempo */}
            <Pressable focusable={true}
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
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setPlaylistModalOpen(false)}>
          <Pressable focusable={true} style={[s.eqPanel, { maxHeight: '80%' }]} onPress={() => {}}>
            <Text style={s.eqTitle}>➕ Añadir a lista</Text>
            <Text style={[s.eqFoot, { marginTop: -8, marginBottom: 8, textAlign: 'left' }]}>
              📋 ver y borrar canciones · ✏️ renombrar · 🗑️ borrar la lista entera
            </Text>

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
              <Pressable focusable={true}
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
                renderItem={({ item }) => {
                  const esYT = item.id.startsWith('yt_');
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable focusable={true}
                        style={[s.plItem, { flex: 1 }]}
                        onPress={() => agregarALista(item)}
                        disabled={addingToPlaylist}
                      >
                        <Text style={s.plItemIcon}>{esYT ? '▶️' : '🎵'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={s.plItemText} numberOfLines={1}>{item.nombre}</Text>
                          <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 1 }}>
                            {esYT ? (item.items_count !== undefined ? `${item.items_count} temas · YouTube` : 'YouTube') : 'YouThink'}
                          </Text>
                        </View>
                        {addingToPlaylist ? <ActivityIndicator color={theme.colors.gold} size="small" /> : <Text style={s.plItemArrow}>›</Text>}
                      </Pressable>
                      {/* Botón para ver y gestionar items */}
                      <Pressable focusable={true}
                        style={{ padding: 9, marginLeft: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}
                        onPress={() => { setPlaylistModalOpen(false); abrirGestionPlaylist(item); }}
                      >
                        <Text style={{ fontSize: 15 }}>📋</Text>
                      </Pressable>
                      {/* Botón para renombrar */}
                      <Pressable focusable={true}
                        style={{ padding: 9, marginLeft: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}
                        onPress={() => { setPlaylistModalOpen(false); abrirRenombrar(item); }}
                      >
                        <Text style={{ fontSize: 15 }}>✏️</Text>
                      </Pressable>
                      {/* Botón para borrar playlist completa */}
                      <Pressable focusable={true}
                        style={{ padding: 9, marginLeft: 4, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.55)', backgroundColor: 'rgba(255, 60, 60, 0.16)' }}
                        onPress={() => eliminarLista(item)}
                      >
                        <Text style={{ fontSize: 15 }}>🗑️</Text>
                      </Pressable>
                    </View>
                  );
                }}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de gestión de items de playlist */}
      <Modal visible={!!managingPlaylist} transparent animationType="fade" onRequestClose={() => setManagingPlaylist(null)}>
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setManagingPlaylist(null)}>
          <Pressable focusable={true} style={[s.eqPanel, { maxHeight: '85%' }]} onPress={() => {}}>
            <Text style={s.eqTitle} numberOfLines={1}>📋 {managingPlaylist?.nombre}</Text>
            <Text style={[s.eqFoot, { marginTop: -8, marginBottom: 8, textAlign: 'left' }]}>
              Tocá 🗑️ para borrar una canción de la lista.
            </Text>
            {loadingManagingItems ? (
              <ActivityIndicator color={theme.colors.gold} style={{ marginVertical: 20 }} />
            ) : managingItems.length === 0 ? (
              <Text style={[s.eqFoot, { marginTop: 12 }]}>Esta lista está vacía.</Text>
            ) : (
              <FlatList
                data={managingItems}
                keyExtractor={(it) => it.yt_id}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 4 }}
                renderItem={({ item }) => (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border, minHeight: 56 }}>
                    {item.thumb ? (
                      <Image source={{ uri: item.thumb }} style={{ width: 48, height: 36, borderRadius: 4, marginRight: 10, flexShrink: 0 }} />
                    ) : (
                      <View style={{ width: 48, height: 36, backgroundColor: theme.colors.surface2, borderRadius: 4, marginRight: 10, flexShrink: 0 }} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={2}>{item.title}</Text>
                      <Text style={{ color: theme.colors.textDim, fontSize: 11 }}>{item.channel}</Text>
                    </View>
                    {/* Botón Reproducir */}
                    <Pressable
                      focusable={true}
                      style={{ paddingHorizontal: 11, paddingVertical: 8, flexShrink: 0, marginLeft: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(229, 178, 31, 0.4)', backgroundColor: 'rgba(229, 178, 31, 0.12)' }}
                      onPress={() => {
                        setManagingPlaylist(null);
                        const track: YtResult = {
                          id: item.yt_id,
                          title: item.title,
                          channel: item.channel,
                          thumb: item.thumb,
                          duration: item.duration,
                          url: `https://www.youtube.com/watch?v=${item.yt_id}`,
                          kind: 'song',
                        };
                        reproducir([track], 0, true);
                      }}
                    >
                      <Text style={{ fontSize: 15 }}>▶️</Text>
                    </Pressable>
                    {/* Botón Eliminar (rojo, bien visible) */}
                    <Pressable
                      focusable={true}
                      style={{ paddingHorizontal: 11, paddingVertical: 8, flexShrink: 0, marginLeft: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.55)', backgroundColor: 'rgba(255, 60, 60, 0.16)' }}
                      onPress={() => borrarDePlaylist(item.yt_id)}
                      disabled={deletingItem === item.yt_id}
                    >
                      {deletingItem === item.yt_id
                        ? <ActivityIndicator color={theme.colors.danger} size="small" />
                        : <Text style={{ fontSize: 15 }}>🗑️</Text>
                      }
                    </Pressable>
                  </View>
                )}
              />
            )}
            <Pressable focusable={true}
              style={[s.plCreateBtn, { marginTop: 12, alignSelf: 'flex-end' }]}
              onPress={() => setManagingPlaylist(null)}
            >
              <Text style={s.plCreateBtnText}>Cerrar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal renombrar playlist */}
      <Modal visible={!!renombrando} transparent animationType="fade" onRequestClose={() => setRenombrando(null)}>
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setRenombrando(null)}>
          <Pressable focusable={true} style={[s.eqPanel, { gap: 12 }]} onPress={() => {}}>
            <Text style={s.eqTitle}>✏️ Renombrar lista</Text>
            <TextInput
              style={[s.plInput, { width: '100%' }]}
              value={renombreTexto}
              onChangeText={setRenombreTexto}
              autoFocus
              autoCorrect={false}
              placeholder="Nombre de la lista"
              placeholderTextColor={theme.colors.textDim}
              onSubmitEditing={confirmarRenombrar}
            />
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable focusable={true} style={[s.plCreateBtn, { backgroundColor: theme.colors.surface2 }]} onPress={() => setRenombrando(null)}>
                <Text style={[s.plCreateBtnText, { color: theme.colors.textDim }]}>Cancelar</Text>
              </Pressable>
              <Pressable focusable={true} style={s.plCreateBtn} onPress={confirmarRenombrar}>
                <Text style={s.plCreateBtnText}>Guardar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal de Info IA */}
      <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}>
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setInfoOpen(false)}>
          <Pressable focusable={true} style={s.eqPanel} onPress={() => {}}>
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
              <Pressable focusable={true}
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
        <Pressable focusable={true} style={s.eqBackdrop} onPress={() => setIosInstallOpen(false)}>
          <Pressable focusable={true} style={s.eqPanel} onPress={() => {}}>
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

            <Pressable focusable={true}
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
            <Pressable focusable={true} onPress={() => setLyricsOpen(false)} style={s.closeBtn}>
              <Text style={s.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Selector de modo de idioma: Original | Traducida | Bilingüe */}
          <View style={s.lyricsTabs}>
            <Pressable focusable={true} style={[s.lyricsTab, modoLetra === 'original' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('original')}>
              <Text style={[s.lyricsTabText, modoLetra === 'original' && s.lyricsTabTextOn]}>🔤 Original</Text>
            </Pressable>
            <Pressable focusable={true} style={[s.lyricsTab, modoLetra === 'traducida' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('traducida')}>
              <Text style={[s.lyricsTabText, modoLetra === 'traducida' && s.lyricsTabTextOn]}>🌐 Español</Text>
            </Pressable>
            <Pressable focusable={true} style={[s.lyricsTab, modoLetra === 'bilingue' && s.lyricsTabOn]} onPress={() => cambiarModoLetra('bilingue')}>
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
                <Pressable focusable={true} style={[s.btn, { marginTop: 16, paddingVertical: 10, paddingHorizontal: 16 }]} onPress={() => cargarLyrics(actual)}>
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
                  <Pressable focusable={true}
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
            <Pressable focusable={true} style={s.lyricsPlayBtn} onPress={togglePlay}>
              <Text style={[s.lyricsPlayIcon, !estaSonando && { marginLeft: 2 }]}>
                {estaSonando ? '⏸' : '▶'}
              </Text>
            </Pressable>
            {!autoScrollLyrics && (
              <Pressable focusable={true} style={s.lyricsResumeBtn} onPress={() => setAutoScrollLyrics(true)}>
                <Text style={{ color: theme.colors.gold, fontSize: 12, fontWeight: '700' }}>⬇ Seguir</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Toast de feedback de radio ── */}
      {toastFeedback ? (
        <View pointerEvents="none" style={{
          position: 'absolute', bottom: 100, left: 0, right: 0,
          alignItems: 'center', zIndex: 9999,
        }}>
          <View style={{
            backgroundColor: 'rgba(20,20,20,0.92)', borderRadius: 24,
            paddingVertical: 10, paddingHorizontal: 22,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
          }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{toastFeedback}</Text>
          </View>
        </View>
      ) : null}
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
    bottom: 86,
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
  eqBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, ...(Platform.OS === 'web' ? { zIndex: 110000 } : {}) },
  eqPanel: { width: '100%', maxWidth: 360, backgroundColor: theme.colors.surface, borderRadius: 16, padding: 20 },
  eqTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginBottom: 14, textAlign: 'center' },
  eqGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  eqItem: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border },
  eqItemOn: { backgroundColor: theme.colors.gold, borderColor: theme.colors.gold },
  eqItemText: { color: theme.colors.text, fontWeight: '600' },
  eqFoot: { color: theme.colors.textDim, fontSize: 12, marginTop: 14, textAlign: 'center' },
  lyricsModal: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 16, paddingTop: 48, ...(Platform.OS === 'web' ? { zIndex: 110000 } : {}) },
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

  // Banner descarga APK Android (web, pie de pantalla)
  apkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(78, 205, 100, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(78, 205, 100, 0.35)',
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
    marginBottom: 6,
  },
  apkBannerIcon: { fontSize: 22 },
  apkBannerTitle: { color: '#4ecd64', fontSize: 13, fontWeight: '700' },
  apkBannerSub: { color: theme.colors.textDim, fontSize: 11, marginTop: 1 },
  apkBannerBtn: { color: '#4ecd64', fontSize: 18, fontWeight: '800', paddingHorizontal: 6 },

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
  resumingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderColor: 'rgba(212, 175, 55, 0.4)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 10,
    marginTop: 4,
  },
  resumingBadgeText: {
    color: theme.colors.gold,
    fontSize: 12,
    fontWeight: '600',
  },
  resumingResetBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  resumingResetBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
