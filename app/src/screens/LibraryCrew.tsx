import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { api, CrewTrack } from '../lib/api';
import { downloadFile } from '../lib/downloads';
import { supabase } from '../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';
import { NATIVE_AUDIO, useNativeAudio } from '../lib/nativeAudio';
import { playerStore } from '../lib/playerStore';
import { theme } from '../theme';
import StarRating from '../components/StarRating';
import { useRatings } from '../lib/ratingsStore';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface CrewPlaylist {
  id: string;
  nombre: string;
  creadaEn: string;
  trackIds: string[];
  isPublic?: boolean;   // false = Privada (sólo en este dispositivo), true = Compartida con Crew
  shareCode?: string;  // Código para compartir ej. "CREW-89F2"
  uploadedBy?: string; // Creador
}

type RepeatMode = 'off' | 'all' | 'one';

const EQ_PRESETS: Record<string, { label: string; icon: string }> = {
  flat: { label: 'Plano', icon: '🎧' },
  bass: { label: 'Bajos +', icon: '🔊' },
  vocal: { label: 'Voces', icon: '🎙️' },
  rock: { label: 'Rock', icon: '🎸' },
  pop: { label: 'Pop', icon: '🎹' },
  electronic: { label: 'Electrónica', icon: '⚡' },
};

const SUPABASE_URL = 'https://prixtmnilittshdegrxq.supabase.co';
const ANON_KEY = 'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtSize(bytes?: number | null) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTiempo(seg?: number | null) {
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

function generarCodigoShare() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let res = 'CREW-';
  for (let i = 0; i < 4; i++) {
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return res;
}

const MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
  m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
};

// ─── Componente Principal ─────────────────────────────────────────────────────
export default function LibraryCrew() {
  const native = useNativeAudio();
  const [tracks, setTracks] = useState<CrewTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const { getRating, setRating } = useRatings();
  const [calificandoTrack, setCalificandoTrack] = useState<CrewTrack | null>(null);

  // Sub-tabs de Library Crew: 'tracks' o 'playlists'
  const [activeTab, setActiveTab] = useState<'tracks' | 'playlists'>('tracks');

  // Filtro de tracks: 'all' (visibles en crew) | 'mine' (solo mis subidas) | 'hidden' (mis tracks ocultos sin playlist)
  const [trackFilter, setTrackFilter] = useState<'all' | 'mine' | 'hidden'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Playlists exclusivas de Library Crew
  const [playlists, setPlaylists] = useState<CrewPlaylist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<CrewPlaylist | null>(null);
  const [addToPlaylistModalOpen, setAddToPlaylistModalOpen] = useState(false);
  const [targetTrack, setTargetTrack] = useState<CrewTrack | null>(null);
  const [crearPlaylistModalOpen, setCrearPlaylistModalOpen] = useState(false);
  const [nombreNuevaPlaylist, setNombreNuevaPlaylist] = useState('');
  const [nuevaPlaylistPublica, setNuevaPlaylistPublica] = useState(false);

  // Modal para compartir o importar con código
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [playlistToShare, setPlaylistToShare] = useState<CrewPlaylist | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCodeInput, setImportCodeInput] = useState('');

  // Menús de Reproducción (Shuffle, Repeat, EQ, Progreso)
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [eq, setEq] = useState('flat');
  const [eqModalOpen, setEqModalOpen] = useState(false);
  const [currentPos, setCurrentPos] = useState(0);
  const [currentDur, setCurrentDur] = useState(0);

  // Cola de reproducción
  const [playlistPlayingInfo, setPlaylistPlayingInfo] = useState<{ id: string; nombre: string; index: number; total: number } | null>(null);
  const playlistQueueRef = useRef<{ id: string; nombre: string; trackIds: string[]; index: number } | null>(null);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>('off');

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [myUploadedTrackIds, setMyUploadedTrackIds] = useState<Set<string>>(new Set());
  const webAudioRef = useRef<any>(null);
  const lastPlayTapRef = useRef<number>(0);

  // Campos del modal de subida
  const [uTitle, setUTitle] = useState('');
  const [uArtist, setUArtist] = useState('');
  const [uFile, setUFile] = useState<{ uri: string; name: string; size?: number } | null>(null);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  useEffect(() => {
    AsyncStorage.getItem('qp_user_email').then(v => { if (v) setUserEmail(v.trim()); }).catch(() => {});
    AsyncStorage.getItem('qp_my_uploaded_track_ids').then(raw => {
      if (raw) {
        try { setMyUploadedTrackIds(new Set(JSON.parse(raw))); } catch (_) {}
      }
    }).catch(() => {});
    supabase.auth.getUser().then((res: any) => {
      const u = res?.data?.user;
      if (u?.email) {
        const em = u.email.trim();
        setUserEmail(em);
        AsyncStorage.setItem('qp_user_email', em).catch(() => {});
      }
    }).catch(() => {});
    cargar();
    cargarPlaylists();

    // Sincronizar estado con playerStore
    const unsub = playerStore.subscribe((st) => {
      if (!st.actual || st.actual.source !== 'crew') {
        setPlayingId(null);
        setReproduciendo(false);
        setPlaylistPlayingInfo(null);
        setCurrentPos(0);
        setCurrentDur(0);
      } else {
        const cId = st.actual.id.replace(/^crew_/, '');
        setPlayingId(cId);
        setReproduciendo(!!st.reproduciendo);
        setCurrentPos(st.pos || 0);
        setCurrentDur(st.dur || 0);
      }
    });

    return () => {
      unsub();
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      playerStore.setState({ activeTab: 'Library Crew' });
    }, [])
  );

  // Sincronizar progreso y fin de canción con QpAudio nativo en Android
  useEffect(() => {
    if (!NATIVE_AUDIO || !QpAudio || typeof (QpAudio as any).addListener !== 'function') return;
    try {
      const sub = (QpAudio as any).addListener('onPlaybackState', (st: any) => {
        const curActual = playerStore.getState().actual;
        if (curActual?.source !== 'crew') return;

        if (typeof st.isPlaying === 'boolean') {
          setReproduciendo(st.isPlaying);
          playerStore.setState({ reproduciendo: st.isPlaying });
        }
        if (isFinite(st.position) && st.position >= 0) {
          const p = Math.floor(st.position);
          setCurrentPos(p);
          playerStore.setState({ pos: p });
        }
        if (isFinite(st.duration) && st.duration > 0) {
          const d = Math.floor(st.duration);
          setCurrentDur(d);
          playerStore.setState({ dur: d });
        }
        if (st.ended) {
          if (repeatRef.current === 'one') {
            native.seek(0);
            native.resume();
            return;
          }
          if (playlistQueueRef.current) {
            const q = playlistQueueRef.current;
            let nextIdx = q.index + 1;
            if (shuffleRef.current && q.trackIds.length > 1) {
              nextIdx = Math.floor(Math.random() * q.trackIds.length);
            }
            reproducirTrackEnLista(nextIdx, q);
          } else {
            detenerAudioCrew();
          }
        }
      });
      return () => {
        try { sub?.remove?.(); } catch (_) {}
      };
    } catch (_) {}
  }, []);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.crewListTracks('main');
      setTracks(data.tracks || []);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar Library Crew');
    } finally {
      setLoading(false);
    }
  }

  // ─── Playlists de Library Crew (AsyncStorage + Supabase Cloud) ─────────────
  async function cargarPlaylists() {
    try {
      // 1. Cargar locales
      let locales: CrewPlaylist[] = [];
      const raw = await AsyncStorage.getItem('qp_crew_playlists_v1');
      if (raw) locales = JSON.parse(raw);

      // 2. Cargar públicas de Supabase (events table con tipo youthink_crew_playlists)
      try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/events?tipo=eq.youthink_crew_playlists&select=*`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
        });
        if (resp.ok) {
          const rows = await resp.json();
          if (Array.isArray(rows) && rows.length > 0) {
            const publicasCloud: CrewPlaylist[] = JSON.parse(rows[0].notas || '[]');
            // Merge: si una pública no está en locales o tiene shareCode idéntico, incorporarla
            const mapa = new Map<string, CrewPlaylist>();
            locales.forEach(p => mapa.set(p.id, p));
            publicasCloud.forEach(p => {
              if (!mapa.has(p.id)) {
                mapa.set(p.id, { ...p, isPublic: true });
              }
            });
            const combinadas = Array.from(mapa.values());
            setPlaylists(combinadas);
            await AsyncStorage.setItem('qp_crew_playlists_v1', JSON.stringify(combinadas));
            return;
          }
        }
      } catch (_) {}

      setPlaylists(locales);
    } catch (_) {}
  }

  async function persistirPlaylists(nuevas: CrewPlaylist[]) {
    setPlaylists(nuevas);
    try {
      await AsyncStorage.setItem('qp_crew_playlists_v1', JSON.stringify(nuevas));

      // Sincronizar las públicas a Supabase
      const publicas = nuevas.filter(p => p.isPublic);
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/events?tipo=eq.youthink_crew_playlists&select=id`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
      });
      if (resp.ok) {
        const rows = await resp.json();
        const payload = {
          cliente: '__CREW_PLAYLISTS__',
          date: '2099-12-31',
          user_id: '9dd9fe61-d95e-436a-9497-2aedc784df34',
          notas: JSON.stringify(publicas),
          estado: 'finalizado',
          hora: '00:00',
          tipo: 'youthink_crew_playlists',
          precio: 0,
        };
        if (Array.isArray(rows) && rows.length > 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${rows[0].id}`, {
            method: 'PATCH',
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notas: JSON.stringify(publicas) })
          });
        } else {
          await fetch(`${SUPABASE_URL}/rest/v1/events`, {
            method: 'POST',
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }
      }
    } catch (_) {}
  }

  async function crearNuevaPlaylist() {
    const nombre = nombreNuevaPlaylist.trim();
    if (!nombre) return;
    const nueva: CrewPlaylist = {
      id: 'cpl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      nombre,
      creadaEn: new Date().toLocaleDateString(),
      trackIds: targetTrack ? [targetTrack.id] : [],
      isPublic: nuevaPlaylistPublica,
      shareCode: generarCodigoShare(),
      uploadedBy: userEmail || 'Crew Member',
    };
    const actualizadas = [nueva, ...playlists];
    await persistirPlaylists(actualizadas);
    setNombreNuevaPlaylist('');
    setNuevaPlaylistPublica(false);
    setCrearPlaylistModalOpen(false);
    if (targetTrack) {
      Alert.alert('¡Añadido!', `"${targetTrack.title}" añadido a "${nombre}" 👥`);
      setAddToPlaylistModalOpen(false);
      setTargetTrack(null);
    }
  }

  async function alternarVisibilidadPlaylist(pl: CrewPlaylist) {
    const nuevoEstado = !pl.isPublic;
    const actualizadas = playlists.map(p => p.id === pl.id ? { ...p, isPublic: nuevoEstado, shareCode: p.shareCode || generarCodigoShare() } : p);
    await persistirPlaylists(actualizadas);
    if (selectedPlaylist?.id === pl.id) {
      setSelectedPlaylist({ ...selectedPlaylist, isPublic: nuevoEstado });
    }
    Alert.alert(
      nuevoEstado ? '🌐 Playlist Compartida' : '🔒 Playlist Privada',
      nuevoEstado
        ? `"${pl.nombre}" ahora es pública para toda la Crew. Sus canciones serán visibles.`
        : `"${pl.nombre}" ahora es privada. Sus pistas que no estén en otras listas públicas permanecerán ocultas.`
    );
  }

  async function alternarTrackEnPlaylist(pl: CrewPlaylist, trackId: string) {
    const yaEsta = pl.trackIds.includes(trackId);
    const nuevosIds = yaEsta
      ? pl.trackIds.filter(id => id !== trackId)
      : [...pl.trackIds, trackId];
    const actualizadas = playlists.map(p => p.id === pl.id ? { ...p, trackIds: nuevosIds } : p);
    await persistirPlaylists(actualizadas);
    if (selectedPlaylist?.id === pl.id) {
      setSelectedPlaylist({ ...selectedPlaylist, trackIds: nuevosIds });
    }
  }

  async function eliminarPlaylist(pl: CrewPlaylist) {
    Alert.alert(
      'Eliminar Playlist',
      `¿Eliminar la playlist "${pl.nombre}" de Library Crew?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: async () => {
            const actualizadas = playlists.filter(p => p.id !== pl.id);
            await persistirPlaylists(actualizadas);
            if (selectedPlaylist?.id === pl.id) setSelectedPlaylist(null);
            if (playlistQueueRef.current?.id === pl.id) detenerAudioCrew();
          }
        }
      ]
    );
  }

  async function importarPlaylistPorCodigo() {
    const codigo = importCodeInput.trim().toUpperCase();
    if (!codigo) {
      Alert.alert('Falta código', 'Ingresá el código de la playlist que querés importar.');
      return;
    }
    // Buscar en playlists remotas de Supabase
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/events?tipo=eq.youthink_crew_playlists&select=*`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
      });
      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const publicas: CrewPlaylist[] = JSON.parse(rows[0].notas || '[]');
          const encontrada = publicas.find(p => p.shareCode === codigo || p.id === codigo);
          if (encontrada) {
            if (playlists.some(p => p.id === encontrada.id)) {
              Alert.alert('Ya la tenés', `La playlist "${encontrada.nombre}" ya está en tu lista.`);
              setImportModalOpen(false);
              setImportCodeInput('');
              return;
            }
            const nuevas = [encontrada, ...playlists];
            await persistirPlaylists(nuevas);
            Alert.alert('¡Importada!', `Se añadió "${encontrada.nombre}" con ${encontrada.trackIds.length} canciones.`);
            setImportModalOpen(false);
            setImportCodeInput('');
            setActiveTab('playlists');
            setSelectedPlaylist(encontrada);
            return;
          }
        }
      }
    } catch (_) {}
    Alert.alert('No encontrada', `No se encontró ninguna playlist con el código "${codigo}". Verificá que sea una playlist compartida.`);
  }

  // ─── LÓGICA DE VISIBILIDAD (Regla de Oro: Tracks sin playlist = Ocultos) ───
  // 1. Obtener conjunto de trackIds que están incluidos en alguna playlist pública
  const trackIdsEnPlaylistsPublicas = useMemo(() => {
    const ids = new Set<string>();
    playlists.filter(p => p.isPublic).forEach(p => {
      p.trackIds.forEach(id => ids.add(id));
    });
    return ids;
  }, [playlists]);

  // 2. Obtener conjunto de trackIds que están en CUALQUIER playlist (pública o privada)
  const trackIdsEnCualquierPlaylist = useMemo(() => {
    const ids = new Set<string>();
    playlists.forEach(p => {
      p.trackIds.forEach(id => ids.add(id));
    });
    return ids;
  }, [playlists]);

  // Determinar si el usuario actual es el uploader de este track
  const checkSoyUploader = useCallback((t: CrewTrack) => {
    if (userEmail && t.uploaded_by && t.uploaded_by.toLowerCase() === userEmail.toLowerCase()) return true;
    if (myUploadedTrackIds.has(t.id)) return true;
    // Si el track no tiene uploader asignado en la BD o es 'Crew Member' y estamos en este dispositivo
    if (!t.uploaded_by || t.uploaded_by === 'Crew Member') return true;
    return false;
  }, [userEmail, myUploadedTrackIds]);

  // 3. Filtrar catálogo de canciones según regla:
  // - Un track es visible para la Crew si está en al menos una playlist pública.
  // - Los tracks que no tengan playlist o sean de playlist privada sólo los ve su uploader.
  const visibleTracks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return tracks.filter(t => {
      const soyUploader = checkSoyUploader(t);
      const estaEnPublica = trackIdsEnPlaylistsPublicas.has(t.id);
      const estaEnAlguna = trackIdsEnCualquierPlaylist.has(t.id);

      // Si es otro usuario y el track NO está en playlist pública, permanece OCULTO
      if (!estaEnPublica && !soyUploader) {
        return false;
      }

      // Filtro de solapa de visualización
      if (trackFilter === 'mine' && !soyUploader) return false;
      if (trackFilter === 'hidden') {
        // Mis tracks que no están en ninguna playlist
        if (!soyUploader || estaEnAlguna) return false;
      }

      // Filtro de búsqueda por texto
      if (q) {
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchArtist = (t.artist || '').toLowerCase().includes(q);
        const matchUploader = (t.uploaded_by || '').toLowerCase().includes(q);
        if (!matchTitle && !matchArtist && !matchUploader) return false;
      }

      return true;
    });
  }, [tracks, checkSoyUploader, trackIdsEnPlaylistsPublicas, trackIdsEnCualquierPlaylist, trackFilter, searchQuery]);

  // Conteo de tracks del usuario que están ocultos (sin playlist)
  const misTracksOcultosCount = useMemo(() => {
    return tracks.filter(t => {
      const soyUploader = checkSoyUploader(t);
      return soyUploader && !trackIdsEnCualquierPlaylist.has(t.id);
    }).length;
  }, [tracks, checkSoyUploader, trackIdsEnCualquierPlaylist]);

  // ─── Reproducción & Controles Avanzados ──────────────────────────────────────
  function detenerAudioCrew() {
    if (webAudioRef.current) {
      try { webAudioRef.current.pause(); } catch (_) {}
      webAudioRef.current = null;
    }
    if (NATIVE_AUDIO) {
      native.stop();
    }
    playlistQueueRef.current = null;
    setPlayingId(null);
    setReproduciendo(false);
    setPlaylistPlayingInfo(null);
    setCurrentPos(0);
    setCurrentDur(0);
    playerStore.setState({ actual: null, reproduciendo: false, pos: 0, dur: 0 });
  }

  function reproducirTrackEnLista(nextIndex: number, queue: { id: string; nombre: string; trackIds: string[]; index: number }) {
    if (nextIndex >= queue.trackIds.length) {
      if (repeatRef.current === 'all') {
        reproducirTrackEnLista(0, queue);
        return;
      }
      detenerAudioCrew();
      return;
    }
    const nextTrackId = queue.trackIds[nextIndex];
    const track = tracks.find(t => t.id === nextTrackId);
    if (!track) {
      reproducirTrackEnLista(nextIndex + 1, queue);
      return;
    }
    reproducir(track, { ...queue, index: nextIndex });
  }

  function alternarPlayPausaCentral() {
    if (!NATIVE_AUDIO && webAudioRef.current) {
      if (webAudioRef.current.paused) {
        try { webAudioRef.current.play(); } catch (_) {}
        setReproduciendo(true);
        playerStore.setState({ reproduciendo: true });
      } else {
        try { webAudioRef.current.pause(); } catch (_) {}
        setReproduciendo(false);
        playerStore.setState({ reproduciendo: false });
      }
    } else if (NATIVE_AUDIO) {
      native.toggle();
    }
  }

  async function reproducir(track: CrewTrack, queueContext?: { id: string; nombre: string; trackIds: string[]; index: number }) {
    if (!track) return;
    const now = Date.now();
    if (now - lastPlayTapRef.current < 250 && playingId === track.id) return;
    lastPlayTapRef.current = now;

    // Si ya está sonando este mismo track y no viene de forzar cola: alternar play / pausa
    if (playingId === track.id && !queueContext) {
      alternarPlayPausaCentral();
      return;
    }

    // Detenemos audio anterior
    if (webAudioRef.current) {
      try { webAudioRef.current.pause(); } catch (_) {}
      webAudioRef.current = null;
    }

    if (queueContext) {
      playlistQueueRef.current = queueContext;
      setPlaylistPlayingInfo({
        id: queueContext.id,
        nombre: queueContext.nombre,
        index: queueContext.index + 1,
        total: queueContext.trackIds.length,
      });
    } else {
      playlistQueueRef.current = null;
      setPlaylistPlayingInfo(null);
    }

    setPlayingId(track.id);
    setReproduciendo(true);

    // Registro en playerStore: activa inmediatamente el MiniPlayer flotante
    const itemActual: any = {
      id: 'crew_' + track.id,
      title: track.title,
      channel: track.artist || (track.uploaded_by ? `Crew · ${track.uploaded_by}` : 'Library Crew'),
      duration: track.duration || 0,
      url: track.audio_url,
      thumb: track.cover_url || '',
      kind: 'song',
      source: 'crew',
    };

    playerStore.setState({
      actual: itemActual,
      reproduciendo: true,
      playerVisible: false,
      pos: 0,
      dur: track.duration || 0,
    });

    playerStore.registerControls({
      togglePlay: alternarPlayPausaCentral,
      abrirPlayer: () => {},
      cerrar: () => detenerAudioCrew(),
    });

    if (!NATIVE_AUDIO) {
      if (typeof window !== 'undefined' && typeof (window as any).Audio !== 'undefined') {
        try {
          const a = new Audio(track.audio_url);
          webAudioRef.current = a;
          a.onplay = () => {
            setReproduciendo(true);
            playerStore.setState({ reproduciendo: true });
          };
          a.onpause = () => {
            setReproduciendo(false);
            playerStore.setState({ reproduciendo: false });
          };
          a.ontimeupdate = () => {
            const p = Math.floor(a.currentTime || 0);
            const d = Math.floor(a.duration || track.duration || 0);
            setCurrentPos(p);
            setCurrentDur(d);
            playerStore.setState({ pos: p, dur: d });
          };
          a.onended = () => {
            if (repeatRef.current === 'one') {
              a.currentTime = 0;
              a.play();
              return;
            }
            if (playlistQueueRef.current) {
              const q = playlistQueueRef.current;
              let nextIdx = q.index + 1;
              if (shuffleRef.current && q.trackIds.length > 1) {
                nextIdx = Math.floor(Math.random() * q.trackIds.length);
              }
              reproducirTrackEnLista(nextIdx, q);
            } else {
              setPlayingId(null);
              setReproduciendo(false);
              playerStore.setState({ reproduciendo: false, actual: null });
            }
          };
          a.onerror = () => {
            Alert.alert('Error', 'No se pudo reproducir en el navegador');
            detenerAudioCrew();
          };
          await a.play();
          return;
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Error en reproductor web');
          detenerAudioCrew();
          return;
        }
      }
      Alert.alert('Solo disponible en Android', 'Library Crew se reproduce con el reproductor nativo en segundo plano.');
      return;
    }

    // Android Nativo
    try {
      await native.play(
        track.audio_url,
        track.title || 'Library Crew',
        track.artist || (track.uploaded_by ? `Crew · ${track.uploaded_by}` : 'Library Crew'),
        track.cover_url || ''
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo reproducir');
      detenerAudioCrew();
    }
  }

  function reproducirPlaylistCompleta(pl: CrewPlaylist) {
    const validTrackIds = pl.trackIds.filter(id => tracks.some(t => t.id === id));
    if (validTrackIds.length === 0) {
      Alert.alert('Playlist vacía', 'Esta playlist aún no tiene canciones cargadas.');
      return;
    }
    const startIndex = shuffle ? Math.floor(Math.random() * validTrackIds.length) : 0;
    const primerTrack = tracks.find(t => t.id === validTrackIds[startIndex])!;
    reproducir(primerTrack, { id: pl.id, nombre: pl.nombre, trackIds: validTrackIds, index: startIndex });
  }

  function pistaAnterior() {
    if (playlistQueueRef.current) {
      const q = playlistQueueRef.current;
      const prevIdx = Math.max(0, q.index - 1);
      reproducirTrackEnLista(prevIdx, q);
    } else if (webAudioRef.current) {
      webAudioRef.current.currentTime = 0;
    } else if (NATIVE_AUDIO) {
      native.seek(0);
    }
  }

  function pistaSiguiente() {
    if (playlistQueueRef.current) {
      const q = playlistQueueRef.current;
      const nextIdx = shuffleRef.current && q.trackIds.length > 1
        ? Math.floor(Math.random() * q.trackIds.length)
        : q.index + 1;
      reproducirTrackEnLista(nextIdx, q);
    }
  }

  function alternarRepeat() {
    const sig: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    setRepeat(sig[repeat]);
  }

  function cambiarEQ(presetKey: string) {
    setEq(presetKey);
    if (NATIVE_AUDIO) {
      native.setEq(presetKey);
    }
    setEqModalOpen(false);
  }

  function onSeekbarPress(e: any) {
    if (!currentDur || currentDur <= 0) return;
    const { locationX } = e.nativeEvent;
    // Ancho aproximado del seekbar (calculado sobre 100%)
    const pct = Math.max(0, Math.min(1, locationX / 280));
    const targetSec = Math.floor(pct * currentDur);
    if (webAudioRef.current) {
      webAudioRef.current.currentTime = targetSec;
    } else if (NATIVE_AUDIO) {
      native.seek(targetSec);
    }
    setCurrentPos(targetSec);
  }

  // ─── Subida de Archivos ─────────────────────────────────────────────────────
  async function elegirArchivo() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUFile({ uri: asset.uri, name: asset.name, size: asset.size });
      if (!uTitle) {
        const nombre = asset.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
        setUTitle(nombre);
      }
    } catch (e: any) {
      Alert.alert('Error', 'No se pudo abrir el selector de archivos: ' + (e?.message || ''));
    }
  }

  async function subirArchivo() {
    if (!uFile || !uTitle.trim()) {
      Alert.alert('Falta info', 'Seleccioná un archivo y escribí el título');
      return;
    }
    const ext = uFile.name.split('.').pop()?.toLowerCase() || 'mp3';
    const contentType = MIME_MAP[ext] || 'audio/mpeg';

    const uploaderName = userEmail || 'Crew Member';

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const resp = await api.crewUpload({
        fileUri: uFile.uri,
        filename: uFile.name,
        contentType,
        title: uTitle.trim(),
        artist: uArtist.trim(),
        crew_id: 'main',
        uploaded_by: uploaderName,
        onProgress: (pct) => setUploadProgress(pct),
      });
      setUploadProgress(100);

      if (resp?.track?.id) {
        try {
          const raw = await AsyncStorage.getItem('qp_my_uploaded_track_ids');
          const list: string[] = raw ? JSON.parse(raw) : [];
          if (!list.includes(resp.track.id)) list.push(resp.track.id);
          await AsyncStorage.setItem('qp_my_uploaded_track_ids', JSON.stringify(list));
          setMyUploadedTrackIds(new Set(list));
        } catch (_) {}
      }

      setTimeout(() => {
        setUploadOpen(false);
        setUTitle(''); setUArtist(''); setUFile(null);
        setUploading(false);
        setUploadProgress(0);
        cargar();
      }, 500);

      Alert.alert('¡Listo!', `"${uTitle}" subido a Library Crew 👥. Permanecerá oculto hasta que lo agregues a una playlist.`);
    } catch (e: any) {
      const msg = e?.message || 'Error desconocido';
      setUploadError(msg);
      Alert.alert('Error al subir', msg);
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function eliminar(track: CrewTrack) {
    const proceder = async () => {
      try {
        await api.crewDeleteTrack(track.id);
        if (playingId === track.id) detenerAudioCrew();
        setTracks(prev => prev.filter(t => t.id !== track.id));
        const actualizadas = playlists.map(pl => ({
          ...pl,
          trackIds: pl.trackIds.filter(id => id !== track.id),
        }));
        persistirPlaylists(actualizadas);
        if (Platform.OS === 'web') {
          (globalThis as any).alert?.(`"${track.title}" eliminado de Library Crew.`);
        }
      } catch (e: any) {
        const msg = e?.message || 'No se pudo eliminar';
        if (Platform.OS === 'web') (globalThis as any).alert?.(msg);
        else Alert.alert('Error', msg);
      }
    };

    if (Platform.OS === 'web') {
      const ok = (globalThis as any).confirm?.(`¿Eliminar "${track.title}" de Library Crew? Esta acción no se puede deshacer.`);
      if (ok) proceder();
      return;
    }

    Alert.alert(
      'Eliminar track',
      `¿Eliminar "${track.title}" de Library Crew? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar', style: 'destructive',
          onPress: proceder,
        },
      ]
    );
  }

  // ─── Renders ────────────────────────────────────────────────────────────────
  async function descargarTrackCrew(track: CrewTrack) {
    if (!track.audio_url) {
      Alert.alert('Error', 'No hay URL de audio disponible para este track.');
      return;
    }
    const cleanTitle = (track.title || track.id).replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
    const filename = `crew_${cleanTitle}.mp3`;
    try {
      if (Platform.OS !== 'web') {
        Alert.alert('Descargando', `Iniciando descarga de "${track.title}"…`);
      }
      await downloadFile(
        track.audio_url,
        filename,
        {
          id: track.id,
          title: track.title,
          artist: track.artist || track.uploaded_by || 'Library Crew',
          thumb: track.cover_url || undefined,
          source: 'crew',
          duration: track.duration ?? undefined,
        },
      );
      if (Platform.OS === 'web') {
        (globalThis as any).alert?.(`"${track.title}" guardado en tus descargas y en tu equipo.`);
      } else {
        Alert.alert('✅ Guardado', `"${track.title}" se guardó en tus descargas.`);
      }
    } catch (e: any) {
      const msg = 'No se pudo descargar: ' + (e?.message || String(e));
      if (Platform.OS === 'web') (globalThis as any).alert?.(msg);
      else Alert.alert('Error', msg);
    }
  }

  const playingTrack = useMemo(() => {
    return tracks.find(t => t.id === playingId) || null;
  }, [tracks, playingId]);

  const renderTrack = useCallback(({ item }: { item: CrewTrack }) => {
    const isCurrent = playingId === item.id;
    const isPlaying = isCurrent && reproduciendo;
    const soyUploader = checkSoyUploader(item);
    const estaEnPublica = trackIdsEnPlaylistsPublicas.has(item.id);
    const estaEnAlguna = trackIdsEnCualquierPlaylist.has(item.id);

    return (
      <View style={[s.trackRow, isCurrent && s.trackRowActive]}>
        <Pressable style={s.trackInfo} onPress={() => reproducir(item)}>
          <View style={[s.trackIcon, isCurrent && s.trackIconActive]}>
            <Text style={s.trackIconText}>{isPlaying ? '⏸' : (isCurrent ? '▶️' : '🎵')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.trackTitle, isCurrent && s.trackTitleActive]} numberOfLines={1}>{item.title}</Text>
            <Text style={s.trackMeta} numberOfLines={1}>
              {[item.artist, fmtTiempo(item.duration), fmtSize(item.file_size)].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
              {getRating(item.id) > 0 ? (
                <View style={{ backgroundColor: 'rgba(229,178,31,0.18)', borderWidth: 1, borderColor: 'rgba(229,178,31,0.4)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                  <Text style={{ color: theme.colors.gold, fontSize: 11, fontWeight: '800' }}>★ {getRating(item.id)}</Text>
                </View>
              ) : null}
              {estaEnPublica ? (
                <View style={s.badgePublic}>
                  <Text style={s.badgePublicText}>🌐 Compartido</Text>
                </View>
              ) : estaEnAlguna ? (
                <View style={s.badgePrivate}>
                  <Text style={s.badgePrivateText}>🔒 Privada</Text>
                </View>
              ) : (
                <View style={s.badgeHidden}>
                  <Text style={s.badgeHiddenText}>🔒 Oculto (sin playlist)</Text>
                </View>
              )}
              {item.uploaded_by ? (
                <Text style={s.trackUploader}>por {item.uploaded_by}</Text>
              ) : null}
            </View>
          </View>
        </Pressable>

        <View style={s.trackActions}>
          <Pressable
            focusable={Platform.isTV}
            style={s.actionIconBtn}
            onPress={() => setCalificandoTrack(item)}
            hitSlop={8}
            accessibilityLabel="Calificar canción"
          >
            <Text style={{ fontSize: 16, color: getRating(item.id) > 0 ? theme.colors.gold : 'rgba(255,255,255,0.3)' }}>
              {getRating(item.id) > 0 ? '★' : '☆'}
            </Text>
          </Pressable>
          <Pressable
            focusable={Platform.isTV}
            style={s.actionIconBtn}
            onPress={() => {
              setTargetTrack(item);
              setAddToPlaylistModalOpen(true);
            }}
            hitSlop={8}
            accessibilityLabel="Añadir a playlist"
          >
            <Text style={s.actionIconText}>➕📂</Text>
          </Pressable>
          <Pressable
            focusable={Platform.isTV}
            style={s.actionIconBtn}
            onPress={() => descargarTrackCrew(item)}
            hitSlop={8}
            accessibilityLabel="Descargar track"
          >
            <Text style={s.actionIconText}>⬇️</Text>
          </Pressable>
          <Pressable
            focusable={Platform.isTV}
            style={[s.actionIconBtn, s.deleteTrackBtn]}
            onPress={() => eliminar(item)}
            hitSlop={8}
            accessibilityLabel="Eliminar track"
          >
            <Text style={{ fontSize: 16 }}>🗑</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [playingId, reproduciendo, getRating, checkSoyUploader, trackIdsEnPlaylistsPublicas, trackIdsEnCualquierPlaylist]);

  const renderPlaylistCard = useCallback(({ item }: { item: CrewPlaylist }) => {
    const totalTracks = item.trackIds.filter(id => tracks.some(t => t.id === id)).length;
    const isPlayingThis = playlistPlayingInfo?.id === item.id;
    return (
      <View style={[s.playlistCard, isPlayingThis && s.playlistCardActive]}>
        <Pressable
          focusable={true}
          style={s.playlistCardHeader}
          onPress={() => setSelectedPlaylist(item)}
        >
          <View style={s.playlistCardIcon}>
            <Text style={{ fontSize: 24 }}>{item.isPublic ? '🌐' : '🔒'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={s.playlistCardTitle} numberOfLines={1}>{item.nombre}</Text>
              <View style={item.isPublic ? s.badgePublic : s.badgePrivate}>
                <Text style={item.isPublic ? s.badgePublicText : s.badgePrivateText}>
                  {item.isPublic ? 'Pública' : 'Privada'}
                </Text>
              </View>
            </View>
            <Text style={s.playlistCardSub}>
              {totalTracks} {totalTracks === 1 ? 'track' : 'tracks'} · Creada el {item.creadaEn}
            </Text>
          </View>
        </Pressable>

        <View style={s.playlistCardActions}>
          <Pressable
            focusable={true}
            style={s.playlistPlayBtn}
            onPress={() => reproducirPlaylistCompleta(item)}
          >
            <Text style={s.playlistPlayBtnText}>
              {isPlayingThis ? '⏸ Pausar' : '▶ Reproducir'}
            </Text>
          </Pressable>

          <Pressable
            focusable={true}
            style={s.playlistOpenBtn}
            onPress={() => setSelectedPlaylist(item)}
          >
            <Text style={s.playlistOpenBtnText}>Ver canciones</Text>
          </Pressable>

          <Pressable
            focusable={true}
            style={s.playlistShareBtn}
            onPress={() => {
              setPlaylistToShare(item);
              setShareModalOpen(true);
            }}
            hitSlop={8}
          >
            <Text style={{ fontSize: 16 }}>🔗</Text>
          </Pressable>

          <Pressable
            focusable={true}
            style={s.playlistDeleteBtn}
            onPress={() => eliminarPlaylist(item)}
            hitSlop={8}
          >
            <Text style={{ fontSize: 16 }}>🗑</Text>
          </Pressable>
        </View>
      </View>
    );
  }, [tracks, playlistPlayingInfo]);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>👥 Library Crew</Text>
          <Text style={s.headerSub}>Bóveda privada & stems compartidos</Text>
        </View>
        <Pressable focusable={true} style={s.refreshBtn} onPress={cargar} disabled={loading}>
          <Text style={s.refreshBtnText}>{loading ? '…' : '↻'}</Text>
        </Pressable>
      </View>

      {/* Selector de Sub-pestañas: Tracks vs Playlists */}
      <View style={s.tabSelector}>
        <Pressable
          focusable={true}
          style={[s.tabBtn, activeTab === 'tracks' && s.tabBtnActive]}
          onPress={() => { setActiveTab('tracks'); setSelectedPlaylist(null); }}
        >
          <Text style={[s.tabBtnText, activeTab === 'tracks' && s.tabBtnTextActive]}>
            🎵 Tracks ({visibleTracks.length})
          </Text>
        </Pressable>
        <Pressable
          focusable={true}
          style={[s.tabBtn, activeTab === 'playlists' && s.tabBtnActive]}
          onPress={() => setActiveTab('playlists')}
        >
          <Text style={[s.tabBtnText, activeTab === 'playlists' && s.tabBtnTextActive]}>
            📑 Playlists Crew ({playlists.length})
          </Text>
        </Pressable>
      </View>

      {/* CONTENIDO: Pestaña Tracks */}
      {activeTab === 'tracks' && (
        <>
          {/* Buscador de Tracks */}
          <View style={s.searchBarWrap}>
            <TextInput
              style={s.searchInput}
              placeholder="🔍 Buscar por título, artista o uploader..."
              placeholderTextColor={theme.colors.textDim}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <Pressable focusable={true} onPress={() => setSearchQuery('')} style={s.searchClearBtn}>
                <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>✕</Text>
              </Pressable>
            ) : null}
          </View>

          {/* Filtros de Tracks */}
          <View style={s.trackFilterRow}>
            <Pressable
              focusable={true}
              style={[s.trackFilterChip, trackFilter === 'all' && s.trackFilterChipActive]}
              onPress={() => setTrackFilter('all')}
            >
              <Text style={[s.trackFilterChipText, trackFilter === 'all' && s.trackFilterChipTextActive]}>
                👥 Visibles en Crew
              </Text>
            </Pressable>
            <Pressable
              focusable={true}
              style={[s.trackFilterChip, trackFilter === 'mine' && s.trackFilterChipActive]}
              onPress={() => setTrackFilter('mine')}
            >
              <Text style={[s.trackFilterChipText, trackFilter === 'mine' && s.trackFilterChipTextActive]}>
                👤 Mis subidas
              </Text>
            </Pressable>
            {misTracksOcultosCount > 0 ? (
              <Pressable
                focusable={true}
                style={[s.trackFilterChip, trackFilter === 'hidden' && s.trackFilterChipActive]}
                onPress={() => setTrackFilter('hidden')}
              >
                <Text style={[s.trackFilterChipText, trackFilter === 'hidden' && s.trackFilterChipTextActive]}>
                  🔒 Sin playlist ({misTracksOcultosCount})
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Banner de Ayuda: Tracks sin playlist permanecen ocultos */}
          {misTracksOcultosCount > 0 && trackFilter !== 'hidden' ? (
            <Pressable
              focusable={true}
              style={s.hintBanner}
              onPress={() => setTrackFilter('hidden')}
            >
              <Text style={s.hintBannerText}>
                🔒 Tenés {misTracksOcultosCount} {misTracksOcultosCount === 1 ? 'track oculto' : 'tracks ocultos'} sin playlist. Tocá ➕📂 para incluirlos en una playlist y compartirlos.
              </Text>
            </Pressable>
          ) : null}

          {/* Botón de Subida */}
          <View style={s.actionRow}>
            <Pressable focusable={true} style={s.uploadBtn} onPress={() => { setUploadError(null); setUploadOpen(true); }}>
              <Text style={s.uploadBtnText}>⬆️  Subir nuevo track</Text>
            </Pressable>
          </View>

          {/* Error */}
          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
              <Pressable focusable={true} onPress={cargar}><Text style={s.retryText}>Reintentar</Text></Pressable>
            </View>
          ) : null}

          {/* Lista de Canciones */}
          {loading && !tracks.length ? (
            <ActivityIndicator color={theme.colors.gold} style={{ marginTop: 40 }} />
          ) : visibleTracks.length === 0 && !loading ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyIcon}>{searchQuery ? '🔍' : '🎵'}</Text>
              <Text style={s.emptyText}>
                {searchQuery ? 'No se encontraron tracks' : trackFilter === 'hidden' ? 'No tenés tracks sin playlist' : 'No hay tracks públicos en la Crew'}
              </Text>
              <Text style={s.emptySub}>
                {searchQuery ? 'Probá con otro término de búsqueda' : 'Subí una pista y agrégala a una playlist compartida para que la Crew la escuche'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={visibleTracks}
              keyExtractor={t => t.id}
              renderItem={renderTrack}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: playingTrack ? 190 : 120 }}
              ItemSeparatorComponent={() => <View style={s.sep} />}
            />
          )}
        </>
      )}

      {/* CONTENIDO: Pestaña Playlists */}
      {activeTab === 'playlists' && (
        <>
          {selectedPlaylist ? (
            // Vista de Detalle de Playlist seleccionada
            <View style={{ flex: 1 }}>
              <View style={s.playlistDetailHeader}>
                <Pressable
                  focusable={true}
                  style={s.backBtn}
                  onPress={() => setSelectedPlaylist(null)}
                >
                  <Text style={s.backBtnText}>← Volver a Playlists</Text>
                </Pressable>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={s.playlistDetailTitle}>{selectedPlaylist.nombre}</Text>
                  <Pressable
                    focusable={true}
                    style={selectedPlaylist.isPublic ? s.badgePublic : s.badgePrivate}
                    onPress={() => alternarVisibilidadPlaylist(selectedPlaylist)}
                  >
                    <Text style={selectedPlaylist.isPublic ? s.badgePublicText : s.badgePrivateText}>
                      {selectedPlaylist.isPublic ? '🌐 Pública' : '🔒 Privada'}
                    </Text>
                  </Pressable>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <Pressable
                    focusable={true}
                    style={s.playlistPlayAllBtn}
                    onPress={() => reproducirPlaylistCompleta(selectedPlaylist)}
                  >
                    <Text style={s.playlistPlayAllBtnText}>▶ Reproducir Todo</Text>
                  </Pressable>
                  <Pressable
                    focusable={true}
                    style={s.playlistShareBtnDetail}
                    onPress={() => {
                      setPlaylistToShare(selectedPlaylist);
                      setShareModalOpen(true);
                    }}
                  >
                    <Text style={s.playlistShareBtnDetailText}>🔗 Compartir</Text>
                  </Pressable>
                </View>
              </View>

              {(() => {
                const playlistTracks = tracks.filter(t => selectedPlaylist.trackIds.includes(t.id));
                if (playlistTracks.length === 0) {
                  return (
                    <View style={s.emptyBox}>
                      <Text style={s.emptyIcon}>📂</Text>
                      <Text style={s.emptyText}>Esta playlist no tiene canciones</Text>
                      <Text style={s.emptySub}>Andá a la pestaña "Tracks" y tocá ➕📂 para agregar canciones a esta lista</Text>
                    </View>
                  );
                }
                return (
                  <FlatList
                    data={playlistTracks}
                    keyExtractor={t => t.id}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                      const isCurrent = playingId === item.id;
                      const isPlaying = isCurrent && reproduciendo;
                      return (
                        <View style={[s.trackRow, isCurrent && s.trackRowActive]}>
                          <Pressable style={s.trackInfo} onPress={() => reproducir(item)}>
                            <View style={[s.trackIcon, isCurrent && s.trackIconActive]}>
                              <Text style={s.trackIconText}>{isPlaying ? '⏸' : (isCurrent ? '▶️' : '🎵')}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[s.trackTitle, isCurrent && s.trackTitleActive]} numberOfLines={1}>{item.title}</Text>
                              <Text style={s.trackMeta} numberOfLines={1}>
                                {[item.artist, fmtTiempo(item.duration), fmtSize(item.file_size)].filter(Boolean).join(' · ')}
                                {getRating(item.id) > 0 ? ` · ★ ${getRating(item.id)}` : ''}
                              </Text>
                            </View>
                          </Pressable>
                          <View style={s.trackActions}>
                            <Pressable
                              focusable={Platform.isTV}
                              style={s.actionIconBtn}
                              onPress={() => setCalificandoTrack(item)}
                              hitSlop={8}
                              accessibilityLabel="Calificar canción"
                            >
                              <Text style={{ fontSize: 16, color: getRating(item.id) > 0 ? theme.colors.gold : 'rgba(255,255,255,0.3)' }}>
                                {getRating(item.id) > 0 ? '★' : '☆'}
                              </Text>
                            </Pressable>
                            <Pressable
                              focusable={Platform.isTV}
                              style={s.actionIconBtn}
                              onPress={() => alternarTrackEnPlaylist(selectedPlaylist, item.id)}
                              hitSlop={8}
                            >
                              <Text style={{ color: '#ffaa66', fontSize: 13, fontWeight: '700' }}>Quitar</Text>
                            </Pressable>
                            <Pressable
                              focusable={Platform.isTV}
                              style={[s.actionIconBtn, s.deleteTrackBtn]}
                              onPress={() => eliminar(item)}
                              hitSlop={8}
                              accessibilityLabel="Eliminar track"
                            >
                              <Text style={{ fontSize: 16 }}>🗑</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    }}
                    contentContainerStyle={{ paddingBottom: playingTrack ? 190 : 120 }}
                    ItemSeparatorComponent={() => <View style={s.sep} />}
                  />
                );
              })()}
            </View>
          ) : (
            // Lista de todas las Playlists de Library Crew
            <>
              <View style={s.actionRow}>
                <Pressable
                  focusable={true}
                  style={s.uploadBtn}
                  onPress={() => {
                    setTargetTrack(null);
                    setNombreNuevaPlaylist('');
                    setNuevaPlaylistPublica(false);
                    setCrearPlaylistModalOpen(true);
                  }}
                >
                  <Text style={s.uploadBtnText}>➕  Nueva Playlist Crew</Text>
                </Pressable>
                <Pressable
                  focusable={true}
                  style={s.importBtn}
                  onPress={() => {
                    setImportCodeInput('');
                    setImportModalOpen(true);
                  }}
                >
                  <Text style={s.importBtnText}>📥 Importar</Text>
                </Pressable>
              </View>

              {playlists.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyIcon}>📑</Text>
                  <Text style={s.emptyText}>No tenés playlists en Library Crew</Text>
                  <Text style={s.emptySub}>Creá listas públicas para compartir stems con la Crew o privadas para tus proyectos</Text>
                </View>
              ) : (
                <FlatList
                  data={playlists}
                  keyExtractor={p => p.id}
                  renderItem={renderPlaylistCard}
                  contentContainerStyle={{ padding: 12, paddingBottom: playingTrack ? 190 : 120 }}
                  ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ─── BARRA / PANEL DE REPRODUCCIÓN ESTILO PLAY ─────────────────────── */}
      {playingTrack ? (
        <View style={s.playerBarContainer}>
          {/* Seekbar interactivo */}
          <Pressable focusable={Platform.isTV} style={s.seekbarArea} onPress={onSeekbarPress}>
            <View style={s.seekbarTrack}>
              <View
                style={[
                  s.seekbarProgress,
                  { width: `${currentDur > 0 ? Math.min(100, (currentPos / currentDur) * 100) : 0}%` },
                ]}
              />
            </View>
          </Pressable>

          <View style={s.playerBarTop}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={s.playerBarTitle} numberOfLines={1}>{playingTrack.title}</Text>
              <Text style={s.playerBarSub} numberOfLines={1}>
                {playingTrack.artist || 'Library Crew'} · {fmtTiempo(currentPos)} / {fmtTiempo(currentDur)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable
                focusable={Platform.isTV}
                style={[s.playerBarClose, s.deleteTrackBtn]}
                onPress={() => eliminar(playingTrack)}
                hitSlop={8}
                accessibilityLabel="Eliminar track"
              >
                <Text style={{ fontSize: 16 }}>🗑</Text>
              </Pressable>
              <Pressable focusable={Platform.isTV} style={s.playerBarClose} onPress={detenerAudioCrew} hitSlop={8}>
                <Text style={{ color: theme.colors.textDim, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
          </View>

          {/* Calificación interactiva de 1 a 5 estrellas para la pista activa */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 3 }}>
            <StarRating trackId={playingTrack.id} size={22} showNumber={true} showLabel={true} />
          </View>

          {/* Fila de controles: Shuffle, Prev, Play/Pause, Next, Repeat, EQ */}
          <View style={s.playerControlsRow}>
            {/* Shuffle */}
            <Pressable
              focusable={Platform.isTV}
              style={[s.playerCtrlBtn, shuffle && s.playerCtrlBtnActive]}
              onPress={() => setShuffle(!shuffle)}
              hitSlop={8}
            >
              <Text style={[s.playerCtrlText, shuffle && { color: theme.colors.gold }]}>🔀</Text>
            </Pressable>

            {/* Anterior */}
            <Pressable focusable={Platform.isTV} style={s.playerCtrlBtn} onPress={pistaAnterior} hitSlop={8}>
              <Text style={s.playerCtrlText}>⏮</Text>
            </Pressable>

            {/* Play/Pausa central */}
            <Pressable
              focusable={Platform.isTV}
              style={s.playerPlayCentralBtn}
              onPress={alternarPlayPausaCentral}
              hitSlop={8}
            >
              <Text style={s.playerPlayCentralText}>
                {reproduciendo ? '⏸' : '▶'}
              </Text>
            </Pressable>

            {/* Siguiente */}
            <Pressable focusable={Platform.isTV} style={s.playerCtrlBtn} onPress={pistaSiguiente} hitSlop={8}>
              <Text style={s.playerCtrlText}>⏭</Text>
            </Pressable>

            {/* Repeat */}
            <Pressable
              focusable={Platform.isTV}
              style={[s.playerCtrlBtn, repeat !== 'off' && s.playerCtrlBtnActive]}
              onPress={alternarRepeat}
              hitSlop={8}
            >
              <Text style={[s.playerCtrlText, repeat !== 'off' && { color: theme.colors.gold }]}>
                {repeat === 'one' ? '🔂' : '🔁'}
              </Text>
            </Pressable>

            {/* Ecualizador */}
            <Pressable
              focusable={Platform.isTV}
              style={[s.playerCtrlBtn, eq !== 'flat' && s.playerCtrlBtnActive]}
              onPress={() => setEqModalOpen(true)}
              hitSlop={8}
            >
              <Text style={[s.playerCtrlText, eq !== 'flat' && { color: theme.colors.gold }]}>🎚️</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Modal: Añadir Track a Playlist Crew */}
      <Modal visible={addToPlaylistModalOpen} transparent animationType="slide" onRequestClose={() => setAddToPlaylistModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>➕ Añadir a Playlist Crew</Text>
            {targetTrack ? (
              <Text style={{ color: theme.colors.gold, fontSize: 14, marginBottom: 16 }}>
                🎵 {targetTrack.title}
              </Text>
            ) : null}

            <Pressable
              focusable={true}
              style={s.createInModalBtn}
              onPress={() => {
                setNombreNuevaPlaylist('');
                setNuevaPlaylistPublica(false);
                setCrearPlaylistModalOpen(true);
              }}
            >
              <Text style={s.createInModalBtnText}>✨ + Crear Nueva Playlist Crew</Text>
            </Pressable>

            {playlists.length === 0 ? (
              <Text style={{ color: theme.colors.textDim, marginVertical: 14, textAlign: 'center' }}>
                Aún no creaste ninguna playlist en Library Crew.
              </Text>
            ) : (
              <FlatList
                data={playlists}
                keyExtractor={p => p.id}
                style={{ maxHeight: 240 }}
                renderItem={({ item }) => {
                  const yaEsta = targetTrack ? item.trackIds.includes(targetTrack.id) : false;
                  return (
                    <Pressable
                      focusable={true}
                      style={[s.playlistOptionRow, yaEsta && s.playlistOptionRowActive]}
                      onPress={() => {
                        if (targetTrack) alternarTrackEnPlaylist(item, targetTrack.id);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={[s.playlistOptionTitle, yaEsta && { color: theme.colors.gold }]}>
                            {item.nombre}
                          </Text>
                          <Text style={{ fontSize: 11, color: item.isPublic ? '#81c784' : '#ffb74d' }}>
                            {item.isPublic ? '🌐 Pública' : '🔒 Privada'}
                          </Text>
                        </View>
                        <Text style={s.playlistOptionSub}>
                          {item.trackIds.length} canciones
                        </Text>
                      </View>
                      <Text style={{ fontSize: 16, color: yaEsta ? theme.colors.gold : theme.colors.textDim }}>
                        {yaEsta ? '✓ Incluida' : '＋ Agregar'}
                      </Text>
                    </Pressable>
                  );
                }}
              />
            )}

            <Pressable focusable={true} style={s.modalCloseBtn} onPress={() => setAddToPlaylistModalOpen(false)}>
              <Text style={s.modalCloseBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal: Crear Nueva Playlist Crew */}
      <Modal visible={crearPlaylistModalOpen} transparent animationType="fade" onRequestClose={() => setCrearPlaylistModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>📑 Nueva Playlist de Library Crew</Text>
            <TextInput
              style={s.modalInput}
              placeholder="Nombre de la playlist (ej. Stems Batería, Mezclas)"
              placeholderTextColor={theme.colors.textDim}
              value={nombreNuevaPlaylist}
              onChangeText={setNombreNuevaPlaylist}
              autoFocus
            />

            {/* Selector de Privacidad */}
            <Pressable
              focusable={true}
              style={[s.privacyToggleRow, nuevaPlaylistPublica && s.privacyToggleRowActive]}
              onPress={() => setNuevaPlaylistPublica(!nuevaPlaylistPublica)}
            >
              <Text style={{ fontSize: 20 }}>{nuevaPlaylistPublica ? '🌐' : '🔒'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.privacyToggleTitle}>
                  {nuevaPlaylistPublica ? 'Compartida con la Crew (Pública)' : 'Solo visible para mí (Privada)'}
                </Text>
                <Text style={s.privacyToggleSub}>
                  {nuevaPlaylistPublica
                    ? 'Los miembros de la Crew podrán ver y escuchar sus canciones.'
                    : 'Las canciones permanecerán ocultas a los demás.'}
                </Text>
              </View>
            </Pressable>

            <View style={s.modalBtns}>
              <Pressable focusable={true} style={s.cancelBtn} onPress={() => setCrearPlaylistModalOpen(false)}>
                <Text style={s.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                focusable={true}
                style={[s.confirmBtn, !nombreNuevaPlaylist.trim() && s.btnDisabled]}
                onPress={() => crearNuevaPlaylist()}
                disabled={!nombreNuevaPlaylist.trim()}
              >
                <Text style={s.confirmBtnText}>Crear</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Compartir Playlist */}
      <Modal visible={shareModalOpen} transparent animationType="fade" onRequestClose={() => setShareModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>🔗 Compartir Playlist Crew</Text>
            {playlistToShare ? (
              <>
                <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                  {playlistToShare.nombre}
                </Text>
                <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 14 }}>
                  {playlistToShare.isPublic ? '🌐 Lista pública para la Crew' : '🔒 Actualmente es privada'}
                </Text>

                <View style={s.shareCodeCard}>
                  <Text style={s.shareCodeLabel}>Código de Importación:</Text>
                  <Text style={s.shareCodeValue}>{playlistToShare.shareCode || playlistToShare.id}</Text>
                  <Text style={s.shareCodeHint}>
                    Cualquier miembro de la crew puede ingresar este código en "Importar" para tener la lista de inmediato.
                  </Text>
                </View>

                <Pressable
                  focusable={true}
                  style={[s.privacyToggleRow, playlistToShare.isPublic && s.privacyToggleRowActive, { marginBottom: 14 }]}
                  onPress={() => alternarVisibilidadPlaylist(playlistToShare)}
                >
                  <Text style={{ fontSize: 20 }}>{playlistToShare.isPublic ? '🌐' : '🔒'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.privacyToggleTitle}>
                      {playlistToShare.isPublic ? 'Compartida con la Crew' : 'Privada'}
                    </Text>
                    <Text style={s.privacyToggleSub}>
                      Tocá para alternar visibilidad pública/privada.
                    </Text>
                  </View>
                </Pressable>
              </>
            ) : null}

            <Pressable focusable={true} style={s.modalCloseBtn} onPress={() => setShareModalOpen(false)}>
              <Text style={s.modalCloseBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal: Importar Playlist con Código */}
      <Modal visible={importModalOpen} transparent animationType="fade" onRequestClose={() => setImportModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>📥 Importar Playlist Crew</Text>
            <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 14 }}>
              Ingresá el código de la playlist que te compartió otro miembro de la crew (ej. CREW-89F2):
            </Text>
            <TextInput
              style={s.modalInput}
              placeholder="Código (ej. CREW-89F2)"
              placeholderTextColor={theme.colors.textDim}
              value={importCodeInput}
              onChangeText={setImportCodeInput}
              autoCapitalize="characters"
              autoFocus
            />
            <View style={s.modalBtns}>
              <Pressable focusable={true} style={s.cancelBtn} onPress={() => setImportModalOpen(false)}>
                <Text style={s.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable focusable={true} style={s.confirmBtn} onPress={importarPlaylistPorCodigo}>
                <Text style={s.confirmBtnText}>Importar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Ecualizador */}
      <Modal visible={eqModalOpen} transparent animationType="fade" onRequestClose={() => setEqModalOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>🎚️ Ecualizador</Text>
            <View style={s.eqGrid}>
              {Object.keys(EQ_PRESETS).map(key => {
                const item = EQ_PRESETS[key];
                const active = eq === key;
                return (
                  <Pressable
                    key={key}
                    focusable={true}
                    style={[s.eqPresetBtn, active && s.eqPresetBtnActive]}
                    onPress={() => cambiarEQ(key)}
                  >
                    <Text style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</Text>
                    <Text style={[s.eqPresetText, active && s.eqPresetTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable focusable={true} style={s.modalCloseBtn} onPress={() => setEqModalOpen(false)}>
              <Text style={s.modalCloseBtnText}>Listo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Modal: Subida de Track */}
      <Modal visible={uploadOpen} transparent animationType="slide" onRequestClose={() => !uploading && setUploadOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>⬆️ Subir a Library Crew</Text>

            <Pressable focusable={true} style={s.filePicker} onPress={elegirArchivo} disabled={uploading}>
              <Text style={s.filePickerText}>
                {uFile ? `📂 ${uFile.name}` : '📂 Elegir archivo de audio…'}
              </Text>
              {uFile?.size ? <Text style={s.fileSizeText}>{fmtSize(uFile.size)}</Text> : null}
            </Pressable>

            <TextInput
              style={s.modalInput}
              placeholder="Título *"
              placeholderTextColor={theme.colors.textDim}
              value={uTitle}
              onChangeText={setUTitle}
              editable={!uploading}
            />
            <TextInput
              style={s.modalInput}
              placeholder="Artista (opcional)"
              placeholderTextColor={theme.colors.textDim}
              value={uArtist}
              onChangeText={setUArtist}
              editable={!uploading}
            />

            <Text style={{ color: theme.colors.textDim, fontSize: 12, marginBottom: 12 }}>
              🔒 El archivo subirá oculto/privado hasta que lo agregues a una playlist compartida.
            </Text>

            {uploadError ? (
              <View style={{ backgroundColor: '#3a1515', padding: 8, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#ff4444' }}>
                <Text style={{ color: '#ff8888', fontSize: 12 }}>⚠️ {uploadError}</Text>
              </View>
            ) : null}

            {/* Progress bar */}
            {uploading ? (
              <View style={s.progressWrap}>
                <View style={[s.progressBar, { width: `${uploadProgress}%` as any }]} />
                <Text style={s.progressText}>{uploadProgress < 100 ? `Subiendo… ${uploadProgress}%` : '¡Listo!'}</Text>
              </View>
            ) : null}

            <View style={s.modalBtns}>
              <Pressable focusable={true} style={s.cancelBtn} onPress={() => setUploadOpen(false)} disabled={uploading}>
                <Text style={s.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable focusable={true} style={[s.confirmBtn, (!uFile || !uTitle || uploading) && s.btnDisabled]} onPress={subirArchivo} disabled={!uFile || !uTitle || uploading}>
                {uploading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={s.confirmBtnText}>Subir</Text>
                }
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal de Calificación de Canción en Library Crew ── */}
      {calificandoTrack ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setCalificandoTrack(null)}>
          <Pressable
            style={s.modalOverlay}
            onPress={() => setCalificandoTrack(null)}
          >
            <Pressable style={[s.modalBox, { alignItems: 'center', padding: 22 }]} onPress={() => {}}>
              <Text style={{ color: theme.colors.gold, fontSize: 13, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5 }}>
                CALIFICAR EN LIBRARY CREW
              </Text>
              <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 16 }} numberOfLines={2}>
                {calificandoTrack.title}
              </Text>
              <StarRating
                trackId={calificandoTrack.id}
                size={34}
                showNumber={true}
                onRate={(stars) => {
                  setRating(calificandoTrack.id, stars);
                }}
              />
              <Pressable
                style={[s.confirmBtn, { marginTop: 22, minWidth: 120, alignItems: 'center' }]}
                onPress={() => setCalificandoTrack(null)}
              >
                <Text style={s.confirmBtnText}>Listo</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: theme.colors.gold },
  headerSub: { fontSize: 13, color: theme.colors.textDim, marginTop: 2 },
  refreshBtn: {
    backgroundColor: theme.colors.bg,
    borderRadius: 8,
    padding: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  refreshBtnText: { color: theme.colors.text, fontSize: 18 },

  // Selector de tabs
  tabSelector: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(229, 178, 31, 0.15)',
    borderColor: theme.colors.gold,
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textDim,
  },
  tabBtnTextActive: {
    color: theme.colors.gold,
    fontWeight: '700',
  },

  // Buscador
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: theme.colors.text,
    fontSize: 14,
  },
  searchClearBtn: {
    padding: 6,
  },

  // Filtros de Tracks
  trackFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginTop: 8,
    gap: 8,
  },
  trackFilterChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  trackFilterChipActive: {
    backgroundColor: 'rgba(229, 178, 31, 0.15)',
    borderColor: theme.colors.gold,
  },
  trackFilterChipText: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  trackFilterChipTextActive: {
    color: theme.colors.gold,
    fontWeight: '700',
  },

  hintBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    backgroundColor: 'rgba(255, 183, 77, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  hintBannerText: {
    color: '#ffb74d',
    fontSize: 12,
    fontWeight: '600',
  },

  actionRow: { flexDirection: 'row', padding: 12, gap: 10 },
  uploadBtn: { flex: 1, backgroundColor: theme.colors.gold, borderRadius: 10, padding: 12, alignItems: 'center' },
  uploadBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  importBtn: {
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  importBtnText: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 13,
  },

  errorBox: { margin: 16, padding: 14, backgroundColor: '#3a1515', borderRadius: 10, borderWidth: 1, borderColor: '#ff4444' },
  errorText: { color: '#ff8888', marginBottom: 8 },
  retryText: { color: theme.colors.gold, fontWeight: '700' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyText: { fontSize: 17, fontWeight: '700', color: theme.colors.text, marginBottom: 6 },
  emptySub: { fontSize: 13, color: theme.colors.textDim, textAlign: 'center' },

  // Track row
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  trackRowActive: { backgroundColor: 'rgba(229, 178, 31, 0.08)' },
  trackInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  trackIconActive: { borderColor: theme.colors.gold, backgroundColor: 'rgba(229, 178, 31, 0.2)' },
  trackIconText: { fontSize: 18 },
  trackTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  trackTitleActive: { color: theme.colors.gold },
  trackMeta: { fontSize: 12, color: theme.colors.textDim, marginTop: 2 },
  trackUploader: { fontSize: 11, color: theme.colors.gold + '99' },
  trackActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionIconBtn: { padding: 8 },
  deleteTrackBtn: {
    backgroundColor: 'rgba(255, 68, 68, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.35)',
  },
  actionIconText: { fontSize: 16 },
  sep: { height: 1, backgroundColor: theme.colors.border, marginHorizontal: 16 },

  // Badges
  badgePublic: {
    backgroundColor: 'rgba(129, 199, 132, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#81c784',
  },
  badgePublicText: { color: '#81c784', fontSize: 10, fontWeight: '700' },
  badgePrivate: {
    backgroundColor: 'rgba(255, 183, 77, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  badgePrivateText: { color: '#ffb74d', fontSize: 10, fontWeight: '700' },
  badgeHidden: {
    backgroundColor: 'rgba(239, 83, 80, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ef5350',
  },
  badgeHiddenText: { color: '#ef5350', fontSize: 10, fontWeight: '700' },

  // Tarjetas de Playlists Crew
  playlistCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  playlistCardActive: {
    borderColor: theme.colors.gold,
  },
  playlistCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  playlistCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  playlistCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
  },
  playlistCardSub: {
    fontSize: 12,
    color: theme.colors.textDim,
    marginTop: 2,
  },
  playlistCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playlistPlayBtn: {
    flex: 1,
    backgroundColor: theme.colors.gold,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  playlistPlayBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  playlistOpenBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  playlistOpenBtnText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  playlistShareBtn: {
    padding: 8,
  },
  playlistDeleteBtn: {
    padding: 8,
  },

  // Detalle de Playlist seleccionada
  playlistDetailHeader: {
    padding: 14,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: 8,
  },
  backBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  backBtnText: {
    color: theme.colors.gold,
    fontSize: 13,
    fontWeight: '600',
  },
  playlistDetailTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
  },
  playlistPlayAllBtn: {
    flex: 1,
    backgroundColor: theme.colors.gold,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  playlistPlayAllBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  playlistShareBtnDetail: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
  },
  playlistShareBtnDetailText: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '600',
  },

  // BARRA DE REPRODUCCIÓN FLOTANTE / TOOLBAR ESTILO PLAY
  playerBarContainer: {
    position: 'absolute',
    bottom: 58,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(20, 24, 28, 0.98)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(229, 178, 31, 0.4)',
    padding: 10,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
  },
  seekbarArea: {
    height: 14,
    justifyContent: 'center',
    marginBottom: 4,
  },
  seekbarTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  seekbarProgress: {
    height: '100%',
    backgroundColor: theme.colors.gold,
    borderRadius: 2,
  },
  playerBarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  playerBarTitle: {
    color: theme.colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  playerBarSub: {
    color: theme.colors.gold,
    fontSize: 11,
    marginTop: 2,
  },
  playerBarClose: {
    padding: 4,
  },
  playerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 4,
  },
  playerCtrlBtn: {
    padding: 8,
    borderRadius: 8,
  },
  playerCtrlBtnActive: {
    backgroundColor: 'rgba(229, 178, 31, 0.2)',
  },
  playerCtrlText: {
    fontSize: 18,
    color: theme.colors.text,
  },
  playerPlayCentralBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerPlayCentralText: {
    color: '#000',
    fontSize: 20,
    fontWeight: '800',
  },

  // Modales
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: theme.colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 19, fontWeight: '700', color: theme.colors.gold, marginBottom: 14 },
  filePicker: { backgroundColor: theme.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed', padding: 16, alignItems: 'center', marginBottom: 14 },
  filePickerText: { color: theme.colors.text, fontSize: 15 },
  fileSizeText: { color: theme.colors.textDim, fontSize: 12, marginTop: 4 },
  modalInput: { backgroundColor: theme.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, padding: 12, color: theme.colors.text, fontSize: 15, marginBottom: 12 },
  progressWrap: { backgroundColor: theme.colors.bg, borderRadius: 8, height: 28, overflow: 'hidden', marginBottom: 14, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: theme.colors.gold, borderRadius: 8 },
  progressText: { textAlign: 'center', color: '#000', fontWeight: '700', fontSize: 13, zIndex: 1 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  cancelBtnText: { color: theme.colors.textDim, fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: theme.colors.gold, alignItems: 'center' },
  confirmBtnText: { color: '#000', fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },

  privacyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.bg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 14,
  },
  privacyToggleRowActive: {
    borderColor: '#81c784',
    backgroundColor: 'rgba(129, 199, 132, 0.1)',
  },
  privacyToggleTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  privacyToggleSub: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },

  shareCodeCard: {
    backgroundColor: theme.colors.bg,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.gold,
    marginBottom: 14,
  },
  shareCodeLabel: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginBottom: 4,
  },
  shareCodeValue: {
    color: theme.colors.gold,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 6,
  },
  shareCodeHint: {
    color: theme.colors.textDim,
    fontSize: 11,
    textAlign: 'center',
  },

  createInModalBtn: {
    backgroundColor: 'rgba(229, 178, 31, 0.15)',
    borderWidth: 1,
    borderColor: theme.colors.gold,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  createInModalBtnText: {
    color: theme.colors.gold,
    fontWeight: '700',
    fontSize: 13,
  },
  playlistOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.bg,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  playlistOptionRowActive: {
    borderColor: theme.colors.gold,
    backgroundColor: 'rgba(229, 178, 31, 0.08)',
  },
  playlistOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  playlistOptionSub: {
    fontSize: 11,
    color: theme.colors.textDim,
    marginTop: 1,
  },
  modalCloseBtn: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalCloseBtnText: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 14,
  },

  // Ecualizador
  eqGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  eqPresetBtn: {
    width: '30%',
    backgroundColor: theme.colors.bg,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  eqPresetBtnActive: {
    borderColor: theme.colors.gold,
    backgroundColor: 'rgba(229, 178, 31, 0.15)',
  },
  eqPresetText: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  eqPresetTextActive: {
    color: theme.colors.gold,
    fontWeight: '700',
  },
});
