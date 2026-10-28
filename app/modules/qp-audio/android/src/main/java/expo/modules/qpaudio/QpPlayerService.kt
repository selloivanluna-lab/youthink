package expo.modules.qpaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.Equalizer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// Servicio de reproducci��n: mantiene el audio sonando en segundo plano con
// notificaci��n y controles, y aplica el ecualizador sobre la sesi��n de audio.
class QpPlayerService : MediaSessionService() {

  private var player: ExoPlayer? = null
  private var session: MediaSession? = null
  private var equalizer: Equalizer? = null

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()

  private val ticker = object : Runnable {
    override fun run() {
      pushState()
      if (player?.isPlaying == true) main.postDelayed(this, 500)
    }
  }

  // Detección de doble-click en botón Play de parlantes Bluetooth / auriculares
  private var hookCount = 0
  private val hookRunnable = Runnable {
    val count = hookCount
    hookCount = 0
    if (count == 1) {
      togglePlay()
    } else if (count == 2) {
      QpEvents.push(mapOf("action" to "next"))
    } else if (count >= 3) {
      QpEvents.push(mapOf("action" to "prev"))
    }
  }

  private fun handleHeadsetHook() {
    hookCount++
    main.removeCallbacks(hookRunnable)
    if (hookCount >= 2) {
      main.postDelayed(hookRunnable, 250)
    } else {
      main.postDelayed(hookRunnable, 350)
    }
  }

  override fun onCreate() {
    super.onCreate()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel("qp_audio", "YouThink Audio", NotificationManager.IMPORTANCE_LOW)
      val nm = getSystemService(NotificationManager::class.java)
      nm?.createNotificationChannel(channel)
    }
    val notif = NotificationCompat.Builder(this, "qp_audio")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("YouThink")
      .setContentText("Reproduciendo audio")
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(1001, notif, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(1001, notif)
      }
    } catch (_: Throwable) {}

    val http = DefaultHttpDataSource.Factory()
      .setUserAgent(QpDownloader.USER_AGENT)
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(8000)
      .setReadTimeoutMs(15000)

    val exo = ExoPlayer.Builder(this)
      .setMediaSourceFactory(DefaultMediaSourceFactory(http))
      .setHandleAudioBecomingNoisy(true)
      .build()

    exo.addListener(object : Player.Listener {
      override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (isPlaying) ticker.run() else { main.removeCallbacks(ticker); pushState() }
      }
      override fun onPlaybackStateChanged(playbackState: Int) { pushState() }
      override fun onAudioSessionIdChanged(audioSessionId: Int) { attachEq(audioSessionId) }
      override fun onPlayerError(error: PlaybackException) {
        QpEvents.push(
          mapOf(
            "resolving" to false,
            "buffering" to false,
            "error" to (error.message ?: "Error de reproducción")
          )
        )
      }
    })

    player = exo

    val sessionCallback = object : MediaSession.Callback {
      override fun onConnect(
        session: MediaSession,
        controller: MediaSession.ControllerInfo
      ): MediaSession.ConnectionResult {
        val connectionResult = super.onConnect(session, controller)
        val availablePlayerCommands = connectionResult.availablePlayerCommands
          .buildUpon()
          .add(Player.COMMAND_SEEK_TO_NEXT)
          .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
          .add(Player.COMMAND_SEEK_TO_PREVIOUS)
          .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
          .build()
        return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
          .setAvailableSessionCommands(connectionResult.availableSessionCommands)
          .setAvailablePlayerCommands(availablePlayerCommands)
          .build()
      }

      override fun onPlayerCommandRequest(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        playerCommand: Int
      ): Int {
        when (playerCommand) {
          Player.COMMAND_SEEK_TO_NEXT,
          Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> {
            QpEvents.push(mapOf("action" to "next"))
            return SessionResult.RESULT_SUCCESS
          }
          Player.COMMAND_SEEK_TO_PREVIOUS,
          Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> {
            QpEvents.push(mapOf("action" to "prev"))
            return SessionResult.RESULT_SUCCESS
          }
        }
        return super.onPlayerCommandRequest(session, controller, playerCommand)
      }

      override fun onMediaButtonEvent(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        intent: Intent
      ): Boolean {
        val ke = if (Build.VERSION.SDK_INT >= 33) {
          intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT) as? KeyEvent
        }
        if (ke != null && ke.action == KeyEvent.ACTION_DOWN) {
          when (ke.keyCode) {
            KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_STEP_FORWARD,
            KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> {
              QpEvents.push(mapOf("action" to "next"))
              return true
            }
            KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_MEDIA_STEP_BACKWARD,
            KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> {
              QpEvents.push(mapOf("action" to "prev"))
              return true
            }
            KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
              handleHeadsetHook()
              return true
            }
          }
        }
        return super.onMediaButtonEvent(session, controller, intent)
      }
    }

    val sessionBuilder = MediaSession.Builder(this, exo)
      .setCallback(sessionCallback)
    launchIntent()?.let { sessionBuilder.setSessionActivity(it) }
    session = sessionBuilder.build()

    QpBridge.service = this
    applyEq(QpBridge.pendingGains)
  }

  private fun launchIntent(): PendingIntent? {
    val i = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(
      this,
      0,
      i,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  override fun onDestroy() {
    main.removeCallbacks(ticker)
    try { equalizer?.release() } catch (_: Exception) {}
    equalizer = null
    QpBridge.service = null
    player?.release()
    session?.release()
    session = null
    player = null
    io.shutdownNow()
    super.onDestroy()
  }

  private val currentRequestId = java.util.concurrent.atomic.AtomicLong(0)

  fun playVideo(videoId: String, title: String) {
    val reqId = currentRequestId.incrementAndGet()
    // Detener y limpiar inmediatamente cualquier reproducción previa para evitar audios simultáneos
    main.post {
      player?.stop()
      player?.clearMediaItems()
      pushState()
    }

    // Si ya es una URL directa (ej: Cloudflare R2, HTTP stream), reproducir sin pasar por NewPipe
    if (videoId.startsWith("http://") || videoId.startsWith("https://")) {
      main.post {
        if (reqId != currentRequestId.get()) return@post
        val p = player ?: return@post
        val item = MediaItem.Builder()
          .setUri(videoId)
          .setMediaId(videoId)
          .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
          .build()
        p.setMediaItem(item)
        p.prepare()
        QpEvents.push(mapOf("resolving" to false, "buffering" to true, "isPlaying" to false, "error" to null))
        p.play()
        pushState()
      }
      return
    }

    val timedOut = AtomicBoolean(false)
    QpEvents.push(mapOf("resolving" to true, "buffering" to true, "isPlaying" to false, "error" to null))

    val timeout = Runnable {
      if (timedOut.compareAndSet(false, true)) {
        if (reqId == currentRequestId.get()) {
          QpEvents.push(
            mapOf(
              "resolving" to false,
              "buffering" to false,
              "isPlaying" to false,
              "error" to "La extracción tardó demasiado. Probá de nuevo."
            )
          )
        }
      }
    }
    main.postDelayed(timeout, 25000)

    io.execute {
      try {
        val r = QpResolver.resolveAudio(videoId)
        if (timedOut.get() || reqId != currentRequestId.get()) return@execute
        main.post {
          main.removeCallbacks(timeout)
          if (reqId != currentRequestId.get()) return@post
          val p = player ?: return@post
          val item = MediaItem.Builder()
            .setUri(r.url)
            .setMediaId(videoId)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title.ifEmpty { r.title }).build())
            .build()
          p.setMediaItem(item)
          p.prepare()
          QpEvents.push(mapOf("resolving" to false))
          p.play()
          pushState()
        }
      } catch (e: Exception) {
        if (timedOut.get() || reqId != currentRequestId.get()) return@execute
        main.post { main.removeCallbacks(timeout) }
        QpEvents.push(
          mapOf(
            "resolving" to false,
            "buffering" to false,
            "error" to (e.message ?: "No se pudo resolver el audio")
          )
        )
      }
    }
  }

  fun togglePlay() {
    main.post {
      val p = player ?: return@post
      if (p.isPlaying) p.pause()
      else { if (p.playbackState == Player.STATE_IDLE) p.prepare(); p.play() }
    }
  }

  fun pause() { main.post { player?.pause() } }

  fun resume() {
    main.post {
      val p = player ?: return@post
      if (p.playbackState == Player.STATE_IDLE) p.prepare()
      p.play()
    }
  }

  fun seek(seconds: Double) { main.post { player?.seekTo((seconds * 1000).toLong()) } }

  fun stopPlayback() {
    main.post {
      player?.run { stop(); clearMediaItems() }
      equalizer?.enabled = false
      QpEvents.push(mapOf("resolving" to false, "buffering" to false))
    }
  }

  fun applyEq(gains: IntArray) { main.post { applyEqInternal(gains) } }

  private fun applyEqInternal(gains: IntArray) {
    val eq = equalizer ?: return
    try {
      val range = eq.bandLevelRange
      val min = range[0].toInt()
      val max = range[1].toInt()
      val bands = eq.numberOfBands.toInt()
      for (i in 0 until minOf(bands, gains.size)) {
        val level = gains[i].coerceIn(min, max)
        eq.setBandLevel(i.toShort(), level.toShort())
      }
      eq.enabled = gains.any { it != 0 }
    } catch (_: Exception) {
    }
  }

  private fun attachEq(sessionId: Int) {
    if (sessionId == 0) return
    try { equalizer?.release() } catch (_: Exception) {}
    equalizer = try { Equalizer(0, sessionId) } catch (_: Exception) { null }
    applyEqInternal(QpBridge.pendingGains)
  }

  private fun pushState() {
    val p = player ?: return
    QpEvents.push(
      mapOf(
        "isPlaying" to p.isPlaying,
        "position" to p.currentPosition / 1000.0,
        "duration" to if (p.duration > 0) p.duration / 1000.0 else 0.0,
        "mediaId" to (p.currentMediaItem?.mediaId ?: ""),
        "buffering" to (p.playbackState == Player.STATE_BUFFERING),
        "ended" to (p.playbackState == Player.STATE_ENDED),
      )
    )
  }
}
