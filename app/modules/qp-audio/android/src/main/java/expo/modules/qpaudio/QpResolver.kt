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

    // Buscamos streams de video con audio integrado (muxed videoStreams, p.ej. 360p / 720p mp4)
    val best = extractor.videoStreams
      .filter { it.content.isNotEmpty() }
      .sortedByDescending { it.resolution }
      .firstOrNull()

    if (best != null) {
      return VideoResult(
        url = best.content,
        title = extractor.name,
        resolution = best.resolution ?: "360p",
        mime = best.format?.mimeType ?: "video/mp4",
      )
    }

    // Si no hay muxed, buscar en videoOnlyStreams
    val videoOnly = extractor.videoOnlyStreams
      .filter { it.content.isNotEmpty() }
      .sortedByDescending { it.resolution }
      .firstOrNull()
      ?: throw IllegalStateException("sin streams de video para $videoId")

    return VideoResult(
      url = videoOnly.content,
      title = extractor.name,
      resolution = videoOnly.resolution ?: "360p",
      mime = videoOnly.format?.mimeType ?: "video/mp4",
    )
  }
}
