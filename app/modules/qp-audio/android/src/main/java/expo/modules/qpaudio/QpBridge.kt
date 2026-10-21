package expo.modules.qpaudio

// Referencia compartida al servicio (mismo proceso). El módulo la usa para
// controlar la reproducción y el ecualizador.
object QpBridge {
  @Volatile
  var service: QpPlayerService? = null

  @Volatile
  var pendingGains: IntArray = intArrayOf(0, 0, 0, 0, 0)
}
