---
name: youthink
description: Documentación y referencia técnica completa de la app YouThink (quepensabas-bajar-app). Cubre arquitectura híbrida (React Native / Expo + módulo nativo Android qp-audio con NewPipeExtractor), reproducción en segundo plano con ExoPlayer, extracción de audio/video sin bloqueo de bots (IP residencial), integración OAuth independiente con YouTube Data API v3, sincronización de playlists (locales y Supabase) y páginas legales de verificación Google Cloud. Usar para tareas de mantenimiento, compilación de APKs, features y bugs en YouThink.
---

# YouThink — App Móvil de Música, Video y Listas de YouTube

## Qué es
**YouThink** es la aplicación móvil para Android/iOS del ecosistema Qué Pensabas que permite:
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

---

## Decisiones Técnicas y Arquitectura Clave (NO ROMPER)

### 1. YouThink Web / PWA (`https://youthink.quepensabas.mov`)
- **Dominio y producción:**
  - URL Primaria: `https://youthink.quepensabas.mov` (alias: `https://yt.quepensabas.mov`)
  - Vercel Team Scope: `quepensabas`
  - Build pipeline: Expo Web (`npx expo export -p web` en carpeta `app/`) → despliegue estático de `app/dist`.
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
  - **En Android APK:** Al presionar `⏭` (o `⏮`), el handler recibe el evento de click (objeto); `siguiente()` y `anterior()` deben llamar SIEMPRE a `aplicar` con `autoPlay = true`. De lo contrario, `if (autoPlay) await native.play(...)` no se ejecuta y ExoPlayer continúa reproduciendo el audio del tema anterior.
  - **En Web (Cero recarga de iframe y persistencia de mediaUri):** Modificar el atributo `src` en un `<iframe>` existente recarga el documento y es bloqueado por las políticas de autoplay de Safari/Chrome. Cuando el iframe ya está montado, se conserva el nodo y se emite `loadVideoById(item.id)` vía `postMessage` a la API IFrame de YouTube, manteniendo la reproducción instantánea y continua. Además, en Web `mediaUri` NUNCA se resetea a `null` al aplicar un nuevo tema, ya que `!mediaUri` provocaría que el render limpie el iframe a `about:blank` y muestre el indicador de carga infinitamente.
  - **Modo Radio Infinito:** `ytmusic_radio.py` parsea la duración textual (`MM:SS` o `HH:MM:SS`) a segundos numéricos cuando `length_seconds` no viene del endpoint. Cuando el usuario se aproxima a los últimos 2 temas de la cola (`i >= c.length - 2`), `siguiente` solicita automáticamente un nuevo lote de canciones afines a `api.radio` para extender la cola dinámicamente y hacer la radio verdaderamente infinita.
  - Actualizar `idxRef.current = idx` inmediatamente en `aplicar()` para que saltos rápidos de cola no lean un índice desfasado.

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
- **Prevención de Audio Simultáneo (Race Condition Fix):**
  - En `QpPlayerService.kt`, se mantiene un contador atómico `currentRequestId = AtomicLong(0)`.
  - Al recibir `playVideo(url, id, title, ...)`, se detiene de inmediato el reproductor previo (`player?.stop(); player?.clearMediaItems()`) en el hilo principal antes de arrancar la extracción asíncrona de NewPipe.
  - Al completar la extracción asíncrona, si el `reqId` no coincide con `currentRequestId.get()`, se descarta el stream viejo para evitar que suene en paralelo al tema nuevo.
  - En `Buscar.tsx`, `forzarPlay` y `aplicar` cancelan todos los temporizadores previos (`forzarPlayTimersRef.current.forEach(clearTimeout)`) y pausan/detienen tanto `native` como web `<video>`/`<iframe>` antes de iniciar el nuevo track.
- **Expo Module Bridge:** Expuesto a JS mediante `QpAudioModule.kt` con métodos `resolveAudio`, `resolveVideo`, `play`, `togglePlay`, `pause`, `resume`, `seek`, `stop`, `setEq`.

### 3. Autenticación y YouTube Data API (Independencia de Supabase)
- **Problema resuelto:** Supabase comparte el proyecto y clientes OAuth con la productora y alumnos (*Qué Pensabas*, *Qué Estudiabas*). Modificar el Google OAuth en Supabase afectaría las demás plataformas.
- **Solución implementada:** **Flujo OAuth Directo de YouThink:**
  - Proyecto de Google Cloud propio: `gen-lang-client-0079659925` (`YouThink App`).
  - Client ID: `74282824783-2r4cqfks9u5vgpmgap09o7jk0dvpq622.apps.googleusercontent.com`
  - Scope: `https://www.googleapis.com/auth/youtube.readonly`
  - Puente OAuth en Render: `https://youthink-1.onrender.com/oauth/callback`
  - Redirección nativa deep link: `youthink://oauth2redirect`
  - Token de acceso guardado en `AsyncStorage` (`qp_yt_access_token`) para persistencia sin re-login.

### 4. Modal "Añadir a lista" (Ecosistema Híbrido)
- **Carga de Listas (`abrirModalPlaylists` en `Buscar.tsx`):**
  - No bloquea al usuario si no tiene sesión de Supabase: carga listas locales con `getPlaylists()`.
  - Si existe un token de YouTube (`qp_yt_access_token`), consulta en paralelo `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true` para mostrar las listas oficiales de YouTube del usuario.
  - Cada ítem del modal muestra si es de YouTube (`▶️`) o de YouThink (`🎵`), junto a la cantidad de videos o canciones que contiene.
- **Inserción en Lista (`agregarALista`):**
  - Si es una lista de YouThink: agrega a `AsyncStorage` y Supabase (si está autenticado).
  - Si es una lista de YouTube (`yt_`): agrega el ítem llamando a la API de YouTube (`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet`) e invalida/actualiza el caché local `qp_yt_pl_cache_${playlistId}`.
  - Emite alerta visual clara confirmando que se añadió a la lista seleccionada.

### 5. Backend en Render (`youthink-1.onrender.com`)
- **Repositorio:** `server/src/index.js`
- **Rutas clave:**
  - `/api/health`: Chequeo de salud y commit activo.
  - `/api/ytsearch`: Búsqueda de videos mediante `yt-dlp` y runtime `deno`.
  - `/oauth/callback`: Recibe el hash OAuth de Google en navegador móvil y lo redirige automáticamente a `youthink://oauth2redirect`.
  - `/`, `/privacidad`, `/terminos`: Páginas oficiales con texto legal exhaustivo requeridas para la Verificación Oficial de Google OAuth.

### 6. Base de Datos Supabase (Playlists de YouThink)
- **Proyecto:** `prixtmnilittshdegrxq.supabase.co`
- **Tablas:**
  - `youthink_playlists`: `id` (text), `nombre` (text), `user_id` (uuid references auth.users), `created_at` (timestamptz).
  - `youthink_playlist_items`: `id` (text), `playlist_id` (text references youthink_playlists), `yt_id` (text), `title`, `channel`, `thumb`, `duration`, `added_at`.
- **Fusión híbrida:** `getPlaylists()` en `app/src/lib/playlists.ts` combina listas locales con las de Supabase, evitando pérdida de datos por race conditions de sesión.

### 7. Google Cast / Chromecast (`app/src/lib/cast.ts` & `CastButtonHost.tsx`)
- **Dependencia nativa:** `react-native-google-cast v4.9.1`.
- **Regla de oro de ciclo de vida (Separación de suscripciones):**
  - **Causa raíz del bug histórico ("el Chromecast abre la pantalla azul pero no reproduce a la primera salvo reiniciando la app"):**
    - En el mount de `useCast()`, se registraban los listeners del ciclo de vida nativo de la sesión (`onSessionStarted`, `onSessionResumed`, `onSessionEnded`, `onCastStateChanged`) en `subsRef`.
    - Al final del mount se ejecutaba `refrescar(true)` para detectar si ya había un dispositivo conectado. Esa función llamaba a `limpiarCliente()`, la cual borraba `subsRef.current` y eliminaba **todos los listeners del CastContext y SessionManager** recién creados.
    - Como resultado, cuando el usuario tocaba el botón de Cast y seleccionaba su TV en el diálogo nativo, el receptor web se cargaba en el TV pero JavaScript nunca recibía el evento `onSessionStarted`, dejando `tv.conectado = false` y evitando que el reproductor le enviara la orden `loadMedia` al televisor. Al reiniciar la app, el televisor ya tenía la sesión viva y la levantaba en la carga inicial.
  - **Solución definitiva:** Separación estricta de dos referencias de suscripciones:
    - `sessionSubsRef`: Aloja los listeners del ciclo de vida general (`CastContext` y `SessionManager`). Se crean en el mount de `useCast()` y **solo se destruyen al desmontar la app completa**.
    - `clientSubsRef`: Aloja exclusivamente los eventos del cliente de medios activo (`onMediaStatusUpdated`, `onMediaPlaybackEnded`). Se limpian dinámicamente con `limpiarCliente()` al cambiar de pista o desconectar.
- **Botón nativo `CastButtonHost`:**
  - El SDK nativo de Google Cast requiere que un componente `<CastButton>` exista montado en el árbol de render de Android para que `CastContext.showCastDialog()` funcione de forma fiable.
  - Vive invisible como `<CastButtonHost style={{ width: 1, height: 1 }} />` montado persistentemente en `Buscar.tsx`.
- **Bucle de carga paciente (`cargarEnTv`):**
  - El receptor web del Chromecast (Default Media Receiver) puede demorar entre 5 y 20 segundos en iniciar en frío. `cargarEnTv` ejecuta reintentos continuos con un límite de 35 segundos, regenerando URLs frescas de stream para evitar caducidad de firmas de YouTube.

### 8. Rotación de Pantalla en Modo Video (`expo-screen-orientation`)
- **Librería:** `expo-screen-orientation ~57.0.3` (autolinked en Android, fallback para Web vía `window.screen.orientation`).
- **Comportamiento:**
  - Botón directo `🔄 Rotar / 📱 Vertical` en la cabecera del reproductor maximizado (`modalHead`), en la barra de herramientas (`toolsRow`), y flotante sobre la vista de video.
  - Al activar, bloquea la orientación en `ScreenOrientation.OrientationLock.LANDSCAPE`.
  - El modal y el contenedor de video amplían su altura a 320px/proporcional, reduciendo márgenes para aprovechar la pantalla completa.
  - Al minimizar (`minimizar()`) o cerrar (`cerrar()`) el reproductor, se restablece automáticamente a `ScreenOrientation.OrientationLock.PORTRAIT_UP`.
  - Al desmontar la pantalla de búsqueda, se llama a `ScreenOrientation.unlockAsync()`.

---

## Rutas y Repositorios

- **Código Fuente YouThink:** `C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app\`
- **GitHub Repo:** `selloivanluna-lab/youthink` (rama `main`)
- **CI / Build Pipeline:** GitHub Actions (`.github/workflows/build-apk.yml`)
  - Compila con Gradle en release mode y genera artefactos: `youthink-app-{run_number}` (~38 MB).
  - URL Runs: `https://github.com/selloivanluna-lab/youthink/actions`

---

## Flujo de Pantalla Sesión (`Sesion.tsx`)
1. **Mis Listas de Reproducción:**
   - Creación directa con campo de texto y botón `➕ Crear`.
   - Consulta remota filtrada por `user_id` con fallback local.
2. **Mis Listas de YouTube:**
   - Botón rojo *Vincular cuenta de YouTube* (abre flujo directo con Google).
   - Botón *Desconectar* para revocar y limpiar storage local.
   - Listas expandibles: al tocar una lista consulta `playlistItems` en YouTube Data API v3.
   - Cada tema muestra miniatura, título y canal. Al tocar un tema salta al reproductor (`autoPlayId`) en la pestaña *Buscar*.

---

## Comandos de Mantenimiento Frecuentes

### Commitear cambios y disparar nueva compilación de APK:
```powershell
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" add .
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" commit -m "feat/fix: descripcion del cambio"
git -C "C:\Users\Sello\.config\opencode\proyectos\quepensabas-bajar-app" push origin main
```

### Consultar estado del último APK en GitHub Actions:
```powershell
$r = Invoke-RestMethod -Uri "https://api.github.com/repos/selloivanluna-lab/youthink/actions/runs?per_page=1" -Headers @{"User-Agent"="YouThink-CI"}
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
# Si se requiere reasociar el alias:
# npx --yes vercel alias <deployment-url> youthink.quepensabas.mov --scope quepensabas
```
