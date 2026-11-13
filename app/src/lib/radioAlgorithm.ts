import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, YtResult } from './api';

export type GeneroAfines = {
  id: string;
  nombre: string;
  keywords: string[];
  artistas: string[];
  terminosBusqueda: string[];
};

export const TAXONOMIA_GENEROS: GeneroAfines[] = [
  {
    id: 'rock-nacional',
    nombre: 'Rock Nacional',
    keywords: ['rock', 'nacional', 'argentino', 'spinetta', 'charly', 'fito', 'cerati', 'soda', 'calamaro', 'divididos', 'redondos', 'patricio rey', 'babasonicos', 'ciro', 'los piojos', 'las pastillas', 'guasones', 'la renga', 'ataque 77', 'intoxicados', 'callejeros'],
    artistas: ['Charly García', 'Luis Alberto Spinetta', 'Fito Páez', 'Gustavo Cerati', 'Soda Stereo', 'Andrés Calamaro', 'Divididos', 'Babasónicos', 'Ciro y Los Persas', 'Las Pastillas del Abuelo', 'Guasones', 'La Renga', 'Los Piojos', 'Los Auténticos Decadentes', 'Los Fabulosos Cadillacs'],
    terminosBusqueda: ['rock nacional argentino exitos', 'rock argentino clasicos', 'rock nacional mix'],
  },
  {
    id: 'trap-urbano',
    nombre: 'Trap & Urbano',
    keywords: ['trap', 'urbano', 'rap', 'hip hop', 'freestyle', 'duki', 'bizarrap', 'bzp', 'milo j', 'wos', 'ysy a', 'khea', 'trueno', 'tiago pzk', 'lit killah', 'nicki nicole', 'cazzu', 'neo pistea', 'acru', 'dilom'],
    artistas: ['Duki', 'Bizarrap', 'Milo J', 'Wos', 'YSY A', 'Trueno', 'Tiago PZK', 'Khea', 'Nicki Nicole', 'Cazzu', 'Lit Killah', 'Neo Pistea'],
    terminosBusqueda: ['trap argentino exitos', 'musica urbana argentina', 'bizarrap session mix'],
  },
  {
    id: 'cumbia-cuarteto',
    nombre: 'Cumbia & Cuarteto',
    keywords: ['cumbia', 'cuarteto', 'tropical', 'konga', 'damas gratis', 'ke personajes', 'rodrigo', 'walter olmos', 'ulises bueno', 'pablito lescano', 'amar azul', 'rafaga', 'los palmeras', 'angela leiva', 'karina', 'la barra', 'q lokura', 'luck ra'],
    artistas: ['La K\'onga', 'Ke Personajes', 'Damas Gratis', 'Rodrigo', 'Ulises Bueno', 'Los Palmeras', 'Q\' Lokura', 'Luck Ra', 'Amar Azul', 'Karina', 'Ráfaga'],
    terminosBusqueda: ['cumbia santafesina exitos', 'cuarteto cordobes enganchados', 'cumbia villera clasicos'],
  },
  {
    id: 'pop-latino',
    nombre: 'Pop Latino',
    keywords: ['pop', 'latino', 'tini', 'maria becerra', 'emilia', 'lali', 'morat', 'sebastian yatra', 'camilo', 'aitana', 'reik', 'cnco', 'chayanne', 'ricky martin', 'shakira'],
    artistas: ['TINI', 'Maria Becerra', 'Emilia', 'Lali', 'Morat', 'Sebastián Yatra', 'Camilo', 'Aitana', 'Shakira'],
    terminosBusqueda: ['pop latino exitos', 'pop en espanol canciones', 'pop latino mix'],
  },
  {
    id: 'rkt-turreo',
    nombre: 'RKT & Turreo',
    keywords: ['rkt', 'turreo', 'cachengue', 'callejero fino', 'l-gante', 'la joaqui', 'alan gomez', 'dj tao', 'kaleb di masi', 'ecko', 'perreo'],
    artistas: ['Callejero Fino', 'L-Gante', 'La Joaqui', 'DJ Tao', 'Alan Gomez', 'Kaleb Di Masi', 'Salastkbron'],
    terminosBusqueda: ['rkt turreo mix', 'cachengue remix', 'dj tao turreo session'],
  },
  {
    id: 'reggaeton',
    nombre: 'Reggaeton & Urbano Latino',
    keywords: ['reggaeton', 'daddy yankee', 'bad bunny', 'don omar', 'wisin', 'yandel', 'feid', 'rauw alejandro', 'j balvin', 'maluma', 'ozuna', 'anuel', 'myke towers', 'arcangel', 'plan b'],
    artistas: ['Bad Bunny', 'Feid', 'Daddy Yankee', 'Rauw Alejandro', 'Don Omar', 'Wisin & Yandel', 'Myke Towers', 'J Balvin', 'Ozuna', 'Arcángel'],
    terminosBusqueda: ['reggaeton clasico mix', 'reggaeton exitos', 'perreo mix'],
  },
  {
    id: 'rock-clasico',
    nombre: 'Rock & Pop Clásico',
    keywords: ['classic rock', 'queen', 'beatles', 'michael jackson', 'pink floyd', 'led zeppelin', 'the rolling stones', 'ac/dc', 'guns n roses', 'bowie', 'elton john', 'bon jovi', 'aerosmith', 'police', 'u2', 'dire straits'],
    artistas: ['Queen', 'The Beatles', 'Michael Jackson', 'Pink Floyd', 'Led Zeppelin', 'The Rolling Stones', 'AC/DC', 'Guns N\' Roses', 'David Bowie', 'Elton John'],
    terminosBusqueda: ['classic rock 70s 80s 90s', 'best rock classics songs', 'rock legends mix'],
  },
  {
    id: 'indie-alternativo',
    nombre: 'Indie & Alternativo',
    keywords: ['indie', 'alternativo', 'bandalos chinos', 'conociendo rusia', 'usted senalemelo', 'el kuelgue', 'los espiritus', 'zoe gotusso', 'ca7riel', 'paco amoroso', 'marilina bertoldi', 'silvestre y la naranja', 'eruca sativa'],
    artistas: ['Bandalos Chinos', 'Conociendo Rusia', 'Usted Señalemelo', 'El Kuelgue', 'Zoe Gotusso', 'Silvestre y La Naranja', 'Ca7riel', 'Los Espíritus'],
    terminosBusqueda: ['indie argentino canciones', 'indie en espanol mix', 'rock alternativo latino'],
  },
  {
    id: 'electronica-house',
    nombre: 'Electrónica & Dance',
    keywords: ['electronica', 'edm', 'house', 'techno', 'daft punk', 'david guetta', 'avicii', 'calvin harris', 'tiesto', 'martin garrix', 'swedish house mafia', 'alok', 'deadmau5'],
    artistas: ['Daft Punk', 'Avicii', 'Calvin Harris', 'David Guetta', 'Tiësto', 'Martin Garrix', 'Swedish House Mafia'],
    terminosBusqueda: ['electronic dance music mix', 'house music hits', 'edm festival mix'],
  },
  {
    id: 'lofi-chill',
    nombre: 'Lo-Fi & Relax',
    keywords: ['lofi', 'chill', 'study', 'relax', 'beats', 'ambient', 'instrumental', 'sleep', 'piano chill'],
    artistas: ['Lofi Girl', 'ChilledCow', 'Kudasaibeats', 'Idealism', 'Jinsang'],
    terminosBusqueda: ['lofi hip hop beats to relax study to', 'chill study beats lofi', 'ambient chill music'],
  },
];

/**
 * Limpia el título quitando coletillas como (Video Oficial), [Remastered], etc.
 */
export function limpiarTituloCancion(titulo: string): string {
  if (!titulo) return '';
  return titulo
    .replace(/\[(official|video|audio|remastered|lyrics?|hd|4k|en vivo|live).*?\]/gi, '')
    .replace(/\((official|video|audio|remastered|lyrics?|hd|4k|en vivo|live).*?\)/gi, '')
    .replace(/official\s*(music)?\s*(video|audio)/gi, '')
    .replace(/video\s*oficial/gi, '')
    .replace(/audio\s*oficial/gi, '')
    .replace(/letra\s*\/?\s*lyrics?/gi, '')
    .replace(/\|.*$/g, '')
    .trim();
}

/**
 * Detecta artistas colaboradores o invitados en el título
 */
export function extraerArtistasYColaboradores(titulo: string, canal: string): string[] {
  const artistas = new Set<string>();
  const canalLimpio = canal.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
  if (canalLimpio) artistas.add(canalLimpio);

  // Buscar separadores "Artista - Tema"
  const partesGuion = titulo.split(/\s*[-–—]\s*/);
  if (partesGuion.length >= 2) {
    const posibleArtista = partesGuion[0].trim();
    if (posibleArtista && posibleArtista.length < 40 && !posibleArtista.toLowerCase().includes('video')) {
      artistas.add(posibleArtista);
    }
  }

  // Buscar colaboraciones: feat., ft., with, con, x, &
  const matchFeats = titulo.match(/(?:feat\.?|ft\.?|featuring|with|con|x)\s+([^([\]]+)/i);
  if (matchFeats && matchFeats[1]) {
    const rawFeat = matchFeats[1]
      .replace(/[([].*$/, '')
      .split(/[,&/]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 35);
    rawFeat.forEach((f) => artistas.add(f));
  }

  return Array.from(artistas);
}

/**
 * Deduce el género afín a partir de los metadatos de la canción
 */
export function deducirGenero(titulo: string, canal: string): GeneroAfines | null {
  const corpus = `${titulo} ${canal}`.toLowerCase();
  for (const g of TAXONOMIA_GENEROS) {
    for (const kw of g.keywords) {
      if (corpus.includes(kw.toLowerCase())) {
        return g;
      }
    }
  }
  return null;
}

/**
 * Algoritmo de intercalado (Interleaving round-robin) para evitar canciones
 * consecutivas del mismo artista y garantizar una experiencia de radio dinámica.
 */
export function balancearPorArtista(tracks: YtResult[], maxPorArtista = 3): YtResult[] {
  const grupos = new Map<string, YtResult[]>();
  for (const t of tracks) {
    const ch = (t.channel || 'Desconocido').trim().toLowerCase();
    if (!grupos.has(ch)) grupos.set(ch, []);
    const arr = grupos.get(ch)!;
    if (arr.length < maxPorArtista) {
      arr.push(t);
    }
  }

  const resultado: YtResult[] = [];
  let quedan = true;
  while (quedan) {
    quedan = false;
    for (const [_, arr] of grupos.entries()) {
      if (arr.length > 0) {
        resultado.push(arr.shift()!);
        quedan = true;
      }
    }
  }
  return resultado;
}

/**
 * Sintoniza una estación de radio diversa para una canción semilla
 */
export async function sintonizarRadioInteligente(
  seed: YtResult,
  likedArtists: Set<string> = new Set(),
  dislikedIds: Set<string> = new Set(),
  dislikedArtists: Set<string> = new Set()
): Promise<{ tracks: YtResult[]; nombreEstacion: string }> {
  const canalLimpio = (seed.channel || '').replace(/ - Topic$/i, '').trim();
  const tituloLimpio = limpiarTituloCancion(seed.title);
  const artistas = extraerArtistasYColaboradores(seed.title, seed.channel || '');
  const genero = deducirGenero(seed.title, seed.channel || '');

  const nombreEstacion = canalLimpio
    ? `📻 Radio ${canalLimpio}`
    : `📻 Radio ${tituloLimpio.slice(0, 24)}`;

  const idsVistos = new Set<string>([seed.id]);
  let pool: YtResult[] = [];

  // 1. Vector principal: radio nativa de YouTube para este ID
  try {
    const resRadio = await api.radio(seed.id, 25);
    if (resRadio.ok && Array.isArray(resRadio.tracks)) {
      pool.push(...resRadio.tracks);
    }
  } catch (_) {}

  // 2. Vector artista(s) y colaboradores: buscar temas populares de los artistas detectados
  const artistasParaBuscar = artistas.slice(0, 3);
  const busquedasArtistas = await Promise.allSettled(
    artistasParaBuscar.map((art) => api.search(`${art} canciones populares`, 10, 'songs'))
  );
  for (const r of busquedasArtistas) {
    if (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.results)) {
      pool.push(...r.value.results);
    }
  }

  // 3. Vector género y estilo afín: expandir hacia artistas del mismo universo musical
  if (genero) {
    // Tomar 2 artistas del género que no sean el artista actual
    const afines = genero.artistas
      .filter((a) => !artistas.some((art) => art.toLowerCase() === a.toLowerCase()))
      .slice(0, 2);

    const busquedasAfines = await Promise.allSettled([
      ...afines.map((af) => api.search(`${af} mix`, 8, 'songs')),
      api.search(genero.terminosBusqueda[0] || `${genero.nombre} exitos`, 10, 'songs'),
    ]);
    for (const r of busquedasAfines) {
      if (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.results)) {
        pool.push(...r.value.results);
      }
    }
  } else {
    // Si no reconoció género, buscar mix general del tema y del canal
    try {
      const qAlt = canalLimpio ? `${canalLimpio} mix` : `${tituloLimpio} mix`;
      const resAlt = await api.search(qAlt, 15, 'songs');
      if (resAlt.ok && Array.isArray(resAlt.results)) {
        pool.push(...resAlt.results);
      }
    } catch (_) {}
  }

  // 4. Filtrar y deduplicar
  const filtrados = pool.filter((t) => {
    if (!t?.id || idsVistos.has(t.id)) return false;
    if (dislikedIds.has(t.id)) return false;
    if (t.channel && dislikedArtists.has(t.channel)) return false;
    idsVistos.add(t.id);
    return true;
  });

  // 5. Balancear y ordenar: dar prioridad suave a artistas con like y mezclar con interleaving
  const conLike = filtrados.filter((t) => t.channel && likedArtists.has(t.channel));
  const sinLike = filtrados.filter((t) => !t.channel || !likedArtists.has(t.channel));

  // Interleaving de sinLike para que no salgan 5 seguidos del mismo artista
  const balanceados = balancearPorArtista(sinLike, 2);

  // Armar la lista final asegurando formato song
  const finales = [...conLike, ...balanceados].map((t) => ({ ...t, kind: 'song' as const }));

  return {
    tracks: finales,
    nombreEstacion,
  };
}

/**
 * Extensión dinámica de la cola de radio con diversidad de estilos
 */
export async function extenderRadioDiverso(
  currentTrack: YtResult,
  colaActual: YtResult[],
  likedArtists: Set<string> = new Set(),
  dislikedIds: Set<string> = new Set(),
  dislikedArtists: Set<string> = new Set()
): Promise<YtResult[]> {
  const idsExistentes = new Set(colaActual.map((t) => t.id));
  let candidatos: YtResult[] = [];

  // Semilla actual
  try {
    const res = await api.radio(currentTrack.id, 15);
    if (res.ok && Array.isArray(res.tracks)) candidatos.push(...res.tracks);
  } catch (_) {}

  // Semilla aleatoria de la historia de la cola para no derivar en un único subgénero
  if (colaActual.length >= 4) {
    const randIdx = Math.floor(Math.random() * Math.max(1, colaActual.length - 2));
    const semillaAleatoria = colaActual[randIdx];
    if (semillaAleatoria?.id && semillaAleatoria.id !== currentTrack.id) {
      try {
        const res2 = await api.radio(semillaAleatoria.id, 10);
        if (res2.ok && Array.isArray(res2.tracks)) candidatos.push(...res2.tracks);
      } catch (_) {}
    }
  }

  // Búsqueda por artista o género afín si la radio devolvió pocos
  if (candidatos.length < 5) {
    const genero = deducirGenero(currentTrack.title, currentTrack.channel || '');
    const q = genero
      ? genero.terminosBusqueda[Math.floor(Math.random() * genero.terminosBusqueda.length)]
      : (currentTrack.channel ? `${currentTrack.channel} mix` : `${currentTrack.title} mix`);
    try {
      const busq = await api.search(q, 15, 'songs');
      if (busq.ok && Array.isArray(busq.results)) candidatos.push(...busq.results);
    } catch (_) {}
  }

  // Filtrar
  const filtrados = candidatos.filter((t) =>
    t?.id &&
    !idsExistentes.has(t.id) &&
    !dislikedIds.has(t.id) &&
    !(t.channel && dislikedArtists.has(t.channel))
  );

  const balanceados = balancearPorArtista(filtrados, 2);
  return balanceados.map((t) => ({ ...t, kind: 'song' as const }));
}
