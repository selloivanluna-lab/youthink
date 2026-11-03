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

/**
 * Espera a que la sesión tenga `client` (RemoteMediaClient) no-nulo.
 *
 * En react-native-google-cast el client siempre existe una vez que la sesión
 * está activa, así que este check termina rápido. El delay real que necesita
 * el receiver del TV para cargar lo maneja el llamador con un timeout explícito.
 */
async function esperarCliente(ms = 8000): Promise<any | null> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const sesion = await obtenerSesion();
    if (sesion?.client) return sesion;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
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

/**
 * ¿El receptor arrancó de verdad?
 *
 * `loadMedia` puede responder OK y el TV descartar la orden igual: el receptor
 * todavía está levantando su app cuando llega el pedido. Mirar el estado real
 * del medio es la única forma de saberlo, porque el error no vuelve por la API.
 */
async function medioArranco(
  sesion: any,
  ms: number,
  confirmar?: () => Promise<boolean>,
): Promise<boolean> {
  const limite = Date.now() + ms;
  let sinEstado = 0;
  while (Date.now() < limite) {
    try {
      const st = await sesion.client.getMediaStatus();
      const ps = String(st?.playerState || '');
      if (ps === 'playing' || ps === 'buffering' || ps === 'paused') return true;
      if (isFinite(st?.streamPosition) && st.streamPosition > 0) return true;
      if (!st) sinEstado++;
    } catch (e) {
      sinEstado++;
    }
    // Si el TV le pidió datos al teléfono (hits > 0), arrancó
    if (confirmar) {
      try {
        if (await confirmar()) return true;
      } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

/** Carga (o recarga) un tema en el Chromecast conectado. */
export async function cargarEnTv(
  media: TvMedia,
  reResolve?: () => Promise<{ url: string; contentType: string } | null>,
  confirmar?: () => Promise<boolean>,
): Promise<{ ok: boolean; error?: string }> {
  const l = getCast();
  if (!l || !media?.url) return { ok: false, error: 'Chromecast no disponible.' };
  try {
    const sesion = await esperarCliente(12000);
    if (!sesion?.client) return { ok: false, error: 'No hay ningún Chromecast conectado.' };

    let actual: TvMedia = media;
    let ultimoError: any = null;
    // Hasta 35s: en el primer connect, el receptor del TV puede tardar de 5 a 20 s en
    // cargar su app web (logo azul). Reintentamos de forma continua hasta que acepte.
    const limiteTotal = Date.now() + 35000;

    while (Date.now() < limiteTotal) {
      const s = await obtenerSesion();
      if (!s?.client) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      const esAudio = (actual.contentType || '').startsWith('audio');
      const mediaInfo = {
        contentUrl: actual.url,
        contentType: actual.contentType || (esAudio ? 'audio/mp4' : 'video/mp4'),
        streamType: 'buffered',
        streamDuration: actual.duration && actual.duration > 0 ? actual.duration : undefined,
        metadata: esAudio
          ? {
              type: 'musicTrack',
              title: actual.title,
              artist: actual.channel || 'YouThink',
              albumName: 'YouThink',
              images: actual.thumb ? [{ url: actual.thumb }] : undefined,
            }
          : {
              type: 'movie',
              title: actual.title,
              subtitle: actual.channel || 'YouThink',
              images: actual.thumb ? [{ url: actual.thumb }] : undefined,
            },
      };

      try {
        await s.client.loadMedia({
          autoplay: true,
          startTime: Math.max(0, actual.startTime || 0),
          mediaInfo,
        });

        // loadMedia no lanzó error: la orden fue recibida por el receptor.
        // Verificamos si empezó a reproducir o si el TV le pidió datos al teléfono.
        const arranco = await medioArranco(s, 4500, confirmar);
        if (arranco) return { ok: true };
      } catch (e) {
        // El receptor del TV todavía está cargando (logo azul/spinner)
        ultimoError = e;
      }

      // Si aún no arrancó, esperar 1.5s antes del próximo intento
      await new Promise((r) => setTimeout(r, 1500));

      if (reResolve) {
        try {
          const nuevo = await reResolve();
          if (nuevo?.url) actual = { ...actual, url: nuevo.url, contentType: nuevo.contentType };
        } catch (_) {}
      }
    }

    return {
      ok: false,
      error: ultimoError
        ? mensajeError(ultimoError)
        : 'El televisor no inició la reproducción. Probá de nuevo con "🔎 Probar TV".',
    };
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
  /**
   * `true` cuando la sesión se restauró (TV ya tenía la app receptora corriendo).
   * `false` cuando es un connect nuevo (TV tiene que cargar la app receptora desde cero).
   * Esto le dice a Buscar.tsx si debe esperar ~6 s antes de mandar loadMedia.
   */
  const [esReconexion, setEsReconexion] = useState(false);
  const esReconexionRef = useRef(false);

  const subsRef = useRef<Array<{ remove: () => void }>>([]);
  const clienteRef = useRef<any>(null);
  const finCbRef = useRef<(() => void) | null>(null);
  const conectadoRef = useRef(false);

  useEffect(() => {
    conectadoRef.current = conectado;
  }, [conectado]);

  useEffect(() => {
    esReconexionRef.current = esReconexion;
  }, [esReconexion]);

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

    const refrescar = async (reconexion: boolean) => {
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
        setEsReconexion(reconexion);
        esReconexionRef.current = reconexion;
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
        if (estado === 'connected') refrescar(false); // no sabemos si es reconexión aquí; onSessionStarted/Resumed es más preciso
        else if (estado === 'notConnected' || estado === 'noDevicesAvailable') {
          limpiarCliente();
          setConectado(false);
          setNombre(null);
          setSonando(false);
        }
      }));
      subsRef.current.push(sm.onSessionStarted(() => refrescar(false)));  // TV cargando la app receptora desde 0
      subsRef.current.push(sm.onSessionResumed(() => refrescar(true)));   // TV ya tenía el receiver corriendo
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

    refrescar(true); // al arrancar la app puede ya haber una sesión activa (reconexión automática)

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

  async function transmitir(
    media: TvMedia,
    reResolve?: () => Promise<{ url: string; contentType: string } | null>,
    confirmar?: () => Promise<boolean>,
  ) {
    setError(null);
    try {
      const res = await cargarEnTv(media, reResolve, confirmar);
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
    esReconexion,
    conectar,
    transmitir,
    alternarTv,
    moverTv,
    cortar,
    alTerminarEnTv,
  };
}
