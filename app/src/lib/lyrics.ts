import AsyncStorage from '@react-native-async-storage/async-storage';
import { GEMINI_KEY } from '../config';

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

// Busca letra en múltiples fuentes: LRCLIB (sincronizada), Lyrist/Textyl y Gemini AI como respaldo infalible
export async function buscarLyrics(videoId: string, videoTitle: string, channel = '', durationSec?: number): Promise<LyricsData | null> {
  const cacheKey = `qp_lyrics_v3_${videoId}`;
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

    // 1. Intento exacto en LRCLIB si tenemos título y artista
    if (cleanTitle && artist) {
      try {
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
      } catch (_) {}
    }

    // 2. Fallback a búsqueda general en LRCLIB por query
    if (!result || (!result.syncedLyrics && !result.plainLyrics)) {
      try {
        const query = `${cleanTitle} ${artist}`.trim() || videoTitle;
        const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`);
        if (r.ok) {
          const list = await r.json();
          if (Array.isArray(list) && list.length > 0) {
            const match = list.find((it: any) => {
              const tMatch = it.trackName && cleanTitle.toLowerCase().includes(it.trackName.toLowerCase());
              const aMatch = artist && it.artistName && it.artistName.toLowerCase().includes(artist.toLowerCase());
              return (tMatch || aMatch) && it.syncedLyrics;
            }) || list.find((it: any) => it.syncedLyrics) || list[0];
            result = match;
          }
        }
      } catch (_) {}
    }

    let lines: LyricLine[] = [];
    let synced = false;

    if (result?.syncedLyrics) {
      lines = parseLrc(result.syncedLyrics);
      synced = lines.length > 0;
    }

    if (!synced && result?.plainLyrics) {
      lines = result.plainLyrics
        .split(/\r?\n/)
        .map((t: string) => t.trim())
        .filter(Boolean)
        .map((text: string, idx: number) => ({ time: idx * 5, text }));
    }

    // 3. Fallback a Lyrist API si LRCLIB no encontró nada
    if (lines.length === 0) {
      try {
        const lyristQuery = encodeURIComponent(cleanTitle || videoTitle);
        const lyristArtist = encodeURIComponent(artist || '');
        const url = artist ? `https://lyrist.vercel.app/api/${lyristQuery}/${lyristArtist}` : `https://lyrist.vercel.app/api/${lyristQuery}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const lyristData = await resp.json();
          if (lyristData?.lyrics) {
            lines = lyristData.lyrics
              .split(/\r?\n/)
              .map((t: string) => t.trim())
              .filter(Boolean)
              .map((text: string, idx: number) => ({ time: idx * 4.5, text }));
            result = {
              trackName: lyristData.title || cleanTitle,
              artistName: lyristData.artist || artist,
              plainLyrics: lyristData.lyrics,
            };
          }
        }
      } catch (_) {}
    }

    // 4. Fallback final infalible: Gemini AI (busca la letra de la canción y la formatea)
    if (lines.length === 0 && GEMINI_KEY) {
      try {
        const searchTerms = `${cleanTitle} ${artist}`.trim() || videoTitle;
        const prompt = `Devuelve la letra COMPLETA de la canción "${searchTerms}".
Instrucciones estrictas:
- Devuelve ÚNICAMENTE la letra original verso por verso, sin títulos de sección (no pongas [Coro], [Verso], etc.).
- Sin introducciones, sin explicaciones, sin markdown.
- Si no conoces la canción, devuelve exactamente: NO_ENCONTRADA`;

        const geminiModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        let geminiText = '';

        for (const model of geminiModels) {
          try {
            const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
            const gRes = await fetch(gUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            });
            if (gRes.ok) {
              const gJson = await gRes.json();
              const cand = gJson.candidates?.[0]?.content?.parts?.[0]?.text;
              if (cand && !cand.includes('NO_ENCONTRADA')) {
                geminiText = cand.trim();
                break;
              }
            }
          } catch (_) {}
        }

        if (geminiText) {
          const cleanLines = geminiText
            .split(/\r?\n/)
            .map((t) => t.trim())
            .filter((t) => t.length > 0 && !t.startsWith('[') && !t.startsWith('('));

          const dur = durationSec && durationSec > 20 ? durationSec : cleanLines.length * 4;
          const step = cleanLines.length > 0 ? (dur * 0.85) / cleanLines.length : 4;

          lines = cleanLines.map((text, idx) => ({
            time: Math.round((idx * step + 4) * 10) / 10,
            text,
          }));
          synced = true;
          result = { trackName: cleanTitle, artistName: artist, plainLyrics: geminiText };
        }
      } catch (ge) {
        console.warn('[Gemini Lyrics Fallback]', ge);
      }
    }

    if (lines.length === 0) return null;

    const data: LyricsData = {
      id: videoId,
      title: result?.trackName || cleanTitle,
      artist: result?.artistName || artist,
      synced,
      lines,
      plain: result?.plainLyrics || undefined,
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

// Traduce los versos al español usando Gemini Flash (alta fidelidad y contexto musical) con fallback a MyMemory
export async function traducirLyrics(videoId: string, lines: LyricLine[]): Promise<LyricLine[]> {
  // Usamos _v3 para invalidar traducciones erróneas previas guardadas en el storage
  const cacheKey = `qp_lyrics_tr_v3_${videoId}`;
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const trMap: Record<number, string> = JSON.parse(cached);
      return lines.map((l, i) => ({ ...l, translation: trMap[i] || l.text }));
    }
  } catch {}

  // Intento primario con Gemini (traducción poética, musical y coherente en bloque)
  if (GEMINI_KEY && lines.length > 0) {
    try {
      const batchSize = 35;
      const trMap: Record<number, string> = {};
      const translatedLines: LyricLine[] = [...lines];

      for (let i = 0; i < lines.length; i += batchSize) {
        const slice = lines.slice(i, i + batchSize);
        const originalLines = slice.map((l) => l.text);
        const prompt = `Eres un traductor experto en lírica musical y poesía. Traduce esta lista de versos de una canción al español rioplatense/latino de manera poética, emocional y fluida, manteniendo el sentido musical verso por verso.
Devuelve EXACTAMENTE un array JSON de strings con las traducciones en el mismo orden y con la misma cantidad de elementos (${originalLines.length}). Sin explicaciones ni etiquetas markdown.
Versos:
${JSON.stringify(originalLines)}`;

        // Modelos disponibles en orden de prioridad y resiliencia ante alta demanda
        const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
        let success = false;

        for (const model of models) {
          try {
            const r = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json',
                  },
                }),
              }
            );

            if (r.ok) {
              const json = await r.json();
              const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
              const cleanJson = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(cleanJson);
              if (Array.isArray(parsed) && parsed.length === originalLines.length) {
                parsed.forEach((trStr, offset) => {
                  const idx = i + offset;
                  const val = String(trStr || slice[offset].text).trim();
                  trMap[idx] = val;
                  translatedLines[idx].translation = val;
                });
                success = true;
                break;
              }
            }
          } catch {}
        }

        if (!success) {
          // Si falló con Gemini para este bloque, rellenamos con original
          slice.forEach((sLine, offset) => {
            trMap[i + offset] = sLine.text;
          });
        }
      }

      const tieneTraducciones = Object.values(trMap).some((v, idx) => v && v !== lines[idx]?.text);
      if (tieneTraducciones) {
        AsyncStorage.setItem(cacheKey, JSON.stringify(trMap)).catch(() => {});
        return translatedLines;
      }
    } catch (e) {
      console.warn('Error en traducción con Gemini:', e);
    }
  }

  // Fallback secundario: MyMemory con descarte de malas traducciones conocidas de corpus
  const muestra = lines.slice(0, 10).map((l) => l.text).join(' ');
  const langpair = detectarLangPair(muestra);
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
              const esError =
                trans.includes('INVALID SOURCE LANGUAGE') ||
                trans.includes('MYMEMORY WARNING') ||
                // Filtro contra entradas de canciones corrompidas en corpus públicos (ej. "LO QUE HE HECHO")
                /lo que he hecho/i.test(trans);
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
