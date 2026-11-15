import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, YtResult } from './api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type GeneroAfines = {
  id: string;
  nombre: string;
  keywords: string[];
  artistas: string[];
  terminosBusqueda: string[];
  /** Géneros afines para expansión cuando la cola se agota */
  generosAfines?: string[];
};

// ---------------------------------------------------------------------------
// Taxonomía expandida de géneros
// ---------------------------------------------------------------------------

export const TAXONOMIA_GENEROS: GeneroAfines[] = [
  {
    id: 'rock-nacional',
    nombre: 'Rock Nacional',
    keywords: [
      'rock', 'nacional', 'argentino', 'spinetta', 'charly', 'fito', 'cerati',
      'soda', 'calamaro', 'divididos', 'redondos', 'patricio rey', 'babasonicos',
      'ciro', 'los piojos', 'las pastillas', 'guasones', 'la renga', 'ataque 77',
      'intoxicados', 'callejeros', 'almendra', 'sui generis', 'serú girán',
      'man ray', 'bersuit', 'flema', 'dos minutos',
    ],
    artistas: [
      'Charly García', 'Luis Alberto Spinetta', 'Fito Páez', 'Gustavo Cerati',
      'Soda Stereo', 'Andrés Calamaro', 'Divididos', 'Babasónicos',
      'Ciro y Los Persas', 'Las Pastillas del Abuelo', 'Guasones', 'La Renga',
      'Los Piojos', 'Los Auténticos Decadentes', 'Los Fabulosos Cadillacs',
      'Bersuit Vergarabat', 'Dos Minutos', 'Intoxicados', 'Almendra', 'Serú Girán',
    ],
    terminosBusqueda: [
      'rock nacional argentino exitos',
      'rock argentino clasicos',
      'rock nacional mix',
      'rock argentino 90s enganchados',
      'rock nacional clásicos 80s',
      'rock argentino mejores canciones',
      'artistas similares a Charly García',
      'artistas similares a Soda Stereo',
      'rock argentino en vivo grandes exitos',
    ],
    generosAfines: ['indie-alternativo', 'rock-clasico'],
  },
  {
    id: 'trap-urbano',
    nombre: 'Trap & Urbano',
    keywords: [
      'trap', 'urbano', 'rap', 'hip hop', 'freestyle', 'duki', 'bizarrap',
      'bzp', 'milo j', 'wos', 'ysy a', 'khea', 'trueno', 'tiago pzk',
      'lit killah', 'nicki nicole', 'cazzu', 'neo pistea', 'acru', 'dilom',
      'paulo londra', 'ecko', 'bhavi', 'rei', 'eight', 'rusherking',
    ],
    artistas: [
      'Duki', 'Bizarrap', 'Milo J', 'Wos', 'YSY A', 'Trueno', 'Tiago PZK',
      'Khea', 'Nicki Nicole', 'Cazzu', 'Lit Killah', 'Neo Pistea',
      'Paulo Londra', 'Ecko', 'Bhavi', 'Rei', 'Eight', 'Rusherking', 'Acru',
    ],
    terminosBusqueda: [
      'trap argentino exitos',
      'musica urbana argentina',
      'bizarrap session mix',
      'trap argentino 2024',
      'hip hop argentino mejores canciones',
      'artistas similares a Duki',
      'artistas similares a Bizarrap',
      'trap urbano latino mix',
      'rap argentino clasicos',
    ],
    generosAfines: ['pop-latino', 'rkt-turreo'],
  },
  {
    id: 'cumbia-cuarteto',
    nombre: 'Cumbia & Cuarteto',
    keywords: [
      'cumbia', 'cuarteto', 'tropical', 'konga', 'damas gratis', 'ke personajes',
      'rodrigo', 'walter olmos', 'ulises bueno', 'pablito lescano', 'amar azul',
      'rafaga', 'los palmeras', 'angela leiva', 'karina', 'la barra', 'q lokura',
      'luck ra', 'litto nebbia tropical', 'los del fuego', 'damian cordoba',
    ],
    artistas: [
      "La K'onga", 'Ke Personajes', 'Damas Gratis', 'Rodrigo', 'Ulises Bueno',
      'Los Palmeras', "Q' Lokura", 'Luck Ra', 'Amar Azul', 'Karina', 'Ráfaga',
      'Los del Fuego', 'Damián Córdoba', 'Ángela Leiva', 'Walter Olmos',
    ],
    terminosBusqueda: [
      'cumbia santafesina exitos',
      'cuarteto cordobes enganchados',
      'cumbia villera clasicos',
      'cumbia tropical argentina mix',
      'artistas similares a Rodrigo cuarteto',
      'cumbia argentina 2000s enganchados',
      'cumbia nueva generacion exitos',
    ],
    generosAfines: ['tropical-salsa', 'rkt-turreo'],
  },
  {
    id: 'pop-latino',
    nombre: 'Pop Latino',
    keywords: [
      'pop', 'latino', 'tini', 'maria becerra', 'emilia', 'lali', 'morat',
      'sebastian yatra', 'camilo', 'aitana', 'reik', 'cnco', 'chayanne',
      'ricky martin', 'shakira', 'alejandro sanz', 'pablo alborán', 'juanes',
      'carlos vives', 'maluma', 'karol g',
    ],
    artistas: [
      'TINI', 'Maria Becerra', 'Emilia', 'Lali', 'Morat', 'Sebastián Yatra',
      'Camilo', 'Aitana', 'Shakira', 'Alejandro Sanz', 'Pablo Alborán',
      'Juanes', 'Carlos Vives', 'Karol G', 'Reik', 'Chayanne', 'Ricky Martin',
    ],
    terminosBusqueda: [
      'pop latino exitos',
      'pop en espanol canciones',
      'pop latino mix',
      'pop latino 2020s hits',
      'artistas similares a Shakira',
      'artistas similares a TINI',
      'baladas pop en español',
      'pop latinoamericano exitos',
    ],
    generosAfines: ['trap-urbano', 'reggaeton'],
  },
  {
    id: 'rkt-turreo',
    nombre: 'RKT & Turreo',
    keywords: [
      'rkt', 'turreo', 'cachengue', 'callejero fino', 'l-gante', 'la joaqui',
      'alan gomez', 'dj tao', 'kaleb di masi', 'ecko', 'perreo', 'lgante',
      'el noba', 'barrio obrero',
    ],
    artistas: [
      'Callejero Fino', 'L-Gante', 'La Joaqui', 'DJ Tao', 'Alan Gomez',
      'Kaleb Di Masi', 'Salastkbron', 'El Noba',
    ],
    terminosBusqueda: [
      'rkt turreo mix',
      'cachengue remix',
      'dj tao turreo session',
      'rkt enganchados 2024',
      'artistas similares a L-Gante',
      'cumbia rkt argentina',
      'turreo hits mix',
    ],
    generosAfines: ['cumbia-cuarteto', 'trap-urbano'],
  },
  {
    id: 'reggaeton',
    nombre: 'Reggaeton & Urbano Latino',
    keywords: [
      'reggaeton', 'daddy yankee', 'bad bunny', 'don omar', 'wisin', 'yandel',
      'feid', 'rauw alejandro', 'j balvin', 'maluma', 'ozuna', 'anuel',
      'myke towers', 'arcangel', 'plan b', 'nicky jam', 'sech', 'jhay cortez',
      'mora', 'eladio carrion',
    ],
    artistas: [
      'Bad Bunny', 'Feid', 'Daddy Yankee', 'Rauw Alejandro', 'Don Omar',
      'Wisin & Yandel', 'Myke Towers', 'J Balvin', 'Ozuna', 'Arcángel',
      'Nicky Jam', 'Sech', 'Jhay Cortez', 'Mora', 'Eladio Carrión',
    ],
    terminosBusqueda: [
      'reggaeton clasico mix',
      'reggaeton exitos',
      'perreo mix',
      'reggaeton 2010s clasicos',
      'artistas similares a Bad Bunny',
      'reggaeton nuevo hits 2024',
      'urbano latino mix exitos',
      'reggaeton viejo vs nuevo',
    ],
    generosAfines: ['pop-latino', 'trap-urbano'],
  },
  {
    id: 'rock-clasico',
    nombre: 'Rock & Pop Clásico',
    keywords: [
      'classic rock', 'queen', 'beatles', 'michael jackson', 'pink floyd',
      'led zeppelin', 'the rolling stones', 'ac/dc', 'guns n roses', 'bowie',
      'elton john', 'bon jovi', 'aerosmith', 'police', 'u2', 'dire straits',
      'fleetwood mac', 'eagles', 'nirvana', 'pearl jam', 'oasis', 'radiohead',
      'the doors', 'jimi hendrix', 'bruce springsteen',
    ],
    artistas: [
      'Queen', 'The Beatles', 'Michael Jackson', 'Pink Floyd', 'Led Zeppelin',
      'The Rolling Stones', 'AC/DC', "Guns N' Roses", 'David Bowie', 'Elton John',
      'Bon Jovi', 'Aerosmith', 'The Police', 'U2', 'Dire Straits',
      'Fleetwood Mac', 'The Eagles', 'Nirvana', 'Pearl Jam', 'Oasis', 'Radiohead',
      'The Doors', 'Jimi Hendrix', 'Bruce Springsteen',
    ],
    terminosBusqueda: [
      'classic rock 70s 80s 90s',
      'best rock classics songs',
      'rock legends mix',
      'rock classics 70s hits',
      'rock classics 80s greatest hits',
      'rock classics 90s',
      'artistas similares a Pink Floyd',
      'artistas similares a Queen',
      'best rock songs of all time',
      'classic rock greatest hits playlist',
    ],
    generosAfines: ['rock-nacional', 'indie-alternativo', 'metal-punk'],
  },
  {
    id: 'indie-alternativo',
    nombre: 'Indie & Alternativo',
    keywords: [
      'indie', 'alternativo', 'bandalos chinos', 'conociendo rusia',
      'usted senalemelo', 'el kuelgue', 'los espiritus', 'zoe gotusso',
      'ca7riel', 'paco amoroso', 'marilina bertoldi', 'silvestre y la naranja',
      'eruca sativa', 'airbag', 'vicentico', 'nada surf', 'the strokes',
      'arctic monkeys', 'vampire weekend', 'tame impala',
    ],
    artistas: [
      'Bandalos Chinos', 'Conociendo Rusia', 'Usted Señalemelo', 'El Kuelgue',
      'Zoe Gotusso', 'Silvestre y La Naranja', 'Ca7riel', 'Los Espíritus',
      'Marilina Bertoldi', 'Eruca Sativa', 'Airbag', 'Paco Amoroso',
      'Nada Surf', 'The Strokes', 'Arctic Monkeys', 'Vampire Weekend', 'Tame Impala',
    ],
    terminosBusqueda: [
      'indie argentino canciones',
      'indie en espanol mix',
      'rock alternativo latino',
      'indie rock argentina 2020s',
      'artistas similares a Bandalos Chinos',
      'indie folk latinoamericano',
      'alternativo argentino mejores canciones',
      'rock independiente argentino',
    ],
    generosAfines: ['rock-nacional', 'rock-clasico'],
  },
  {
    id: 'electronica-house',
    nombre: 'Electrónica & Dance',
    keywords: [
      'electronica', 'edm', 'house', 'techno', 'daft punk', 'david guetta',
      'avicii', 'calvin harris', 'tiesto', 'martin garrix', 'swedish house mafia',
      'alok', 'deadmau5', 'kygo', 'marshmello', 'alan walker', 'the chainsmokers',
      'disclosure', 'flume', 'moderat', 'aphex twin',
    ],
    artistas: [
      'Daft Punk', 'Avicii', 'Calvin Harris', 'David Guetta', 'Tiësto',
      'Martin Garrix', 'Swedish House Mafia', 'Alok', 'Deadmau5',
      'Kygo', 'Marshmello', 'Alan Walker', 'The Chainsmokers', 'Disclosure', 'Flume',
    ],
    terminosBusqueda: [
      'electronic dance music mix',
      'house music hits',
      'edm festival mix',
      'progressive house mix 2020s',
      'artistas similares a Daft Punk',
      'artistas similares a Avicii',
      'electronic music best songs',
      'deep house chill mix',
    ],
    generosAfines: ['lofi-chill'],
  },
  {
    id: 'lofi-chill',
    nombre: 'Lo-Fi & Relax',
    keywords: [
      'lofi', 'chill', 'study', 'relax', 'beats', 'ambient', 'instrumental',
      'sleep', 'piano chill', 'lo-fi', 'lo fi', 'jazz hop', 'chillhop',
      'study beats', 'focus music', 'calm',
    ],
    artistas: [
      'Lofi Girl', 'ChilledCow', 'Kudasaibeats', 'Idealism', 'Jinsang',
      'Nujabes', 'J Dilla', 'Philanthrope', 'Cozy Lofi',
    ],
    terminosBusqueda: [
      'lofi hip hop beats to relax study to',
      'chill study beats lofi',
      'ambient chill music',
      'lo fi jazz hop chill',
      'piano chill instrumental mix',
      'study music focus beats',
      'lofi beats para estudiar',
    ],
    generosAfines: ['electronica-house'],
  },
  {
    id: 'tropical-salsa',
    nombre: 'Tropical & Salsa',
    keywords: [
      'salsa', 'tropical', 'marc anthony', 'romeo santos', 'aventura',
      'bachata', 'merengue', 'grupo extra', 'victor manuelle',
      'gilberto santa rosa', 'celia cruz', 'willie colon', 'ruben blades',
      'hector lavoe', 'sonora ponceña', 'la india',
    ],
    artistas: [
      'Marc Anthony', 'Romeo Santos', 'Aventura', 'Ozuna', 'Grupo Extra',
      'Víctor Manuelle', 'Gilberto Santa Rosa', 'Celia Cruz', 'Willie Colón',
      'Rubén Blades', 'Héctor Lavoe', 'La India', 'Juan Luis Guerra',
    ],
    terminosBusqueda: [
      'salsa clasica exitos',
      'bachata mix romantica',
      'tropical latin mix hits',
      'artistas similares a Marc Anthony',
      'salsa romantica baladas',
      'bachata romeo santos mix',
      'merengue clasico exitos',
    ],
    generosAfines: ['cumbia-cuarteto', 'pop-latino'],
  },
  {
    id: 'folclore-regional',
    nombre: 'Folclore & Regional',
    keywords: [
      'folclore', 'folklore', 'zamba', 'chacarera', 'malambo', 'cueca',
      'horacio guarany', 'los chalchaleros', 'soledad', 'chango spasiuk',
      'atahualpa yupanqui', 'mercedes sosa', 'victor heredia', 'jorge cafrune',
      'los nocheros', 'chabuca granda', 'andean', 'altiplano',
    ],
    artistas: [
      'Horacio Guarany', 'Los Chalchaleros', 'Soledad', 'Chango Spasiuk',
      'Atahualpa Yupanqui', 'Mercedes Sosa', 'Victor Heredia', 'Jorge Cafrune',
      'Los Nocheros', 'Chabuca Granda',
    ],
    terminosBusqueda: [
      'folklore argentino exitos',
      'zamba chacarera clasicos',
      'artistas similares a Mercedes Sosa',
      'folclore argentino mejores canciones',
      'folklore latinoamericano mix',
      'musica regional argentina',
    ],
    generosAfines: ['rock-nacional'],
  },
  {
    id: 'metal-punk',
    nombre: 'Metal & Punk',
    keywords: [
      'metal', 'punk', 'heavy metal', 'thrash', 'metallica', 'slipknot',
      'iron maiden', 'sepultura', 'rata blanca', 'almafuerte', 'la renga metal',
      'motörhead', 'black sabbath', 'judas priest', 'megadeth', 'anthrax',
      'pantera', 'system of a down', 'rammstein', 'tool',
    ],
    artistas: [
      'Metallica', 'Slipknot', 'Iron Maiden', 'Sepultura', 'Rata Blanca',
      'Almafuerte', 'Motörhead', 'Black Sabbath', 'Judas Priest', 'Megadeth',
      'Pantera', 'System of a Down', 'Rammstein', 'Tool',
    ],
    terminosBusqueda: [
      'heavy metal classics mix',
      'thrash metal best songs',
      'artistas similares a Metallica',
      'metal argentino exitos',
      'punk rock clasicos',
      'metal latinoamericano mix',
      'best metal songs of all time',
    ],
    generosAfines: ['rock-clasico', 'rock-nacional'],
  },
  {
    id: 'flamenco-guitarra',
    nombre: 'Flamenco & Guitarra Española',
    keywords: [
      'flamenco', 'guitarra española', 'paco de lucia', 'camaron', 'pablo alboran',
      'diego el cigala', 'manolo sanlucar', 'tomatito', 'flamenco fusion',
      'spanish guitar', 'nuevo flamenco',
    ],
    artistas: [
      'Paco de Lucía', 'Camarón de la Isla', 'Pablo Alborán', 'Diego El Cigala',
      'Manolo Sanlúcar', 'Tomatito', 'Vicente Amigo', 'Enrique Morente',
    ],
    terminosBusqueda: [
      'flamenco clasico grandes exitos',
      'guitarra española mejores canciones',
      'artistas similares a Paco de Lucia',
      'flamenco fusion mix',
      'spanish guitar best songs',
      'nuevo flamenco hits',
    ],
    generosAfines: ['pop-latino', 'folclore-regional'],
  },
];

// ---------------------------------------------------------------------------
// Lookup inverso: artista (lowercase) → id de género
// Permite identificar el género directamente por el nombre del canal/artista
// sin necesidad de que la keyword aparezca en el título.
// ---------------------------------------------------------------------------

const ARTISTA_A_GENERO_ID: Map<string, string> = new Map([
  // Rock Nacional
  ['charly garcía', 'rock-nacional'], ['charly garcia', 'rock-nacional'],
  ['luis alberto spinetta', 'rock-nacional'], ['spinetta', 'rock-nacional'],
  ['fito páez', 'rock-nacional'], ['fito paez', 'rock-nacional'],
  ['gustavo cerati', 'rock-nacional'], ['cerati', 'rock-nacional'],
  ['soda stereo', 'rock-nacional'],
  ['andrés calamaro', 'rock-nacional'], ['andres calamaro', 'rock-nacional'],
  ['divididos', 'rock-nacional'],
  ['babasónicos', 'rock-nacional'], ['babasonicos', 'rock-nacional'],
  ['ciro y los persas', 'rock-nacional'], ['ciro', 'rock-nacional'],
  ['las pastillas del abuelo', 'rock-nacional'],
  ['guasones', 'rock-nacional'],
  ['la renga', 'rock-nacional'],
  ['los piojos', 'rock-nacional'],
  ['los auténticos decadentes', 'rock-nacional'], ['los autenticos decadentes', 'rock-nacional'],
  ['los fabulosos cadillacs', 'rock-nacional'],
  ['bersuit vergarabat', 'rock-nacional'], ['bersuit', 'rock-nacional'],
  ['dos minutos', 'rock-nacional'],
  ['intoxicados', 'rock-nacional'],
  ['almendra', 'rock-nacional'],
  ['serú girán', 'rock-nacional'], ['seru giran', 'rock-nacional'],
  // Trap & Urbano
  ['duki', 'trap-urbano'],
  ['bizarrap', 'trap-urbano'], ['bzrp', 'trap-urbano'],
  ['milo j', 'trap-urbano'],
  ['wos', 'trap-urbano'],
  ['ysy a', 'trap-urbano'],
  ['trueno', 'trap-urbano'],
  ['tiago pzk', 'trap-urbano'],
  ['khea', 'trap-urbano'],
  ['nicki nicole', 'trap-urbano'],
  ['cazzu', 'trap-urbano'],
  ['lit killah', 'trap-urbano'],
  ['neo pistea', 'trap-urbano'],
  ['paulo londra', 'trap-urbano'],
  ['ecko', 'trap-urbano'],
  ['bhavi', 'trap-urbano'],
  ['rusherking', 'trap-urbano'],
  ['acru', 'trap-urbano'],
  // Cumbia & Cuarteto
  ["la k'onga", 'cumbia-cuarteto'], ['la konga', 'cumbia-cuarteto'],
  ['ke personajes', 'cumbia-cuarteto'],
  ['damas gratis', 'cumbia-cuarteto'],
  ['rodrigo', 'cumbia-cuarteto'],
  ['ulises bueno', 'cumbia-cuarteto'],
  ['los palmeras', 'cumbia-cuarteto'],
  ["q' lokura", 'cumbia-cuarteto'], ['q lokura', 'cumbia-cuarteto'],
  ['luck ra', 'cumbia-cuarteto'],
  ['amar azul', 'cumbia-cuarteto'],
  ['karina', 'cumbia-cuarteto'],
  ['ráfaga', 'cumbia-cuarteto'], ['rafaga', 'cumbia-cuarteto'],
  ['los del fuego', 'cumbia-cuarteto'],
  ['damián córdoba', 'cumbia-cuarteto'], ['damian cordoba', 'cumbia-cuarteto'],
  ['ángela leiva', 'cumbia-cuarteto'], ['angela leiva', 'cumbia-cuarteto'],
  ['walter olmos', 'cumbia-cuarteto'],
  // Pop Latino
  ['tini', 'pop-latino'],
  ['maria becerra', 'pop-latino'],
  ['emilia', 'pop-latino'],
  ['lali', 'pop-latino'],
  ['morat', 'pop-latino'],
  ['sebastián yatra', 'pop-latino'], ['sebastian yatra', 'pop-latino'],
  ['camilo', 'pop-latino'],
  ['aitana', 'pop-latino'],
  ['shakira', 'pop-latino'],
  ['alejandro sanz', 'pop-latino'],
  ['pablo alborán', 'pop-latino'], ['pablo alboran', 'pop-latino'],
  ['juanes', 'pop-latino'],
  ['carlos vives', 'pop-latino'],
  ['karol g', 'pop-latino'],
  ['reik', 'pop-latino'],
  ['chayanne', 'pop-latino'],
  ['ricky martin', 'pop-latino'],
  // RKT & Turreo
  ['callejero fino', 'rkt-turreo'],
  ['l-gante', 'rkt-turreo'], ['lgante', 'rkt-turreo'],
  ['la joaqui', 'rkt-turreo'],
  ['dj tao', 'rkt-turreo'],
  ['alan gomez', 'rkt-turreo'],
  ['kaleb di masi', 'rkt-turreo'],
  ['salastkbron', 'rkt-turreo'],
  ['el noba', 'rkt-turreo'],
  // Reggaeton
  ['bad bunny', 'reggaeton'],
  ['feid', 'reggaeton'],
  ['daddy yankee', 'reggaeton'],
  ['rauw alejandro', 'reggaeton'],
  ['don omar', 'reggaeton'],
  ['wisin & yandel', 'reggaeton'], ['wisin y yandel', 'reggaeton'],
  ['myke towers', 'reggaeton'],
  ['j balvin', 'reggaeton'],
  ['ozuna', 'reggaeton'],
  ['arcángel', 'reggaeton'], ['arcangel', 'reggaeton'],
  ['nicky jam', 'reggaeton'],
  ['sech', 'reggaeton'],
  ['jhay cortez', 'reggaeton'],
  ['mora', 'reggaeton'],
  ['eladio carrión', 'reggaeton'], ['eladio carrion', 'reggaeton'],
  // Rock Clásico
  ['queen', 'rock-clasico'],
  ['the beatles', 'rock-clasico'], ['beatles', 'rock-clasico'],
  ['michael jackson', 'rock-clasico'],
  ['pink floyd', 'rock-clasico'],
  ['led zeppelin', 'rock-clasico'],
  ['the rolling stones', 'rock-clasico'], ['rolling stones', 'rock-clasico'],
  ['ac/dc', 'rock-clasico'],
  ["guns n' roses", 'rock-clasico'], ['guns n roses', 'rock-clasico'],
  ['david bowie', 'rock-clasico'],
  ['elton john', 'rock-clasico'],
  ['bon jovi', 'rock-clasico'],
  ['aerosmith', 'rock-clasico'],
  ['the police', 'rock-clasico'],
  ['u2', 'rock-clasico'],
  ['dire straits', 'rock-clasico'],
  ['fleetwood mac', 'rock-clasico'],
  ['the eagles', 'rock-clasico'], ['eagles', 'rock-clasico'],
  ['nirvana', 'rock-clasico'],
  ['pearl jam', 'rock-clasico'],
  ['oasis', 'rock-clasico'],
  ['radiohead', 'rock-clasico'],
  ['the doors', 'rock-clasico'],
  ['jimi hendrix', 'rock-clasico'],
  ['bruce springsteen', 'rock-clasico'],
  // Indie & Alternativo
  ['bandalos chinos', 'indie-alternativo'],
  ['conociendo rusia', 'indie-alternativo'],
  ['usted señalemelo', 'indie-alternativo'], ['usted senalemelo', 'indie-alternativo'],
  ['el kuelgue', 'indie-alternativo'],
  ['zoe gotusso', 'indie-alternativo'],
  ['silvestre y la naranja', 'indie-alternativo'],
  ['ca7riel', 'indie-alternativo'],
  ['los espíritus', 'indie-alternativo'], ['los espiritus', 'indie-alternativo'],
  ['marilina bertoldi', 'indie-alternativo'],
  ['eruca sativa', 'indie-alternativo'],
  ['airbag', 'indie-alternativo'],
  ['paco amoroso', 'indie-alternativo'],
  ['arctic monkeys', 'indie-alternativo'],
  ['tame impala', 'indie-alternativo'],
  ['the strokes', 'indie-alternativo'],
  ['vampire weekend', 'indie-alternativo'],
  // Electrónica
  ['daft punk', 'electronica-house'],
  ['avicii', 'electronica-house'],
  ['calvin harris', 'electronica-house'],
  ['david guetta', 'electronica-house'],
  ['tiësto', 'electronica-house'], ['tiesto', 'electronica-house'],
  ['martin garrix', 'electronica-house'],
  ['swedish house mafia', 'electronica-house'],
  ['alok', 'electronica-house'],
  ['deadmau5', 'electronica-house'],
  ['kygo', 'electronica-house'],
  ['marshmello', 'electronica-house'],
  ['alan walker', 'electronica-house'],
  ['the chainsmokers', 'electronica-house'],
  ['disclosure', 'electronica-house'],
  ['flume', 'electronica-house'],
  // Lo-Fi
  ['lofi girl', 'lofi-chill'], ['lofi girl - beats to relax/study to', 'lofi-chill'],
  ['chilledcow', 'lofi-chill'],
  ['kudasaibeats', 'lofi-chill'],
  ['idealism', 'lofi-chill'],
  ['jinsang', 'lofi-chill'],
  ['nujabes', 'lofi-chill'],
  ['philanthrope', 'lofi-chill'],
  // Tropical & Salsa
  ['marc anthony', 'tropical-salsa'],
  ['romeo santos', 'tropical-salsa'],
  ['aventura', 'tropical-salsa'],
  ['grupo extra', 'tropical-salsa'],
  ['víctor manuelle', 'tropical-salsa'], ['victor manuelle', 'tropical-salsa'],
  ['gilberto santa rosa', 'tropical-salsa'],
  ['celia cruz', 'tropical-salsa'],
  ['willie colón', 'tropical-salsa'], ['willie colon', 'tropical-salsa'],
  ['rubén blades', 'tropical-salsa'], ['ruben blades', 'tropical-salsa'],
  ['héctor lavoe', 'tropical-salsa'], ['hector lavoe', 'tropical-salsa'],
  ['la india', 'tropical-salsa'],
  ['juan luis guerra', 'tropical-salsa'],
  // Folclore
  ['horacio guarany', 'folclore-regional'],
  ['los chalchaleros', 'folclore-regional'],
  ['soledad', 'folclore-regional'],
  ['chango spasiuk', 'folclore-regional'],
  ['atahualpa yupanqui', 'folclore-regional'],
  ['mercedes sosa', 'folclore-regional'],
  ['victor heredia', 'folclore-regional'],
  ['jorge cafrune', 'folclore-regional'],
  ['los nocheros', 'folclore-regional'],
  ['chabuca granda', 'folclore-regional'],
  // Metal & Punk
  ['metallica', 'metal-punk'],
  ['slipknot', 'metal-punk'],
  ['iron maiden', 'metal-punk'],
  ['sepultura', 'metal-punk'],
  ['rata blanca', 'metal-punk'],
  ['almafuerte', 'metal-punk'],
  ['motörhead', 'metal-punk'], ['motorhead', 'metal-punk'],
  ['black sabbath', 'metal-punk'],
  ['judas priest', 'metal-punk'],
  ['megadeth', 'metal-punk'],
  ['pantera', 'metal-punk'],
  ['system of a down', 'metal-punk'],
  ['rammstein', 'metal-punk'],
  ['tool', 'metal-punk'],
  // Flamenco
  ['paco de lucía', 'flamenco-guitarra'], ['paco de lucia', 'flamenco-guitarra'],
  ['camarón de la isla', 'flamenco-guitarra'], ['camaron de la isla', 'flamenco-guitarra'],
  ['diego el cigala', 'flamenco-guitarra'],
  ['manolo sanlúcar', 'flamenco-guitarra'], ['manolo sanlucar', 'flamenco-guitarra'],
  ['tomatito', 'flamenco-guitarra'],
  ['vicente amigo', 'flamenco-guitarra'],
  ['enrique morente', 'flamenco-guitarra'],
]);

// ---------------------------------------------------------------------------
// Estado de módulo: rotación de términos de búsqueda por género
// ---------------------------------------------------------------------------

/** Índice actual de terminosBusqueda por género, para rotación sin repetición */
const _termIndices: Map<string, number> = new Map();

/** IDs de artistas ya aparecidos en la sesión actual, para penalizar repetición */
const _artistasEnSesion: Map<string, number> = new Map();

/** Reinicia el estado de sesión (llamar cuando se inicia una nueva radio) */
function _resetSesion(): void {
  _artistasEnSesion.clear();
}

function _registrarArtistaEnSesion(channel: string): void {
  const key = channel.toLowerCase();
  _artistasEnSesion.set(key, (_artistasEnSesion.get(key) ?? 0) + 1);
}

/**
 * Obtiene el siguiente término de búsqueda del género rotando sin repetir
 * en la misma sesión.
 */
function _obtenerTerminoRotado(genero: GeneroAfines): string {
  const idx = _termIndices.get(genero.id) ?? Math.floor(Math.random() * genero.terminosBusqueda.length);
  const termino = genero.terminosBusqueda[idx % genero.terminosBusqueda.length];
  _termIndices.set(genero.id, (idx + 1) % genero.terminosBusqueda.length);
  return termino;
}

// ---------------------------------------------------------------------------
// Helpers de detección
// ---------------------------------------------------------------------------

/** Detecta si el texto es predominantemente en inglés (heurística simple) */
function _detectarIdioma(texto: string): 'es' | 'en' | 'unknown' {
  const palabrasEsp = /\b(con|que|una|los|las|del|para|por|como|más|muy|pero|este|esta|cuando|donde|todo|también|porque|después|aquí|hay|fue|ser|tiene|hacer|puede)\b/i;
  const palabrasEng = /\b(the|and|you|that|this|with|are|from|have|not|but|what|your|they|will|when|been|more|than|into|then|just|like|only|some|could|would|there|their|about|which|were|after|also|does|made|many|over|such|well|know|take|time|year|even|back|good|much|most|other|come|want|look|first|never|right|same|tell|think|those|through|where|while|again|place|still|world|before|change|every|found|great|might|small|sound|away|below|between|enough|early|large|often|last|little|along|always|around|place|another|important|until|children|side|feet|car|mile|night|walk|white|sea|began|grow|took|river|four|carry|state|once|book|hear|stop|without|second|later|miss|idea|body|music|color|stand|sun|question|fish|area|mark|horse|birds|problem|complete|room|knew|since|ever|near|hard|start|might|story|saw|far|draw|left|late|run|don\'t|while|press|close|night|real|life|few|north|open|seem|together|next|white|children|begin|got|walk|example|ease|paper|group|always|music|those|both|mark|book|letter|until|mile|river|car|feet|care|second|enough|plain|girl|usual|young|ready|above|ever|red|list|thought|study|still|learn|plant|cover|food|sun|four|between|state|keep|eye|never|last|let|thought|cross|farm|hard|start|might|story|saw|far|draw|left|late|run)\b/i;

  const matchEsp = (texto.match(palabrasEsp) || []).length;
  const matchEng = (texto.match(palabrasEng) || []).length;

  if (matchEsp > matchEng + 1) return 'es';
  if (matchEng > matchEsp + 1) return 'en';
  return 'unknown';
}

/** Detecta señales de subgénero a partir de metadatos */
type SubgeneroSignal = {
  esAcustico: boolean;
  esEnVivo: boolean;
  esRemix: boolean;
  esShort: boolean; // duration < 150s → probable trap/corto
  esBallad: boolean;
  idioma: 'es' | 'en' | 'unknown';
};

function _detectarSubgenero(titulo: string, canal: string, duration: number): SubgeneroSignal {
  const corpus = `${titulo} ${canal}`.toLowerCase();
  return {
    esAcustico: /acústi|acousti|unplugged|sesión acústi/i.test(corpus),
    esEnVivo: /en vivo|live|concierto|concert/i.test(corpus),
    esRemix: /\bremix\b|\brmx\b/i.test(corpus),
    esShort: duration > 0 && duration < 150,
    esBallad: /balad|ballade|lenta|slow|amor eterno|dueto/i.test(corpus),
    idioma: _detectarIdioma(corpus),
  };
}

// ---------------------------------------------------------------------------
// Funciones exportadas: limpiar título, extraer artistas, deducir género
// ---------------------------------------------------------------------------

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
    .replace(/letra\s*\/?[\s]*lyrics?/gi, '')
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
 * Deduce el género afín a partir de los metadatos de la canción.
 * Prioridad:
 * 1. Lookup inverso directo por nombre de artista/canal
 * 2. Match de keyword en corpus título+canal
 */
export function deducirGenero(titulo: string, canal: string): GeneroAfines | null {
  // 1. Lookup inverso por artista (canal limpio)
  const canalLimpio = canal
    .replace(/ - Topic$/i, '')
    .replace(/VEVO$/i, '')
    .trim()
    .toLowerCase();

  if (canalLimpio) {
    const generoPorArtista = ARTISTA_A_GENERO_ID.get(canalLimpio);
    if (generoPorArtista) {
      const encontrado = TAXONOMIA_GENEROS.find((g) => g.id === generoPorArtista);
      if (encontrado) return encontrado;
    }
  }

  // 2. También intentar con el artista extraído del título "Artista - Cancion"
  const partes = titulo.split(/\s*[-–—]\s*/);
  if (partes.length >= 2) {
    const posibleArtistaEnTitulo = partes[0].trim().toLowerCase();
    const generoPorTitulo = ARTISTA_A_GENERO_ID.get(posibleArtistaEnTitulo);
    if (generoPorTitulo) {
      const encontrado = TAXONOMIA_GENEROS.find((g) => g.id === generoPorTitulo);
      if (encontrado) return encontrado;
    }
  }

  // 3. Match de keywords en corpus completo
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

// ---------------------------------------------------------------------------
// Sistema de scoring
// ---------------------------------------------------------------------------

type ScoredTrack = { track: YtResult; score: number };

function _puntuar(
  track: YtResult,
  genero: GeneroAfines | null,
  likedArtists: Set<string>,
  dislikedArtists: Set<string>,
  seedDuration: number,
): ScoredTrack {
  let score = 0;
  const canal = (track.channel || '').toLowerCase();
  const canalLimpio = canal.replace(/ - topic$/i, '').replace(/vevo$/i, '').trim();

  // +3 si el artista es parte del género detectado
  if (genero) {
    const esMiembroGenero = genero.artistas.some(
      (a) => a.toLowerCase() === canalLimpio || a.toLowerCase() === canal
    );
    if (esMiembroGenero) score += 3;
  }

  // +2 si es artista con like
  if (likedArtists.has(track.channel || '') || likedArtists.has(canalLimpio)) {
    score += 2;
  }

  // +1 si la duración está en rango similar (±60s) a la semilla
  if (seedDuration > 0 && track.duration > 0) {
    if (Math.abs(track.duration - seedDuration) <= 60) score += 1;
  }

  // -1 si el artista ya apareció antes en la cola (penalizar repetición)
  const apariciones = _artistasEnSesion.get(canalLimpio) ?? 0;
  if (apariciones > 0) score -= 1;
  if (apariciones > 2) score -= 1; // doble penalización si apareció 3+ veces

  return { track, score };
}

function _ordenarPorScore(tracks: YtResult[], genero: GeneroAfines | null, likedArtists: Set<string>, dislikedArtists: Set<string>, seedDuration: number): YtResult[] {
  return tracks
    .map((t) => _puntuar(t, genero, likedArtists, dislikedArtists, seedDuration))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.track);
}

// ---------------------------------------------------------------------------
// Balanceo por artista (interleaving round-robin)
// ---------------------------------------------------------------------------

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
    for (const arr of grupos.values()) {
      if (arr.length > 0) {
        resultado.push(arr.shift()!);
        quedan = true;
      }
    }
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Búsquedas diversificadas según señales de subgénero
// ---------------------------------------------------------------------------

function _construirTerminosBusqueda(
  artistas: string[],
  genero: GeneroAfines | null,
  signal: SubgeneroSignal,
  canalLimpio: string,
  tituloLimpio: string,
): string[] {
  const terminos: string[] = [];
  const artPrincipal = artistas[0] || canalLimpio || tituloLimpio.slice(0, 20);

  // Siempre: búsqueda del artista principal con variantes
  terminos.push(`${artPrincipal} mejores canciones`);
  terminos.push(`${artPrincipal} canciones populares`);

  // Si hay señal acústica
  if (signal.esAcustico) {
    terminos.push(`${artPrincipal} sesión acústica`);
    terminos.push(`${artPrincipal} acoustic session`);
  }

  // Si es en vivo, buscar más en vivo
  if (signal.esEnVivo) {
    terminos.push(`${artPrincipal} en vivo concierto`);
    terminos.push(`${artPrincipal} live concert`);
  }

  // Si es remix
  if (signal.esRemix && genero) {
    terminos.push(`${genero.nombre} remix mix`);
    terminos.push(`${artPrincipal} remix`);
  }

  // Si es short / trap-like
  if (signal.esShort && (!genero || ['trap-urbano', 'rkt-turreo', 'reggaeton'].includes(genero.id))) {
    terminos.push('trap urbano exitos cortos 2024');
  }

  // Si es balada
  if (signal.esBallad) {
    const idiomaSufijo = signal.idioma === 'en' ? 'slow songs ballads' : 'baladas lentas romanticas';
    terminos.push(`${artPrincipal} ${idiomaSufijo}`);
  }

  // Búsquedas de artistas similares
  terminos.push(`artistas similares a ${artPrincipal}`);

  // Si hay género: términos rotados del género
  if (genero) {
    terminos.push(_obtenerTerminoRotado(genero));
    // Término con rango de año si es rock clásico o pop clásico
    if (genero.id === 'rock-clasico') {
      const rangos = ['70s', '80s', '90s'];
      const rango = rangos[Math.floor(Math.random() * rangos.length)];
      const idiomaRango = signal.idioma === 'es' ? `rock clasico ${rango}` : `rock classics ${rango}`;
      terminos.push(idiomaRango);
    }
  } else {
    // Sin género: mix general del artista o del tema
    terminos.push(canalLimpio ? `${canalLimpio} mix` : `${tituloLimpio} mix`);
  }

  // Buscar artistas colaboradores adicionales
  if (artistas.length > 1) {
    terminos.push(`${artistas[1]} mejores canciones`);
  }

  // Deduplicar
  return [...new Set(terminos)].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Función principal: sintonizarRadioInteligente
// ---------------------------------------------------------------------------

/**
 * Sintoniza una estación de radio diversa e inteligente para una canción semilla.
 * Usa lookup inverso por artista, scoring multidimensional y búsquedas diversificadas.
 */
export async function sintonizarRadioInteligente(
  seed: YtResult,
  likedArtists: Set<string> = new Set(),
  dislikedIds: Set<string> = new Set(),
  dislikedArtists: Set<string> = new Set(),
): Promise<{ tracks: YtResult[]; nombreEstacion: string }> {
  _resetSesion();

  const canalLimpio = (seed.channel || '').replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
  const tituloLimpio = limpiarTituloCancion(seed.title);
  const artistas = extraerArtistasYColaboradores(seed.title, seed.channel || '');
  const genero = deducirGenero(seed.title, seed.channel || '');
  const signal = _detectarSubgenero(seed.title, seed.channel || '', seed.duration ?? 0);

  const nombreEstacion = canalLimpio
    ? `📻 Radio ${canalLimpio}`
    : `📻 Radio ${tituloLimpio.slice(0, 24)}`;

  const idsVistos = new Set<string>([seed.id]);
  let pool: YtResult[] = [];

  // ── 1. Radio nativa de YouTube (señal principal) ──────────────────────────
  try {
    const resRadio = await api.radio(seed.id, 25);
    if (resRadio.ok && Array.isArray(resRadio.tracks)) {
      pool.push(...resRadio.tracks);
    }
  } catch (_) {}

  // ── 2. Búsquedas diversificadas según señales detectadas ──────────────────
  const terminosBusqueda = _construirTerminosBusqueda(artistas, genero, signal, canalLimpio, tituloLimpio);

  // Ejecutar primeros 5 términos en paralelo para no sobrecargar la API
  const terminos5 = terminosBusqueda.slice(0, 5);
  const busquedasPrincipales = await Promise.allSettled(
    terminos5.map((q) => api.search(q, 10, 'songs'))
  );
  for (const r of busquedasPrincipales) {
    if (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.results)) {
      pool.push(...r.value.results);
    }
  }

  // ── 3. Expansión por artistas afines del mismo género ────────────────────
  if (genero) {
    const afines = genero.artistas
      .filter((a) => !artistas.some((art) => art.toLowerCase() === a.toLowerCase()))
      .slice(0, 3);

    const busquedasAfines = await Promise.allSettled(
      afines.map((af) => api.search(`${af} mejores canciones`, 8, 'songs'))
    );
    for (const r of busquedasAfines) {
      if (r.status === 'fulfilled' && r.value?.ok && Array.isArray(r.value.results)) {
        pool.push(...r.value.results);
      }
    }

    // Un término adicional rotado del género
    try {
      const terminoExtra = _obtenerTerminoRotado(genero);
      const resExtra = await api.search(terminoExtra, 10, 'songs');
      if (resExtra.ok && Array.isArray(resExtra.results)) {
        pool.push(...resExtra.results);
      }
    } catch (_) {}
  }

  // ── 4. Filtrar y deduplicar ───────────────────────────────────────────────
  const filtrados = pool.filter((t) => {
    if (!t?.id || idsVistos.has(t.id)) return false;
    if (dislikedIds.has(t.id)) return false;
    if (t.channel && dislikedArtists.has(t.channel)) return false;
    idsVistos.add(t.id);
    return true;
  });

  // ── 5. Scoring multidimensional ───────────────────────────────────────────
  const ordenados = _ordenarPorScore(filtrados, genero, likedArtists, dislikedArtists, seed.duration ?? 0);

  // ── 6. Separar con like y sin like, luego balancear ──────────────────────
  const conLike = ordenados.filter((t) => t.channel && likedArtists.has(t.channel));
  const sinLike = ordenados.filter((t) => !t.channel || !likedArtists.has(t.channel));
  const balanceados = balancearPorArtista(sinLike, 2);

  // Registrar artistas en sesión
  for (const t of [...conLike, ...balanceados]) {
    if (t.channel) _registrarArtistaEnSesion(t.channel);
  }

  const finales = [...conLike, ...balanceados].map((t) => ({ ...t, kind: 'song' as const }));

  return { tracks: finales, nombreEstacion };
}

// ---------------------------------------------------------------------------
// Función de extensión: extenderRadioDiverso
// ---------------------------------------------------------------------------

/** Mapeo de géneros afines para expansión cuando la cola se agota */
const GENEROS_AFINES_MAP: Record<string, string[]> = TAXONOMIA_GENEROS.reduce<Record<string, string[]>>(
  (acc, g) => {
    if (g.generosAfines && g.generosAfines.length > 0) {
      acc[g.id] = g.generosAfines;
    }
    return acc;
  },
  {}
);

/**
 * Extensión dinámica de la cola de radio con diversidad de estilos.
 * Cuando se agota la cola: usa liked artists y expande a géneros afines.
 */
export async function extenderRadioDiverso(
  currentTrack: YtResult,
  colaActual: YtResult[],
  likedArtists: Set<string> = new Set(),
  dislikedIds: Set<string> = new Set(),
  dislikedArtists: Set<string> = new Set(),
): Promise<YtResult[]> {
  const idsExistentes = new Set(colaActual.map((t) => t.id));
  let candidatos: YtResult[] = [];

  // ── 1. Radio nativa de la pista actual ───────────────────────────────────
  try {
    const res = await api.radio(currentTrack.id, 15);
    if (res.ok && Array.isArray(res.tracks)) candidatos.push(...res.tracks);
  } catch (_) {}

  // ── 2. Semilla aleatoria de la cola para evitar derivar en un único subgénero
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

  // ── 3. Si la cola está casi vacía → búsqueda de liked artist ─────────────
  const colaCorta = colaActual.length < 5;
  if (colaCorta && likedArtists.size > 0) {
    const likedArr = Array.from(likedArtists);
    const randLiked = likedArr[Math.floor(Math.random() * likedArr.length)];
    try {
      const resLiked = await api.search(`${randLiked} mejores canciones`, 12, 'songs');
      if (resLiked.ok && Array.isArray(resLiked.results)) candidatos.push(...resLiked.results);
    } catch (_) {}
  }

  // ── 4. Expansión a género afín si la radio devolvió pocos candidatos ──────
  const genero = deducirGenero(currentTrack.title, currentTrack.channel || '');

  if (candidatos.length < 8) {
    if (genero) {
      // Usar término rotado del género actual
      const q = _obtenerTerminoRotado(genero);
      try {
        const busq = await api.search(q, 15, 'songs');
        if (busq.ok && Array.isArray(busq.results)) candidatos.push(...busq.results);
      } catch (_) {}

      // Expandir a género afín
      const afinesIds = GENEROS_AFINES_MAP[genero.id] ?? [];
      if (afinesIds.length > 0) {
        const idAfin = afinesIds[Math.floor(Math.random() * afinesIds.length)];
        const generoAfin = TAXONOMIA_GENEROS.find((g) => g.id === idAfin);
        if (generoAfin) {
          const qAfin = _obtenerTerminoRotado(generoAfin);
          try {
            const resAfin = await api.search(qAfin, 10, 'songs');
            if (resAfin.ok && Array.isArray(resAfin.results)) candidatos.push(...resAfin.results);
          } catch (_) {}
        }
      }
    } else {
      // Sin género: mix del canal o artista
      const canal = (currentTrack.channel || '').replace(/ - Topic$/i, '').trim();
      const q = canal ? `${canal} mix` : `${currentTrack.title} mix`;
      try {
        const busq = await api.search(q, 15, 'songs');
        if (busq.ok && Array.isArray(busq.results)) candidatos.push(...busq.results);
      } catch (_) {}
    }
  }

  // ── 5. Filtrar duplicados y listas negras ─────────────────────────────────
  const vistos = new Set<string>();
  const filtrados = candidatos.filter((t) => {
    if (!t?.id || idsExistentes.has(t.id) || vistos.has(t.id)) return false;
    if (dislikedIds.has(t.id)) return false;
    if (t.channel && dislikedArtists.has(t.channel)) return false;
    vistos.add(t.id);
    return true;
  });

  // ── 6. Scoring + balanceo ─────────────────────────────────────────────────
  const ordenados = _ordenarPorScore(filtrados, genero, likedArtists, dislikedArtists, currentTrack.duration ?? 0);
  const balanceados = balancearPorArtista(ordenados, 2);
  return balanceados.map((t) => ({ ...t, kind: 'song' as const }));
}
