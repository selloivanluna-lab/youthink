package expo.modules.qpaudio

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Servidor HTTP mínimo para Chromecast.
 *
 * El receptor por defecto (Default Media Receiver) no puede reproducir una URL
 * de googlevideo.com directamente: esa URL está atada a la IP que la resolvió y
 * a headers concretos (User-Agent / Referer). Por eso el TV mostraba el logo y
 * el spinner sin reproducir nada.
 *
 * Solución: el teléfono abre este servidor en la red Wi-Fi y le pasa al TV una
 * URL local (http://192.168.x.x:PUERTO/cast?v=ID&k=video). Cuando el Chromecast
 * pide el medio, el teléfono resuelve/descarga el stream y lo reenvía byte a
 * byte, soportando Range para que se pueda seekear.
 */
object QpCastServer {
  private const val CACHE_MS = 30 * 60 * 1000L

  private class StreamRef(val url: String, val mime: String, val exp: Long)

  private val cache = ConcurrentHashMap<String, StreamRef>()

  @Volatile
  private var socket: ServerSocket? = null

  @Volatile
  var port: Int = 0
    private set

  /** Arranca el servidor (idempotente) y devuelve el puerto. */
  fun ensureStarted(): Int {
    socket?.let { return port }
    synchronized(this) {
      socket?.let { return port }
      val ss = ServerSocket()
      ss.reuseAddress = true
      // Puerto efímero: evitamos choques con otras apps. Escucha en todas las interfaces.
      ss.bind(InetSocketAddress(0))
      socket = ss
      port = ss.localPort
      Thread({ loop(ss) }, "qp-cast-http").apply { isDaemon = true }.start()
      return port
    }
  }

  /**
   * Prepara la URL local que se le manda al Chromecast.
   * Resuelve el stream ahora para conocer el MIME real (el TV lo exige).
   */
  fun prepare(videoId: String, kind: String): Map<String, Any?> {
    val p = ensureStarted()
    val ip = lanIp()
      ?: throw IllegalStateException("Conectá el teléfono a la misma red Wi-Fi que el Chromecast.")
    val st = resolve(videoId, kind)
    return mapOf(
      "url" to "http://$ip:$p/cast?v=$videoId&k=$kind",
      "mime" to st.mime,
      "port" to p,
      "ip" to ip,
    )
  }

  /** IP local del teléfono (LAN). Prioriza Wi-Fi / hotspot sobre VPN. */
  private fun lanIp(): String? {
    return try {
      val candidatos = ArrayList<Pair<String, String>>()
      val ifaces = NetworkInterface.getNetworkInterfaces()
      while (ifaces.hasMoreElements()) {
        val ni = ifaces.nextElement()
        if (!ni.isUp || ni.isLoopback) continue
        val nombre = ni.name.lowercase()
        for (a in ni.inetAddresses) {
          if (a is Inet4Address && !a.isLoopbackAddress && a.isSiteLocalAddress) {
            val host = a.hostAddress ?: continue
            candidatos.add(nombre to host)
          }
        }
      }
      val preferido = candidatos.firstOrNull {
        it.first.startsWith("wlan") || it.first.startsWith("ap") || it.first.startsWith("swlan")
      }
      val sinVpn = candidatos.firstOrNull {
        !it.first.startsWith("tun") && !it.first.startsWith("ppp") && !it.first.startsWith("rmnet")
      }
      (preferido ?: sinVpn ?: candidatos.firstOrNull())?.second
    } catch (e: Throwable) {
      null
    }
  }

  private fun loop(ss: ServerSocket) {
    while (!ss.isClosed) {
      val cliente = try { ss.accept() } catch (e: Throwable) { break }
      Thread({ manejar(cliente) }, "qp-cast-conn").apply { isDaemon = true }.start()
    }
  }

  private fun manejar(s: Socket) {
    try {
      s.soTimeout = 30000
      val reader = BufferedInputStream(s.getInputStream()).bufferedReader(Charsets.ISO_8859_1)
      val linea = reader.readLine() ?: run { s.close(); return }
      var range: String? = null
      while (true) {
        val l = reader.readLine() ?: break
        if (l.isEmpty()) break
        val i = l.indexOf(':')
        if (i > 0 && l.substring(0, i).trim().equals("Range", ignoreCase = true)) {
          range = l.substring(i + 1).trim()
        }
      }

      val partes = linea.split(' ')
      if (partes.size < 2) { s.close(); return }
      val metodo = partes[0].uppercase()
      val destino = partes[1]
      val query = destino.substringAfter('?', "")
      val params = HashMap<String, String>()
      for (par in query.split('&')) {
        val i = par.indexOf('=')
        if (i > 0) params[par.substring(0, i)] = par.substring(i + 1)
      }

      if (destino.startsWith("/ping")) { texto(s, "ok"); return }
      if (!destino.startsWith("/cast")) { texto(s, "no encontrado", 404); return }

      val id = params["v"] ?: ""
      val kind = if (params["k"] == "audio") "audio" else "video"
      if (id.isEmpty()) { texto(s, "falta ?v=", 400); return }

      proxy(s, id, kind, range, metodo == "HEAD", false)
    } catch (e: Throwable) {
      try { s.close() } catch (_: Throwable) {}
    }
  }

  private fun resolve(id: String, kind: String): StreamRef {
    val key = "$kind:$id"
    val ahora = System.currentTimeMillis()
    cache[key]?.let { if (it.exp > ahora) return it }
    val nuevo = if (kind == "audio") {
      val a = QpResolver.resolveAudio(id)
      StreamRef(a.url, a.mime.substringBefore(';'), ahora + CACHE_MS)
    } else {
      val v = QpResolver.resolveVideo(id)
      StreamRef(v.url, v.mime.substringBefore(';'), ahora + CACHE_MS)
    }
    cache[key] = nuevo
    return nuevo
  }

  private fun proxy(s: Socket, id: String, kind: String, range: String?, head: Boolean, reintento: Boolean) {
    var conn: HttpURLConnection? = null
    val st = try { resolve(id, kind) } catch (e: Throwable) {
      texto(s, "no se pudo resolver el video: ${e.message}", 502)
      return
    }
    try {
      conn = URL(st.url).openConnection() as HttpURLConnection
      conn.requestMethod = if (head) "HEAD" else "GET"
      conn.instanceFollowRedirects = true
      conn.connectTimeout = 15000
      conn.readTimeout = 30000
      // Headers que YouTube exige para servir el stream.
      conn.setRequestProperty("User-Agent", QpDownloader.USER_AGENT)
      conn.setRequestProperty("Referer", "https://www.youtube.com/")
      conn.setRequestProperty("Origin", "https://www.youtube.com")
      conn.setRequestProperty("Accept-Encoding", "identity")
      if (!range.isNullOrBlank()) conn.setRequestProperty("Range", range)

      val code = conn.responseCode
      if (code >= 400) {
        // URL vencida / rechazada: pedimos una nueva y reintentamos una vez.
        cache.remove("$kind:$id")
        if (!reintento) { proxy(s, id, kind, range, head, true); return }
        texto(s, "YouTube devolvió HTTP $code", 502)
        return
      }

      val out = BufferedOutputStream(s.getOutputStream())
      val mime = (conn.contentType ?: st.mime).substringBefore(';').ifBlank { st.mime }
      val estado = if (code == 206) "206 Partial Content" else "200 OK"
      val sb = StringBuilder()
      sb.append("HTTP/1.1 ").append(estado).append("\r\n")
      sb.append("Content-Type: ").append(mime).append("\r\n")
      sb.append("Accept-Ranges: bytes\r\n")
      sb.append("Access-Control-Allow-Origin: *\r\n")
      sb.append("Cache-Control: no-store\r\n")
      sb.append("Connection: close\r\n")
      conn.getHeaderField("Content-Length")?.let { sb.append("Content-Length: ").append(it).append("\r\n") }
      conn.getHeaderField("Content-Range")?.let { sb.append("Content-Range: ").append(it).append("\r\n") }
      sb.append("\r\n")
      out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
      out.flush()

      if (!head) {
        val entrada = conn.inputStream
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = entrada.read(buf)
          if (n <= 0) break
          out.write(buf, 0, n)
        }
        out.flush()
      }
      try { out.close() } catch (_: Throwable) {}
    } catch (e: Throwable) {
      try { texto(s, "error al leer el medio: ${e.message}", 502) } catch (_: Throwable) {}
    } finally {
      try { conn?.disconnect() } catch (_: Throwable) {}
      try { s.close() } catch (_: Throwable) {}
    }
  }

  private fun texto(s: Socket, msg: String, code: Int = 200) {
    try {
      val cuerpo = msg.toByteArray(Charsets.UTF_8)
      val out = BufferedOutputStream(s.getOutputStream())
      val cabecera = "HTTP/1.1 $code OK\r\n" +
        "Content-Type: text/plain; charset=utf-8\r\n" +
        "Content-Length: ${cuerpo.size}\r\n" +
        "Connection: close\r\n\r\n"
      out.write(cabecera.toByteArray(Charsets.ISO_8859_1))
      out.write(cuerpo)
      out.flush()
      out.close()
    } catch (_: Throwable) {
    } finally {
      try { s.close() } catch (_: Throwable) {}
    }
  }
}
