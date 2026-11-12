import AsyncStorage from '@react-native-async-storage/async-storage';

const PROGRESS_KEY = 'qp_playback_progress_v1';
const MAX_SAVED_TRACKS = 150;

export type TrackProgress = {
  pos: number;
  dur: number;
  at: number; // timestamp en milisegundos
  title?: string;
};

type ProgressMap = Record<string, TrackProgress>;

let memoryCache: ProgressMap | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function cargarCache(): Promise<ProgressMap> {
  if (memoryCache !== null) return memoryCache;
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    memoryCache = raw ? JSON.parse(raw) : {};
  } catch (_) {
    memoryCache = {};
  }
  return memoryCache!;
}

function flushCache(): void {
  if (!memoryCache) return;
  try {
    AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(memoryCache)).catch(() => {});
  } catch (_) {}
}

/**
 * Guarda el progreso de reproducción de un tema.
 * Se descartan posiciones triviales (< 8s) o si el tema ya terminó prácticamente (a menos de 15s del final).
 */
export function guardarProgreso(id: string, pos: number, dur: number, title?: string): void {
  if (!id) return;
  const cleanId = id.trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
  if (!cleanId) return;

  // No guardar si apenas empezó o si ya terminó
  if (pos < 8 || (dur > 0 && pos >= dur - 15)) {
    // Si ya casi terminó o está al inicio, limpiar el progreso guardado
    if (memoryCache && memoryCache[cleanId]) {
      delete memoryCache[cleanId];
      if (!saveTimer) saveTimer = setTimeout(flushCache, 1500);
    }
    return;
  }

  if (!memoryCache) memoryCache = {};

  memoryCache[cleanId] = {
    pos: Math.round(pos * 10) / 10,
    dur: Math.round(dur),
    at: Date.now(),
    title,
  };

  // Limitar tamaño del mapa para no sobrecargar almacenamiento
  const keys = Object.keys(memoryCache);
  if (keys.length > MAX_SAVED_TRACKS) {
    // Eliminar los más antiguos
    keys.sort((a, b) => (memoryCache![a]?.at || 0) - (memoryCache![b]?.at || 0));
    for (let i = 0; i < keys.length - MAX_SAVED_TRACKS; i++) {
      delete memoryCache[keys[i]];
    }
  }

  // Guardar en disco con debounce
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushCache, 2000);
}

/**
 * Guarda inmediatamente sin debounce (útil al pausar o cerrar app)
 */
export function guardarProgresoInmediato(id: string, pos: number, dur: number, title?: string): void {
  guardarProgreso(id, pos, dur, title);
  flushCache();
}

/**
 * Obtiene la última posición guardada para un video si existe y es válida.
 */
export async function obtenerProgreso(id: string): Promise<number | null> {
  if (!id) return null;
  const cleanId = id.trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
  if (!cleanId) return null;

  const map = await cargarCache();
  const entry = map[cleanId];
  if (!entry) return null;

  // Válido si avanzó al menos 8 segundos y no está en los últimos 15s
  if (entry.pos >= 8 && (!entry.dur || entry.pos < entry.dur - 15)) {
    return entry.pos;
  }
  return null;
}

/**
 * Borra el progreso guardado de un video específico (ej: si el usuario elige 'Empezar desde 0')
 */
export async function borrarProgreso(id: string): Promise<void> {
  if (!id) return;
  const cleanId = id.trim().replace(/^.*[?&]v=/, '').split('&')[0].split('?')[0];
  const map = await cargarCache();
  if (map[cleanId]) {
    delete map[cleanId];
    flushCache();
  }
}
