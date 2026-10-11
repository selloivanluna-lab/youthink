import AsyncStorage from '@react-native-async-storage/async-storage';

export type LyricLine = {
  time: number; // segundos
  text: string;
  translation?: string;
};

export type LyricsData = {
  id: string; // track o video id
  title: string;
  artist: string;
  synced: boolean;
  lines: LyricLine[];
  plain?: string;
};

// Limpia títulos típicos de YouTube ("Artista - Canción (Official Video)")
export function parseYouTubeTitle(rawTitle: string): { title: string; artist: string } {
  let clean = rawTitle
    .replace(/\s*[\(\[](?:official|video|music\s*video|audio|lyrics?|visualizer|clip|hd|4k|remastered|live).*?[\)\]]/gi, '')
    .replace(/\b(?:official|video|audio|lyrics?|hd|4k)\b/gi, '')
    .trim();

  // Dividir por guión si tiene formato "Artista - Canción" o "Artista – Canción"
  const splitDash = clean.split(/\s*[-–—:]\s*/);
  if (splitDash.length >= 2) {
    const artist = splitDash[0].trim();
    const title = splitDash.slice(1).join(' ').trim();
    return { title, artist };
  }

  return { title: clean, artist: '' };
}

// Parsea el formato LRC de LRCLIB: "[01:23.45] Verso cantado"
export function parseLrc(lrcText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const rawLines = lrcText.split(/\r?\n/);
  const re = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

  for (const raw of rawLines) {
    const match = raw.match(re);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      if (text) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

// Busca letra en LRCLIB (servicio gratuito y público de letras LRC)
export async function buscarLyrics(videoId: string, videoTitle: string, channel = '', durationSec?: number): Promise<LyricsData | null> {
  const cacheKey = `qp_lyrics_${videoId}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {}

  const { title: cleanTitle, artist: parsedArtist } = parseYouTubeTitle(videoTitle);
  const artist = parsedArtist || channel.replace(/\s*(?:vevo|official|channel|music)$/gi, '').trim();

  try {
    let result: any = null;

    // 1. Intento exacto si tenemos título y artista
    if (cleanTitle && artist) {
      const params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: artist,
      });
      if (durationSec && durationSec > 0) {
        params.set('duration', Math.round(durationSec).toString());
      }
      const r = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
      if (r.ok) {
        result = await r.json();
      }
    }

    // 2. Fallback a búsqueda general por query
    if (!result || (!result.syncedLyrics && !result.plainLyrics)) {
      const query = `${cleanTitle} ${artist}`.trim() || videoTitle;
      const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length > 0) {
          // Preferir uno que tenga letra sincronizada
          result = list.find((it: any) => it.syncedLyrics) || list[0];
        }
      }
    }

    if (!result) return null;

    let lines: LyricLine[] = [];
    let synced = false;

    if (result.syncedLyrics) {
      lines = parseLrc(result.syncedLyrics);
      synced = lines.length > 0;
    }

    if (!synced && result.plainLyrics) {
      lines = result.plainLyrics
        .split(/\r?\n/)
        .map((t: string) => t.trim())
        .filter(Boolean)
        .map((text: string, idx: number) => ({ time: idx * 5, text })); // tiempos estimados si es plano
    }

    if (lines.length === 0) return null;

    const data: LyricsData = {
      id: videoId,
      title: result.trackName || cleanTitle,
      artist: result.artistName || artist,
      synced,
      lines,
      plain: result.plainLyrics || undefined,
    };

    AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
    return data;
  } catch (e) {
    console.error('Error buscando lyrics:', e);
    return null;
  }
}

// Detecta par de idiomas válido para MyMemory (no soporta 'auto')
export function detectarLangPair(textSample: string): string {
  if (/\b(você|não|para|com|está|uma|muito|tudo|mais)\b/i.test(textSample)) return 'pt|es';
  if (/\b(sono|perché|tutto|anche|questo|niente|sempre)\b/i.test(textSample)) return 'it|es';
  if (/\b(c'est|vous|avec|pour|dans|tout|mais|comme)\b/i.test(textSample)) return 'fr|es';
  if (/\b(und|nicht|ich|sie|das|ist|wir)\b/i.test(textSample)) return 'de|es';
  return 'en|es';
}

// Traduce los versos al español (con cache en AsyncStorage)
export async function traducirLyrics(videoId: string, lines: LyricLine[]): Promise<LyricLine[]> {
  const cacheKey = `qp_lyrics_tr_${videoId}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const trMap: Record<number, string> = JSON.parse(cached);
      return lines.map((l, i) => ({ ...l, translation: trMap[i] || l.text }));
    }
  } catch {}

  // Detectar idioma de origen válido para MyMemory a partir de una muestra de la letra
  const muestra = lines.slice(0, 10).map((l) => l.text).join(' ');
  const langpair = detectarLangPair(muestra);

  // Para traducir versos sin saturar la red, hacemos traducción por lotes pequeños (chunks)
  const chunkSize = 5;
  const translatedLines: LyricLine[] = [...lines];
  const trMap: Record<number, string> = {};

  for (let i = 0; i < lines.length; i += chunkSize) {
    const batch = lines.slice(i, i + chunkSize);
    await Promise.all(
      batch.map(async (line, offset) => {
        const idx = i + offset;
        const textoLimpio = line.text.trim();
        if (!textoLimpio) {
          trMap[idx] = '';
          return;
        }
        try {
          const enc = encodeURIComponent(textoLimpio);
          const r = await fetch(`https://api.mymemory.translated.net/get?q=${enc}&langpair=${langpair}`);
          if (r.ok) {
            const data = await r.json();
            const status = data?.responseStatus;
            const trans = data?.responseData?.translatedText;
            if (status === 200 && trans && typeof trans === 'string') {
              // Descartar si MyMemory devolvió una advertencia o error en texto
              const esError = trans.includes('INVALID SOURCE LANGUAGE') || trans.includes('MYMEMORY WARNING');
              if (!esError) {
                const cleanTrans = trans
                  .replace(/<[^>]*>/g, '')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .trim();
                trMap[idx] = cleanTrans;
                translatedLines[idx].translation = cleanTrans;
                return;
              }
            }
          }
        } catch {}
        trMap[idx] = line.text;
      })
    );
  }

  AsyncStorage.setItem(cacheKey, JSON.stringify(trMap)).catch(() => {});
  return translatedLines;
}
