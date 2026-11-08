---
name: youthink
description: Documentación y referencia técnica completa de la app YouThink (quepensabas-bajar-app). Cubre arquitectura híbrida (React Native / Expo + módulo nativo Android qp-audio con NewPipeExtractor), reproducción en segundo plano con ExoPlayer, extracción de audio/video sin bloqueo de bots (IP residencial), integración OAuth independiente con YouTube Data API v3, sincronización de playlists (locales y Supabase), banner de descarga directa con auto-update desde GitHub Releases en la versión web (youthink.quepensabas.mov), arquitectura de dos ramas (main para Celular y proyector-tv para Android TV), prevención de doble reproducción y páginas legales de verificación Google Cloud. Usar para tareas de mantenimiento, compilación de APKs, features y bugs en YouThink.
---

# YouThink — App Móvil de Música, Video y Listas de YouTube

## Qué es
**YouThink** es la aplicación móvil y web para Android, iOS y navegadores del ecosistema Qué Pensabas que permite:
1. Buscar y escuchar música o ver videos de YouTube sin anuncios ni bloqueos de bot.
2. Reproducir audio en segundo plano con controles multimedia en la barra de notificaciones y ecualizador integrado.
3. Crear y gestionar listas de reproducción personalizadas (con persistencia local en `AsyncStorage` y sincronización en Supabase).
4. Conectar la cuenta personal de YouTube vía OAuth directo para importar, navegar y reproducir todas las listas de YouTube con un toque.
5. Descarga de canciones y visualización de letras sincronizadas con traducción automática (Gemini AI).
6. **Versión Web / PWA (`youthink.quepensabas.mov`):** reproductor web responsive para PC, macOS, iPhone y Android con reproducción continua en segundo plano, soporte para pantalla bloqueada (MediaSession API) y minimización sin cortes.
7. **Pestaña Tap Tempo & Modificador de Velocidad:** medidor de BPM por toques rítmicos, metrónomo sintetizado con Web Audio, clasificaciones musicales/géneros, cálculo de aceleración/desaceleración y control en vivo de velocidad de reproducción (0.25x – 2.0x).
8. **Pestaña Principal "Play":** nombrada "Play" con ícono ▶️ en la barra inferior.
9. **Historial de Reproducción & Recomendados Inteligentes:** historial persistente (`qp_historial`) en la pantalla de inicio con carrusel horizontal táctil y botón de borrado; sección de recomendaciones y tendencias personalizadas basadas dinámicamente en lo que el usuario escucha.
10. **Descargas Seguras & Carátula Integrada:** descarga directa con pre-generación en backend y cabecera `Content-Disposition: attachment` para evitar errores 404; carátula de audio contenida dentro de la tarjeta `s.audioBox`.
11. **Añadir a Lista Híbrido (YouThink + YouTube):** modal accesible con o sin sesión activa de Supabase, que lista tanto listas locales/Supabase (`🎵`) como las listas oficiales de la cuenta de YouTube vinculada (`▶️`), agregando ítems directamente vía YouTube Data API v3 con feedback inmediato.
12. **Prevención de Reproducción Simultánea:** arquitectura anti race-condition en Android (`AtomicLong currentRequestId` con corte instantáneo `player.stop()`) y React Native (limpieza preventiva de timeouts y detención sincrónica de motores previos).
13. **Controles Bluetooth Avanzados (Doble Click):** detección de doble toque en botón de reproducción de auriculares y parlantes portátiles para pasar de tema, con anuncio explícito de comandos en `MediaSession.Callback`.
14. **Watchdog de Fin de Canción y Radio Infinita:** sincronización precisa de duración en Web con `durRef`, tope infranqueable para que la barra de tiempo nunca supere la duración real de la pista, captura de eventos `onStateChange` (0 = ENDED), avance suave sin recarga de iframe (`loadVideoById`) y auto-extensión dinámica de las estaciones de radio.
15. **Transmisión a Chromecast (Google Cast Nativo & Servidor Local):** transmisión fluida de video y audio a Smart TVs y dispositivos Chromecast con selector nativo, reconexión automática y controles remotos sincronizados.
16. **Rotación de Pantalla en Modo Video:** alternancia fluida entre orientación vertical y apaisada (landscape) con adaptación dinámica del reproductor y restauración automática al minimizar.
17. **Banner Dinámico de Descarga de APK en Web (`youthink.quepensabas.mov`):** banner superior táctil exclusivo para navegadores (`Platform.OS === 'web' && !esIosSafari`) con badge verde, que consulta automáticamente la API de GitHub Releases (`/releases/latest`) y enlaza a la descarga directa del APK de la última build para celular, mostrando "Descarga directa" y botón `⬇ Bajar`.
18. **Deduplicación Atómica en Radio & Cambio Seguro de Modo Video/Audio:** guard `lastAutoPlayConsumedRef` que impide la doble reproducción al sintonizar radio desde `Sesion.tsx`, y detención incondicional de todos los motores (nativo, web y WebView) con delay de 150ms al conmutar entre audio y video.
19. **Búsqueda Avanzada de Listas y Detección de Álbumes Completos:** integración nativa en InnerTube con `FILTER_PLAYLISTS` (`EgIQAw%3D%3D`), nuevo filtro `📑 Listas` (`type === 'playlists'`), extracción instantánea de canciones de cualquier lista o álbum de YouTube vía `/api/ytplaylist`, reproducción en un toque y etiquetado visual `💿 Álbum Completo` (`isAlbumVideo`) en videos largos que corresponden a discos completos.
20. **Búsqueda Enriquecida de Artistas, Modo Audio Prioritario y Minimización Continua:**
   - **Búsqueda oficial en YouTube Music:** vía cliente `WEB_REMIX` e InnerTube (`searchMusic`), intercalando canciones oficiales en búsquedas generales (`type === 'all'`) y en `type === 'songs'` para asegurar que siempre aparezcan las canciones más escuchadas del artista.
   - **Modo Audio por Defecto:** solo activa modo video si el usuario está en la pestaña `videos` o lo cambió manualmente, impidiendo que canciones con etiqueta `video` fuercen el modo video.
   - **Alternancia sin bloqueos (`setAudio`):** en Web conmuta la vista sin reiniciar el iframe; en Android transfiere suavemente entre motores preservando el segundo exacto (`currentPos`) y actualizando `modoRef`.
   - **Minimización sin corte en celular (`minimizar`):** al minimizar desde modo video en Android, transfiere la reproducción a `QpAudio` en segundo plano para que la música continúe sin interrupciones.
21. **Radio Inteligente con Like/Dislike y Algoritmo de Semillas Distribuidas:**
   - **Botones 👍/👎** visibles solo en modo radio (`autoExtenderRef.current === true`), debajo de los controles en `Buscar.tsx`.
   - **`darLike()`**: agrega ID/artista a Sets `radioLikes`/`radioLikedArtists`, persiste en `AsyncStorage` (`qp_radio_likes`), elimina de dislikes si estaba, toast "👍 Te gusta — más temas así".
   - **`darDislike()`**: agrega a `radioDislikedArtists`, persiste en `qp_radio_dislikes`, auto-skip al siguiente tema tras 600ms, toast "👎 No te gusta — menos temas así".
   - **Toast overlay**: `toastFeedback` state con `mostrarToast()` (auto-oculta 2.8s), renderizado como `position: absolute, bottom: 100`.
   - **Algoritmo `iniciarRadioDesdePlaylist()` con semillas distribuidas:**
     - 3 semillas: inicio, mitad y fin de la playlist → refleja el estilo general, no solo el primer tema.
     - `api.radio()` en paralelo (`Promise.allSettled`) sobre cada semilla.
     - Artistas ponderados por **frecuencia** en la playlist completa (`Map<string, count>`), top 5, búsquedas en batches de 3 en paralelo.
     - Shuffle interno del pool "sin like" para evitar repetición de artistas al inicio.
     - Liked artists van al frente de la cola; disliked IDs y artistas se filtran antes de encolar.
   - **Auto-extensión en `siguiente()` mejorada:** cuando la cola se agota, además de la semilla actual usa una semilla aleatoria de la cola existente para mantener diversidad de estilo.
22. **Listas de reproducción instantáneas (cache-first):**
   - `abrirModalPlaylists()` muestra listas locales al instante (sin spinner) vía `getLocalPlaylists()`, y refresca Supabase + YouTube en segundo plano.
   - `agregarItemAPlaylistYouTube()` actualiza el caché local inmediatamente y luego sincroniza con YouTube Data API v3 con auto-renovación de token.
   - `obtenerItemsPlaylistYouTube()` hace **merge** de items remotos con caché local (en vez de reemplazar), para no perder canciones recién añadidas antes de que YouTube las propague.
23. **Sincronización Total de Listas, Pestaña Radio Dinámica y Limpieza de Interfaz:**
   - **Gestión Unificada de Listas:** `abrirGestionPlaylist` y `borrarDePlaylist` en `Buscar.tsx` soportan de forma transparente tanto listas locales/Supabase como listas oficiales de YouTube (`yt_`), leyendo `obtenerItemsPlaylistYouTube` y sincronizando inmediatamente la caché local sin vacíos. Tanto `addToPlaylist` como `agregarItemAPlaylistYouTube` guardan de forma redundante en ambas estructuras de caché local (`qp_cache_yt_items_` y `qp_local_pl_items_`) colocando las canciones nuevas al inicio (`unshift`).
   - **Pestaña Radio Dinámica & Historial de Descubiertos:** al iniciar una estación de radio (desde una canción o playlist en Play), navega automáticamente a la pestaña `Radio`. En dicha pantalla, mediante `useFocusEffect` se sincroniza la cola de la estación en vivo (`qp_radio_cola`), la estación activa (`qp_radio_estacion_nombre`) y una vista dedicada con pestañas internas para "Estación" y "Descubiertos" (`qp_radio_historial_temas`), permitiendo volver a escuchar o gestionar cualquier tema descubierto.
   - **Eliminación del botón Crossover:** botón retirado de la barra de herramientas del reproductor para simplificar la interfaz visual.

---

## Decisiones Técnicas y Arquitectura Clave (NO ROMPER)

### 1. YouThink Web / PWA (`https://youthink.quepensabas.mov`)
- **Dominio y producción:**
  - URL Primaria: `https://youthink.quepensabas.mov` (alias: `https://yt.quepensabas.mov`)
  - Vercel Team Scope: `quepensabas`
  - Proyecto Vercel principal: `dist` (`prj_a0d5i1UO0rT0pK6ECtUte5k2PIDs`)
  - Build pipeline: Expo Web (`npx expo export -p web` en carpeta `app/`) → despliegue estático de `app/dist`.
  - Proyecto Vercel secundario (monorepo CI): `quepensabas-bajar-app` (`prj_FBf8FxkKwL0SJEqDRMH9WUNYs7iq`) con `rootDirectory: "app"` y `.vercelignore` para evitar intentos de compilación de Docker containers.
- **Banner de Descarga Directa APK Celular:**
  - Implementado en `src/screens/Buscar.tsx` (`apkBanner`).
  - Solo se renderiza en Web (`Platform.OS === 'web' && !esIosSafari`).
  - Consulta en el arranque `https://api.github.com/repos/selloivanluna-lab/youthink/releases/latest` y extrae el asset `.apk` activo.
  - Al hacer push a `main`, GitHub Actions compila y publica el nuevo APK en GitHub Releases con `make_latest: true`. La web se actualiza automáticamente sin tocar código.
- **Modificador de Velocidad y Tempo:**
  - Disponible en el reproductor (botón `⏱️ Velocidad` en la barra de herramientas) con presets rápidos (`0.5x`, `0.75x`, `0.85x`, `0.9x`, `1.0x`, `1.1x`, `1.15x`, `1.25x`, `1.5x`, `1.75x`, `2.0x`) y micro-ajustes (`±0.05x`).
  - En Web: se comanda al iframe de YouTube vía `postMessage({ event: 'command', func: 'setPlaybackRate', args: [rate] })`, aplicándose también a elementos `<video>`/`<audio>` locales y sincronizándose con `MediaSession.playbackRate`.
  - Persistencia automática en `AsyncStorage` (`qp_playback_speed`).
  - Al cargar un nuevo tema o disparar `onReady`/`forzarPlay`, la velocidad configurada se re-aplica automáticamente.
- **Pestaña Tap Tempo (`src/screens/TapTempo.tsx`):**
  - Botón gigante táctil con animación de pulso y amortiguación.
  - Muestreo de los últimos 8 toques con descarte automático tras 2.5s de inactividad para garantizar precisión milimétrica.
  - Metrónomo en tiempo real con oscilador de audio Web Audio (`reproducirClick`, 800Hz/1200Hz) sin dependencias externas.
  - Clasificación por rangos italianos (Largo, Adagio, Andante, Moderato, Allegro, Vivace, Presto) y géneros musicales afines.
  - Calculador de Speed Match: compara el BPM medido contra un BPM objetivo deseado y calcula el factor exacto (ej. 120 → 128 = 1.07x), con botón directo para aplicar ese factor al reproductor en segundo plano.
- **Reproductor Web Persistente e Inmune al Throttling (Safari iOS, Chrome, Brave):**
  - **Problema de Stacking Context:** Los wrappers y pestañas de React Navigation aplican transformaciones CSS que atrapan elementos con `position: fixed`. Si no se escapa, la barra de búsqueda y listas se montan por encima del reproductor.
  - **Solución Portal:** El reproductor web se monta fuera del árbol de React Navigation mediante `(require('react-dom')).createPortal(..., document.body)`.
  - **Problema de Throttling en Safari & Chrome:** Brave tiene "Background Play" nativo y no suspende iframes ocultos. En cambio, Safari (WebKit) y Chrome pausan o suspenden inmediatamente el audio de cualquier `<iframe>` que tenga `opacity < 0.1`, `display: none` o esté fuera del viewport.
  - **Regla de oro de persistencia del Iframe y Jerarquía de z-index (Modales por encima):**
    - El `<iframe>` de YouTube **nunca se desmonta ni se recrea** en React.
    - Vive como nodo fijo dentro del portal de `document.body`.
    - **Jerarquía z-index:** El reproductor Web en pantalla completa se mantiene en `zIndex: 5000` (el iframe en modo video en `zIndex: 5002`, y el mini-reproductor en `zIndex: 5001`), mientras que todos los modales de React Native Web (`div[aria-modal="true"]`, Letras, Info IA, Ecualizador, Velocidad, Playlists) se elevan a `z-index: 110000 !important`. Esto previene que el reproductor o el video tapen las líricas o la información de Gemini. Además, cuando un modal está activo, el iframe recibe `pointerEvents: 'none'` para evitar que intercepte toques o clics.
    - **Al minimizar (`playerVisible = false`):** Se traslada a `bottom: 22, left: 26, width: 44, height: 44` con `opacity: 0.99` y `pointerEvents: 'none'`, quedando visible para el navegador justo detrás del thumbnail del mini-reproductor. El navegador lo detecta dentro de la pantalla y con opacidad real, por lo que **no lo pausa**.
    - **Al expandir (`playerVisible = true`):**
      - En modo video (`modo === 'video'`): Se ubica en el centro (`top: 156, left: 0, right: 0, maxWidth: 720, aspectRatio: 16/9, zIndex: 5002`). La lista interna (`renderPlayerList`) coloca un placeholder de idénticas dimensiones para reservar el espacio sin duplicar el iframe.
      - En modo audio (`modo === 'audio'`): Permanece en `bottom: 22, left: 26, width: 44, height: 44, zIndex: 4999, opacity: 0.99`, cubierto limpiamente por el overlay del reproductor y la carátula de 220x220px.
- **Audio Silencioso looped (Desbloqueo de Safari iOS y sesión continua):**
  - Safari iOS exige que haya un `<audio>` HTML5 reproduciéndose con duración real para mantener la `AVAudioSession` del sistema activa cuando el usuario minimiza el navegador o bloquea la pantalla.
  - Un audio de 0 bytes o base64 vacío termina inmediatamente y Safari corta la sesión.
  - **Solución implementada (`generarWavSilencioUrl`):** Se genera en memoria un archivo WAV PCM 8-bit a 8000Hz de 2 segundos (16.000 muestras de puro silencio, valor 128) encapsulado en un `Blob` (`URL.createObjectURL`).
  - Se reproduce en `loop` a volumen `0.01` tras el primer gesto del usuario (`unlockWebAudio`).
- **MediaSession API (Controles en Pantalla Bloqueada / Lock Screen):**
  - Gracias al audio silencioso en loop, el sistema operativo (iOS y Android) habilita el widget multimedia en pantalla bloqueada.
  - Handlers registrados: `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekforward`, `seekbackward`.
  - Sincronización continua de posición con `navigator.mediaSession.setPositionState({ duration, position, playbackRate: 1 })`.
  - Estados dinámicos: `navigator.mediaSession.playbackState` pasa a `'playing'`, `'paused'` o `'none'` según corresponda.
- **Parámetro `origin` en YouTube Embed:**
  - El embed URL de YouTube en web DEBE incluir `&origin=${encodeURIComponent(window.location?.origin || '')}` para que YouTube IFrame API active los eventos `onReady` e `infoDelivery`, necesarios para desmutear (`unMute`) automáticamente y reportar el progreso de reproducción.
- **Cambio de Pista, Crossover por Defecto y Reproducción Continua en Segundo Plano (PC y Móvil):**
  - **Crossover con Atenuación Real de Volumen:** Activado por defecto (`crossover = true`). En pistas de duración >15s, ejecuta un fade out real y progresivo durante los últimos 4 segundos (a falta de 4s baja a 70%, a 2.8s baja a 40%, a 1.6s baja a 15% y a 0.5s baja a 0%), activando la pista siguiente a los `dur - 0.5s` sin cortes abruptos en el audio. Al comenzar el tema nuevo, realiza una rampa suave de entrada (40% → 75% → 100%) durante el primer segundo. Si el usuario desactiva el crossover, la pista suena al 100% hasta su final natural (`dur - 0.5s` o evento `ended`).
  - **Reproducción Continua en Segundo Plano en PC (Anti-Muteo):** Al pasar de tema en Web, NUNCA se emite `stopVideo` o `pauseVideo` al iframe antes de `loadVideoById`. Emitir detenciones previas rompe la sesión de audio continuo en el navegador, provocando que Chrome aplique su política de autoplay en segundo plano y mutee la ventana secundaria. Al llamar directamente a `loadVideoById`, el flujo de sonido es ininterrumpido. Además, si el navegador reporta `muted === true`, se responde de inmediato con `unMute` y restaurando el volumen.
  - **Validación de Video ID y Descarte Seguro de Tiempos Residuales (`currentTrackIdRef` & `hasStartedPlayingCurrentTrackRef`):** Durante el cambio de pista, el iframe de YouTube puede tardar 1–2s en descargar el video viejo. Se descarta cualquier mensaje cuyo `video_id` no coincida con `currentTrackIdRef.current`. Además, se ignoran valores de `currentTime > 2s` hasta que el nuevo track haya confirmado inicio (`hasStartedPlayingCurrentTrackRef.current` o `playerState === 1`). Esto evita que la posición residual del tema previo contamine `pos` y bloquee la barra de progreso al final.
  - **Modo Audio por Defecto y Sincronía Total:** YouThink inicia por defecto en modo Audio (`soloAudio = true`, `modo = 'audio'`). La variable `audioRef.current` se sincroniza instantáneamente al conmutar el modo o leer `AsyncStorage`, y todas las rutas de navegación (pantalla de Sesión, Radio, Historial, Búsqueda) leen `audioRef.current`, garantizando que ninguna canción se inicie en modo Video por capturas de cierre obsoletas.
  - **Avance Fluido y Calibración del Reproductor Web:** La API IFrame de YouTube no emite `currentTime` de forma continua a alta frecuencia vía `postMessage`. Por ello, un temporizador local (`setInterval` cada 400ms) avanza `pos` con un paso suave de `0.4 * velocidadRef.current` una vez que `hasStartedPlayingCurrentTrackRef.current` es verdadero, calibrando la posición exacta cada vez que YouTube envía un paquete `infoDelivery` verificado. Esto garantiza que la barra de progreso siempre avance con total fluidez visual desde el segundo 0:00.

---

### 2. Módulo Nativo Android: `qp-audio` (NewPipeExtractor + Media3 ExoPlayer)
- **Ubicación:** `app/modules/qp-audio/android/`
- **Por qué:** YouTube bloquea las IPs de datacenters en servicios en la nube (Render, Fly.io, Vercel) arrojando errores como `HTTP 403`, `Sign in to confirm you are not a bot` o requiriendo PO Tokens.
- **Solución nativa:** La resolución de streams de audio (`resolveAudio`) y video (`resolveVideo`) se ejecuta **directamente en el dispositivo del usuario** (IP residencial) mediante `NewPipeExtractor v0.26.5` (`QpResolver.kt`).
- **Servicio en segundo plano:** `QpPlayerService.kt` corre como `ForegroundService` de Android con Media3 ExoPlayer, soportando controles en la barra de notificaciones y pantalla de bloqueo.
- **Botones Multimedia y Parlantes Bluetooth:** `MediaSession.Callback` personalizado en `QpPlayerService.kt`:
  - Habilita explícitamente `COMMAND_SEEK_TO_NEXT`, `COMMAND_SEEK_TO_NEXT_MEDIA_ITEM`, `COMMAND_SEEK_TO_PREVIOUS` y `COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM` en `onConnect` para que el stack Bluetooth y el sistema reconozcan que la app soporta saltos (por defecto ExoPlayer los deshabilita si su timeline tiene solo 1 item).
  - Intercepta comandos `onPlayerCommandRequest` (`COMMAND_SEEK_TO_NEXT`/`PREVIOUS`) y eventos de teclado `onMediaButtonEvent` (`KEYCODE_MEDIA_NEXT`, `KEYCODE_MEDIA_PREVIOUS`, `KEYCODE_HEADSETHOOK`, `KEYCODE_MEDIA_PLAY_PAUSE`).
  - Detecta doble-click en el botón de reproducción del parlante/auricular (intervalo <350ms) para saltar automáticamente a la siguiente canción (`action: "next"` en `QpEvents`).
  - En React Native (`Buscar.tsx`), si la cola se termina o solo había 1 tema sonando, `siguiente` salta automáticamente al primer tema de las recomendaciones para no cortar la música.
- **Prevención de Audio Simultáneo y Deduplicación:**
  - En `QpPlayerService.kt`, se mantiene un contador atómico `currentRequestId = AtomicLong(0)`.
  - Al recibir `playVideo(url, id, title, ...)`, se detiene de inmediato el reproductor previo (`player?.stop(); player?.clearMediaItems()`) en el hilo principal antes de arrancar la extracción asíncrona de NewPipe.
  - Al completar la extracción asíncrona, si el `reqId` no coincide con `currentRequestId.get()`, se descarta el stream viejo para evitar que suene en paralelo al tema nuevo.
  - En `Buscar.tsx`:
    - `lastAutoPlayConsumedRef` guarda la clave única del tema y parámetros para que el `useEffect` de autoPlay no se dispare dos veces por render o por retraso en el consumo de params de navegación.
    - En `iniciarRadioDesdePlaylist`: la cola asíncrona solo se actualiza si `colaRef.current.length <= 1`, garantizando que si el usuario navegó a otro tema mientras cargaba la radio, la llamada remota no pise la pista activa.
    - En `setAudio(v)`: se detienen sincrónicamente y sin excepciones todos los motores (`native.pause()`, `native.stop()`, `player.pause()`, `webViewCmd(...)`), actualizando `usarNativoRef.current` de inmediato y aplicando un delay de 150ms para que ExoPlayer libere el audio focus del sistema operativo.
- **Expo Module Bridge:** Expuesto a JS mediante `QpAudioModule.kt` con métodos `resolveAudio`, `resolveVideo`, `play`, `togglePlay`, `pause`, `resume`, `seek`, `stop`, `setEq`.

---

### 3. Autenticación y YouTube Data API (Independencia de Supabase)
- **Problema resuelto:** Supabase comparte el proyecto y clientes OAuth con la productora y alumnos (*Qué Pensabas*, *Qué Estudiabas*). Modificar el Google OAuth en Supabase afectaría las demás plataformas.
- **Solución implementada:** **Flujo OAuth Directo de YouThink:**
  - Proyecto de Google Cloud propio: `gen-lang-client-0079659925` (`YouThink App`).
  - Client ID: `74282824783-2r4cqfks9u5vgpmgap09o7jk0dvpq622.apps.googleusercontent.com`
  - Scope: `https://www.googleapis.com/auth/youtube.readonly`
  - Puente OAuth en Render: `https://youthink-1.onrender.com/oauth/callback`
  - Redirección nativa deep link: `youthink://oauth2redirect`
  - Token de acceso guardado en `AsyncStorage` (`qp_yt_access_token`) para persistencia sin re-login.

---

### 4. Modal "Añadir a lista" (Ecosistema Híbrido)
- **Carga de Listas (`abrirModalPlaylists` en `Buscar.tsx`):**
  - No bloquea al usuario si no tiene sesión de Supabase: carga listas locales con `getPlaylists()`.
  - Si existe un token de YouTube (`qp_yt_access_token`), consulta en paralelo `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true` para mostrar las listas oficiales de YouTube del usuario.
  - Cada ítem del modal muestra si es de YouTube (`▶️`) o de YouThink (`🎵`), junto a la cantidad de videos o canciones que contiene.
- **Inserción en Lista (`agregarALista`):**
  - Si es una lista de YouThink: agrega a `AsyncStorage` y Supabase (si está autenticado).
  - Si es una lista de YouTube (`yt_`): agrega el ítem llamando a la API de YouTube (`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet`) e invalida/actualiza el caché local `qp_yt_pl_cache_${playlistId}`.
  - Emite alerta visual clara confirmando que se añadió a la lista seleccionada.

---

### 5. Backend en Render (`youthink-1.onrender.com`)
- **Repositorio:** `server/src/index.js`
- **Rutas clave:**
  - `/api/health`: Chequeo de salud y commit activo.
  - `/api/ytsearch`: Búsqueda de videos mediante `yt-dlp` y runtime `deno`.
  - `/oauth/callback`: Recibe el hash OAuth de Google en navegador móvil y lo redirige automáticamente a `youthink://oauth2redirect`.
  - `/`, `/privacidad`, `/terminos`: Páginas oficiales con texto legal exhaustivo requeridas para la Verificación Oficial de Google OAuth.

---

### 6. Base de Datos Supabase (Playlists de YouThink)
- **Proyecto:** `prixtmnilittshdegrxq.supabase.co`
- **Tablas:**
  - `youthink_playlists`: `id` (text), `nombre` (text), `user_id` (uuid references auth.users), `created_at` (timestamptz).
  - `youthink_playlist_items`: `id` (text), `playlist_id` (text references youthink_playlists), `yt_id` (text), `title`, `channel`, `thumb`, `duration`, `added_at`.
- **Fusión híbrida:** `getPlaylists()` en `app/src/lib/playlists.ts` combina listas locales con las de Supabase, evitando pérdida de datos por race conditions de sesión.

---

### 7. Google Cast / Chromecast (`app/src/lib/cast.ts` & `CastButtonHost.tsx`)
- **Dependencia nativa:** `react-native-google-cast v4.9.1`.
- **Regla de oro de ciclo de vida (Separación de suscripciones):**
  - `sessionSubsRef`: Aloja los listeners del ciclo de vida general (`CastContext` y `SessionManager`). Se crean en el mount de `useCast()` y **solo se destruyen al desmontar la app completa**.
  - `clientSubsRef`: Aloja exclusivamente los eventos del cliente de medios activo (`onMediaStatusUpdated`, `onMediaPlaybackEnded`). Se limpian dinámicamente con `limpiarCliente()` al cambiar de pista o desconectar.
- **Botón nativo `CastButtonHost`:** vive invisible como `<CastButtonHost style={{ width: 1, height: 1 }} />` montado persistentemente en `Buscar.tsx`.
- **Bucle de carga paciente (`cargarEnTv`):** ejecuta reintentos continuos con límite de 35 segundos regenerando URLs frescas de stream.

---

### 8. Rotación de Pantalla en Modo Video (`expo-screen-orientation`)
- **Librería:** `expo-screen-orientation ~57.0.3`.
- Botón directo `🔄 Rotar / 📱 Vertical` en la cabecera del reproductor maximizado (`modalHead`), barra de herramientas (`toolsRow`) y flotante sobre el video.
- Al activar bloquea en `LANDSCAPE`. Al minimizar o cerrar restaura a `PORTRAIT_UP`.
- Al desmontar la pantalla de búsqueda, llama a `ScreenOrientation.unlockAsync()`.

---

### 9. Las Dos Ramas Activas Independientes (Celular vs TV)
- **Objetivo:** Mantener dos builds perfectamente diferenciados y optimizados sin interferir entre sí:
  1. **Rama `main` (Celular / Móvil):**
     - Orientación vertical default con rotación táctil.
     - Todas las pestañas habilitadas (Play, Sesión, Radio, Tempo, Library Crew, Descargas).
     - ForegroundService de Android activo para audio con pantalla apagada.
     - Build pipeline automatizado con GitHub Actions que compila APK standalone y publica a GitHub Releases con `make_latest: true`.
     - Build 98 (versionCode 25).
  2. **Rama `proyector-tv` (Proyector Android TV / Magcubic HY300 1GB RAM):**
     - Interfaz simplificada con solo 2 pestañas: **Play** (`Buscar.tsx`) y **Sesión** (`Sesion.tsx`).
     - **Modo Cine Exclusivo:** Early return en React Native que desmonta todo el árbol al reproducir video, reduciendo el consumo de RAM de 350MB a 40MB y evitando ANRs.
     - TabBar oculta dinámicamente durante la reproducción.
     - Resolución fijada a 360p y subtítulos desactivados por defecto para máxima fluidez.
     - D-pad / Cruceta de control remoto con halos dorados interactivos (`<TvPressable>`).
     - Build 97 local (`youthink-v0.2.7-tv-build-97.apk`).

---

## Rutas y Repositorios

- **Código Fuente YouThink:** `C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app\`
- **GitHub Repo:** `selloivanluna-lab/youthink` (rama `main`)
- **CI / Build Pipeline:** GitHub Actions (`.github/workflows/build-android.yml`)
  - Compila con Gradle en release mode y genera artefactos: `youthink-v{version}-build-{run_number}.apk`.
  - Publica automáticamente a GitHub Releases con tag `apk-v{version}-{run_number}`.
  - URL Releases: `https://github.com/selloivanluna-lab/youthink/releases`
  - URL Runs: `https://github.com/selloivanluna-lab/youthink/actions`

---

## Comandos de Mantenimiento Frecuentes

### Commitear cambios en Celular y disparar nueva compilación de APK:
```powershell
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" add .
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" commit -m "feat/fix: descripcion del cambio"
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" push origin main
```

### Consultar estado del último APK en GitHub Actions:
```powershell
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/selloivanluna-lab/youthink/actions/runs?per_page=1&branch=main" -Headers @{"User-Agent"="YouThink-CI"}
Write-Output "Run #$($r.workflow_runs[0].run_number) | Status: $($r.workflow_runs[0].status) | Conclusion: $($r.workflow_runs[0].conclusion)"
```

### Compilar y desplegar versión Web a producción (Vercel):
```powershell
Set-Location "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app\app"
npx tsc --noEmit
npx expo export -p web
Set-Location ".."
git add .
git commit -m "feat(web): descripcion del cambio"
git push origin main
npx --yes vercel app/dist --prod --yes --scope quepensabas
npx --yes vercel alias dist-<id>-quepensabas.vercel.app youthink.quepensabas.mov --scope quepensabas
```
