package expo.modules.qpaudio

// Presets del ecualizador para 5 bandas, en milibeles (mB). Graves -> agudos.
// Se recortan contra el rango real del dispositivo al aplicarlos.
object QpPresets {
  private val table: Map<String, IntArray> = mapOf(
    "flat" to intArrayOf(0, 0, 0, 0, 0),
    "bass" to intArrayOf(600, 400, 100, 0, 0),
    "voz" to intArrayOf(-300, -100, 300, 400, 100),
    "agudos" to intArrayOf(0, 0, 100, 400, 600),
    "rock" to intArrayOf(500, 300, 0, 200, 500),
    "pop" to intArrayOf(100, 200, 300, 200, 100),
  )

  fun gains(preset: String): IntArray = table[preset] ?: table.getValue("flat")
}
