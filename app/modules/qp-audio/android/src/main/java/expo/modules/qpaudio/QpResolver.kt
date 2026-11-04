package expo.modules.qpaudio

import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.stream.AudioStream

// Resuelve la mejor URL de audio de un video de YouTube desde el propio celular.
object QpResolver {
  @Volatile
  private var initialized = false

  class Result(
    val url: String,
    val title: String,
    val bitrate: Int,
    val mime: String,
  )

  class VideoResult(
    val url: String,
    val title: String,
    val resolution: String,
    val mime: String,
    val audioUrl: String = "",   // Si vacío, el stream ya tiene audio (muxed)
    val audioMime: String = "",
  )

  @Synchronized
  private fun ensureInit() {
    if (initialized) return
    NewPipe.init(QpDownloader(), Localization("es", "AR"), ContentCountry("AR"))
    initialized = true
  }

  fun resolveAudio(videoId: String): Result {
    ensureInit()
    val extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=$videoId")
    extractor.fetchPage()

    val best = extractor.audioStreams
      .filter { it.content.isNotEmpty() }
      // Preferimos m4a/AAC (reproduce en Android y iOS), luego el de mayor bitrate.
      .sortedWith(
        compareByDescending<AudioStream> { it.format?.name?.contains("M4A", ignoreCase = true) == true }
          .thenByDescending { it.averageBitrate }
      )
      .firstOrNull()
      ?: throw IllegalStateException("sin streams de audio para $videoId")

    return Result(
      url = best.content,
      title = extractor.name,
      bitrate = best.averageBitrate,
      mime = best.format?.mimeType ?: "audio/mp4",
    )
  }

  fun resolveVideo(videoId: String): VideoResult {
    ensureInit()
    val extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=$videoId")
    extractor.fetchPage()

    // 1. Intentar stream muxed (video+audio en un solo archivo).
    //    YouTube sirve muxed hasta 480p — suficiente para el proyector 1280x720.
    //    Priorizar: 720p muxed → 480p muxed → 360p muxed
    val muxed = extractor.videoStreams
      .filter { it.content.isNotEmpty() }
      .sortedWith(
        compareBy {
          val res = it.resolution ?: ""
          when {
            res.contains("720") -> 0
            res.contains("480") -> 1
            res.contains("360") -> 2
            else -> 3
          }
        }
      )
      .firstOrNull()

    if (muxed != null) {
      return VideoResult(
        url = muxed.content,
        title = extractor.name,
        resolution = muxed.resolution ?: "480p",
        mime = muxed.format?.mimeType ?: "video/mp4",
        audioUrl = "",   // Ya tiene audio incluido
        audioMime = "",
      )
    }

    // 2. No hay muxed: usar video-only DASH 720p + audio separado.
    //    Ambas URLs se pasan al reproductor para que haga el merge.
    val videoOnly = extractor.videoOnlyStreams
      .filter { it.content.isNotEmpty() }
      .sortedWith(
        compareBy {
          val res = it.resolution ?: ""
          when {
            res.contains("720") -> 0
            res.contains("1080") -> 1
            res.contains("480") -> 2
            else -> 3
          }
        }
      )
      .firstOrNull()
      ?: throw IllegalStateException("sin streams de video para $videoId")

    // Resolver también el audio para hacer merge
    val audio = extractor.audioStreams
      .filter { it.content.isNotEmpty() }
      .sortedWith(
        compareByDescending<AudioStream> { it.format?.name?.contains("M4A", ignoreCase = true) == true }
          .thenByDescending { it.averageBitrate }
      )
      .firstOrNull()

    return VideoResult(
      url = videoOnly.content,
      title = extractor.name,
      resolution = videoOnly.resolution ?: "720p",
      mime = videoOnly.format?.mimeType ?: "video/mp4",
      audioUrl = audio?.content ?: "",
      audioMime = audio?.format?.mimeType ?: "audio/mp4",
    )
  }
}
