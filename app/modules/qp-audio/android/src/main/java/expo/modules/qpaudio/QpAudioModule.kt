package expo.modules.qpaudio

import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class QpAudioModule : Module() {

  private val reactContext
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // Arranca el servicio si hace falta y espera a que esté listo.
  // Corre en el hilo del AsyncFunction (IO), no bloquea el main thread.
  private fun ensureService(): QpPlayerService {
    if (QpBridge.service == null) {
      try {
        val intent = Intent(reactContext, QpPlayerService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
          reactContext.startForegroundService(intent)
        } else {
          reactContext.startService(intent)
        }
      } catch (_: Throwable) {}
      val deadline = System.currentTimeMillis() + 6000
      while (System.currentTimeMillis() < deadline) {
        QpBridge.service?.let { return it }
        Thread.sleep(40)
      }
    }
    return QpBridge.service
      ?: run {
        // El servicio no arrancó: notificamos al JS con un mensaje claro.
        QpEvents.push(
          mapOf(
            "resolving" to false,
            "buffering" to false,
            "isPlaying" to false,
            "error" to "Servicio de audio no disponible. Cerrá y abrí la app."
          )
        )
        throw Exception("servicio de audio no disponible")
      }
  }


  override fun definition() = ModuleDefinition {
    Name("QpAudio")

    Events("onPlaybackState")

    OnStartObserving {
      QpEvents.listener = { state ->
        try {
          this@QpAudioModule.sendEvent("onPlaybackState", state)
        } catch (_: Throwable) {}
      }
    }

    OnStopObserving {
      QpEvents.listener = null
    }

    // Devuelve la mejor URL de audio de un video de YouTube, extraída desde el celular.
    AsyncFunction<Map<String, Any?>, String>("resolveAudio") { videoId ->
      val r = QpResolver.resolveAudio(videoId)
      mapOf(
        "url" to r.url,
        "title" to r.title,
        "bitrate" to r.bitrate,
        "mime" to r.mime,
        "userAgent" to QpDownloader.USER_AGENT
      )
    }

    // Devuelve la mejor URL de video de un video de YouTube, extraída desde el celular (sin bots ni servidores cloud).
    AsyncFunction<Map<String, Any?>, String>("resolveVideo") { videoId ->
      val r = QpResolver.resolveVideo(videoId)
      mapOf(
        "url" to r.url,
        "title" to r.title,
        "resolution" to r.resolution,
        "mime" to r.mime,
        "userAgent" to QpDownloader.USER_AGENT
      )
    }

    // URL local (LAN) para el Chromecast. El TV le pide el stream al teléfono y
    // el teléfono lo reenvía: evita que el receptor choque con el bloqueo de
    // YouTube a la IP/headers del teléfono (eso dejaba el logo y el spinner).
    AsyncFunction<Map<String, Any?>, String, String, Boolean>("castUrl") { videoId, kind, fresh ->
      QpCastServer.prepare(videoId, if (kind == "audio") "audio" else "video", fresh == true)
    }

    // Autoprueba del servidor local (sin TV): resuelve y descarga 64 KB.
    AsyncFunction<Map<String, Any?>, String, String>("castSelfTest") { videoId, kind ->
      QpCastServer.selfTest(videoId, if (kind == "audio") "audio" else "video")
    }

    // Estadísticas: cuántas veces el TV pidió el medio (0 = no llegó al teléfono).
    AsyncFunction<Map<String, Any?>>("castStats") {
      QpCastServer.stats()
    }

    AsyncFunction<Boolean>("castResetStats") {
      QpCastServer.resetStats()
      true
    }

    // Mantiene el proceso vivo mientras se transmite al TV (servicio en primer
    // plano), así el servidor HTTP local sigue sirviendo aunque se apague la
    // pantalla del teléfono.
    AsyncFunction<Boolean, Boolean>("castKeepAlive") { activo ->
      try {
        if (activo) {
          val svc = ensureService()
          svc.setCastMode(true)
        } else {
          QpBridge.service?.setCastMode(false)
        }
        true
      } catch (_: Throwable) {
        false
      }
    }

    // Reproduce un video por su id (resuelve la URL y suena en segundo plano).
    AsyncFunction<Boolean, String, String, String, String>("play") { videoId, title, artist, artworkUri ->
      val svc = ensureService()
      svc.applyEq(QpBridge.pendingGains)
      svc.playVideo(videoId, title, artist, artworkUri)
      true
    }

    AsyncFunction<Boolean>("togglePlay") {
      QpBridge.service?.togglePlay()
      true
    }

    AsyncFunction<Boolean>("pause") {
      QpBridge.service?.pause()
      true
    }

    AsyncFunction<Boolean>("resume") {
      QpBridge.service?.resume()
      true
    }

    AsyncFunction<Boolean, Double>("seek") { seconds ->
      QpBridge.service?.seek(seconds)
      true
    }

    AsyncFunction<Boolean, Double>("setSpeed") { speed ->
      QpBridge.service?.setSpeed(speed)
      true
    }

    AsyncFunction<Boolean>("stop") {
      QpBridge.service?.stopPlayback()
      true
    }

    AsyncFunction<Boolean, String>("setEq") { preset ->
      val gains = QpPresets.gains(preset)
      QpBridge.pendingGains = gains
      QpBridge.service?.applyEq(gains)
      true
    }
  }
}
