package expo.modules.qpaudio

import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import java.net.HttpURLConnection
import java.net.URL

// HTTP que usa NewPipeExtractor para pedir páginas de YouTube desde el propio celular.
// La IP es la del operador móvil del dispositivo (no de un datacenter).
class QpDownloader : Downloader() {

  override fun execute(request: Request): Response {
    val conn = URL(request.url()).openConnection() as HttpURLConnection
    conn.requestMethod = request.httpMethod()
    conn.connectTimeout = 8000
    conn.readTimeout = 15000
    conn.instanceFollowRedirects = true

    for ((key, values) in request.headers()) {
      for (value in values) conn.addRequestProperty(key, value)
    }
    if (conn.getRequestProperty("User-Agent") == null) {
      conn.setRequestProperty("User-Agent", USER_AGENT)
    }

    val data = request.dataToSend()
    if (data != null) {
      conn.doOutput = true
      conn.outputStream.use { it.write(data) }
    }

    val code = conn.responseCode
    val stream = if (code >= 400) conn.errorStream else conn.inputStream
    val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
    val headers = conn.headerFields.filterKeys { it != null }

    return Response(code, conn.responseMessage, headers, body, conn.url.toString())
  }

  companion object {
    const val USER_AGENT =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
  }
}
