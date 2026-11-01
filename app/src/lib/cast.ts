import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Chromecast / Google Cast.
 *
 * Solo Android: `react-native-google-cast` trae código nativo que no existe en
 * web, así que el módulo se carga con `require` perezoso y únicamente cuando
 * `Platform.OS === 'android'`. En web / iOS todo queda desactivado sin romper
 * el bundle.
 *
 * Se transmite media (audio o video) al receptor por defecto de Google
 * (Default Media Receiver, CC1AD845). No es espejo de pantalla: el TV abre la
 * URL del stream servida por el backend de YouThink.
 */

export const CAST_ANDROID = Platform.OS === 'android';

type CastLib = any;

let libCache: CastLib | null = null;
let libFailed = false;

function getCast(): CastLib | null {
  if (!CAST_ANDROID || libFailed) return null;
  if (libCache) return libCache;
  try {
    // require perezoso: evita evaluar el paquete en web (requireNativeComponent no existe ahí).
    libCache = require('react-native-google-cast');
  } catch (e) {
    libFailed = true;
    libCache = null;
  }
  return libCache;
}

export type TvMedia = {
  id: string;
  title: string;
  channel?: string;
  thumb?: string;
  /** URL pública (http/https) que el Chromecast pueda descargar. */
  url: string;
  /** MIME del stream, por ejemplo `audio/mp4` o `video/mp4`. */
  contentType?: string;
  /** Duración en segundos (0/undefined = desconocida). */
  duration?: number;
  /** Segundo desde el que arrancar. */
  startTime?: number;
};

function mensajeError(e: any): string {
  const raw = String(e?.message || e || '');
  if (/play services/i.test(raw)) return 'Google Play Services no está disponible en este dispositivo.';
  if (/no device|noDevices/i.test(raw)) return 'No se encontró ningún Chromecast en la red.';
  return raw || 'No se pudo conectar con el Chromecast.';
}

async function obtenerSesion(): Promise<any | null> {
  const l = getCast();
  if (!l) return null;
  try {
    return await l.CastContext.getSessionManager().getCurrentCastSession();
  } catch (e) {
    return null;
  }
}

/** Abre el diálogo nativo para elegir el dispositivo Chromecast. */
export async function mostrarDialogoCast(): Promise<{ ok: boolean; error?: string }> {
  const l = getCast();
  if (!l) return { ok: false, error: 'Chromecast solo está disponible en la app de Android.' };
  try {
    try {
      const ps = await l.CastContext.getPlayServicesState();
      if (ps && ps !== 'success') {
        return { ok: false, error: 'Google Play Services no está disponible en este dispositivo.' };
      }
    } catch (e) {}
    const shown = await l.CastContext.showCastDialog();
    if (!shown) return { ok: false, error: 'No se encontró ningún Chromecast en la red.' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: mensajeError(e) };
  }
}

/** Carga (o recarga) un tema en el Chromecast conectado. */
export async function cargarEnTv(media: TvMedia): Promise<{ ok: boolean; error?: string }> {
  const l = getCast();
  if (!l || !media?.url) return { ok: false, error: 'Chromecast no disponible.' };
  try {
    const sesion = await obtenerSesion();
    if (!sesion?.client) return { ok: false, error: 'No hay ningún Chromecast conectado.' };
    const esAudio = (media.contentType || '').startsWith('audio');
    await sesion.client.loadMedia({
      autoplay: true,
      startTime: Math.max(0, media.startTime || 0),
      mediaInfo: {
        contentUrl: media.url,
        contentType: media.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
        streamType: 'buffered',
        streamDuration: media.duration && media.duration > 0 ? media.duration : undefined,
        metadata: esAudio
          ? {
              type: 'musicTrack',
              title: media.title,
              artist: media.channel || 'YouThink',
              albumName: 'YouThink',
              images: media.thumb ? [{ url: media.thumb }] : undefined,
            }
          : {
              type: 'movie',
              title: media.title,
              subtitle: media.channel || 'YouThink',
              images: media.thumb ? [{ url: media.thumb }] : undefined,
            },
      },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: mensajeError(e) };
  }
}

export async function pausarTv(): Promise<void> {
  try {
    const s = await obtenerSesion();
    await s?.client?.pause();
  } catch (e) {}
}

export async function reanudarTv(): Promise<void> {
  try {
    const s = await obtenerSesion();
    await s?.client?.play();
  } catch (e) {}
}

export async function buscarEnTv(posicion: number): Promise<void> {
  try {
    const s = await obtenerSesion();
    await s?.client?.seek({ position: Math.max(0, posicion || 0) });
  } catch (e) {}
}

/** Corta la transmisión y desconecta el dispositivo. */
export async function detenerTv(): Promise<void> {
  const l = getCast();
  if (!l) return;
  try {
    await l.CastContext.getSessionManager().endCurrentSession(true);
  } catch (e) {}
}

export type UseCast = ReturnType<typeof useCast>;

/**
 * Estado reactivo de Chromecast + acciones. Se usa desde la pantalla del
 * reproductor para mostrar el botón, el nombre del TV y para sincronizar el
 * tema que suena.
 */
export function useCast() {
  const [disponible, setDisponible] = useState(CAST_ANDROID);
  const [conectado, setConectado] = useState(false);
  const [nombre, setNombre] = useState<string | null>(null);
  const [sonando, setSonando] = useState(false);
  const [posTv, setPosTv] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const subsRef = useRef<Array<{ remove: () => void }>>([]);
  const clienteRef = useRef<any>(null);
  const finCbRef = useRef<(() => void) | null>(null);
  const conectadoRef = useRef(false);

  useEffect(() => {
    conectadoRef.current = conectado;
  }, [conectado]);

  useEffect(() => {
    if (!CAST_ANDROID) {
      setDisponible(false);
      return;
    }
    const l = getCast();
    if (!l) {
      setDisponible(false);
      return;
    }
    let vivo = true;

    const limpiarCliente = () => {
      subsRef.current.forEach((s) => {
        try { s.remove(); } catch (e) {}
      });
      subsRef.current = [];
      clienteRef.current = null;
    };

    const engancharCliente = (sesion: any) => {
      if (!sesion?.client) return;
      if (clienteRef.current === sesion.client) return;
      limpiarCliente();
      clienteRef.current = sesion.client;
      try {
        subsRef.current.push(
          sesion.client.onMediaStatusUpdated((st: any) => {
            if (!vivo) return;
            const estado = st?.playerState;
            setSonando(estado === 'playing' || estado === 'buffering');
            if (isFinite(st?.streamPosition) && st.streamPosition >= 0) setPosTv(st.streamPosition);
          })
        );
        subsRef.current.push(
          sesion.client.onMediaPlaybackEnded(() => {
            if (!vivo) return;
            setSonando(false);
            try { finCbRef.current?.(); } catch (e) {}
          })
        );
      } catch (e) {}
    };

    const refrescar = async () => {
      try {
        const sesion = await obtenerSesion();
        if (!vivo) return;
        if (!sesion) {
          limpiarCliente();
          setConectado(false);
          setNombre(null);
          setSonando(false);
          return;
        }
        let n: string | null = null;
        try {
          const dev = await sesion.getCastDevice();
          n = dev?.friendlyName || null;
        } catch (e) {}
        if (!vivo) return;
        setConectado(true);
        setNombre(n || 'Chromecast');
        engancharCliente(sesion);
      } catch (e) {}
    };

    try {
      const ctx = l.CastContext;
      const sm = ctx.getSessionManager();
      subsRef.current.push(ctx.onCastStateChanged((estado: string) => {
        if (!vivo) return;
        if (estado === 'connected') refrescar();
        else if (estado === 'notConnected' || estado === 'noDevicesAvailable') {
          limpiarCliente();
          setConectado(false);
          setNombre(null);
          setSonando(false);
        }
      }));
      subsRef.current.push(sm.onSessionStarted(() => refrescar()));
      subsRef.current.push(sm.onSessionResumed(() => refrescar()));
      subsRef.current.push(sm.onSessionEnded(() => {
        if (!vivo) return;
        limpiarCliente();
        setConectado(false);
        setNombre(null);
        setSonando(false);
      }));
    } catch (e) {
      setDisponible(false);
    }

    refrescar();

    return () => {
      vivo = false;
      limpiarCliente();
      subsRef.current.forEach((s) => {
        try { s.remove(); } catch (e) {}
      });
      subsRef.current = [];
    };
  }, []);

  async function conectar() {
    setError(null);
    setOcupado(true);
    try {
      const res = await mostrarDialogoCast();
      if (!res.ok) setError(res.error || 'No se pudo abrir Chromecast.');
      return res;
    } finally {
      setOcupado(false);
    }
  }

  async function transmitir(media: TvMedia) {
    setError(null);
    try {
      const res = await cargarEnTv(media);
      if (!res.ok) setError(res.error || 'No se pudo transmitir.');
      return res;
    } finally {
    }
  }

  async function alternarTv(quiereSonar: boolean) {
    if (quiereSonar) await reanudarTv();
    else await pausarTv();
    setSonando(quiereSonar);
  }

  async function moverTv(posicion: number) {
    await buscarEnTv(posicion);
    setPosTv(Math.max(0, posicion || 0));
  }

  async function cortar() {
    await detenerTv();
    setConectado(false);
    setNombre(null);
    setSonando(false);
    setPosTv(0);
  }

  /** Registra el callback que se ejecuta cuando el TV termina el tema. */
  function alTerminarEnTv(cb: (() => void) | null) {
    finCbRef.current = cb;
    return () => {
      if (finCbRef.current === cb) finCbRef.current = null;
    };
  }

  return {
    disponible,
    conectado,
    nombre,
    sonando,
    posTv,
    error,
    ocupado,
    conectar,
    transmitir,
    alternarTv,
    moverTv,
    cortar,
    alTerminarEnTv,
  };
}
