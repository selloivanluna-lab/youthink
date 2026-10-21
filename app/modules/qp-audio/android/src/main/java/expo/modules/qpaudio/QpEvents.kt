package expo.modules.qpaudio

import android.os.Handler
import android.os.Looper

// Puente de eventos del servicio hacia el módulo (mismo proceso).
object QpEvents {
  private val main = Handler(Looper.getMainLooper())

  @Volatile
  var listener: ((Map<String, Any?>) -> Unit)? = null

  fun push(data: Map<String, Any?>) {
    main.post { listener?.invoke(data) }
  }
}
