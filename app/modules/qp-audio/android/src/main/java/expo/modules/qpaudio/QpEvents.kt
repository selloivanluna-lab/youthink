package expo.modules.qpaudio

import android.os.Handler
import android.os.Looper

// Puente de eventos del servicio hacia el módulo (mismo proceso).
// Los eventos emitidos antes de que React suscriba el listener se encolan y
// se re-entregan en cuanto el listener se asigna (evita el colgado silencioso).
object QpEvents {
  private val main = Handler(Looper.getMainLooper())
  private val pending = mutableListOf<Map<String, Any?>>()

  @Volatile
  var listener: ((Map<String, Any?>) -> Unit)? = null
    set(value) {
      field = value
      if (value != null) {
        val snap = synchronized(pending) { pending.toList().also { pending.clear() } }
        snap.forEach { evt ->
          main.post {
            try {
              value.invoke(evt)
            } catch (_: Throwable) {}
          }
        }
      }
    }

  fun push(data: Map<String, Any?>) {
    main.post {
      val l = listener
      if (l != null) {
        try {
          l.invoke(data)
        } catch (_: Throwable) {}
      } else {
        synchronized(pending) {
          if (pending.size < 50) pending.add(data)
        }
      }
    }
  }
}
