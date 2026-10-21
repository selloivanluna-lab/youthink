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
}
