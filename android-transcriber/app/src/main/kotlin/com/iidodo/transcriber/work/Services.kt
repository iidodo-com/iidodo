package com.iidodo.transcriber.work

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.iidodo.transcriber.App
import com.iidodo.transcriber.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private fun Context.openAppIntent(): PendingIntent =
    PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)

/** 録音中の通知を出し続けるだけのフォアグラウンドサービス（録音自体は RecordingController）。 */
class RecordingService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val n: Notification = NotificationCompat.Builder(this, App.CHANNEL_REC)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("録音中")
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .build()
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        return START_NOT_STICKY
    }

    companion object {
        const val ACTION_STOP = "stop"
        fun start(c: Context) = ContextCompat.startForegroundService(c, Intent(c, RecordingService::class.java))
        fun stop(c: Context) = c.startService(Intent(c, RecordingService::class.java).setAction(ACTION_STOP))
    }
}

/** 文字起こしを画面オフでも継続させるフォアグラウンドサービス。ジョブは1つずつ直列に処理する。 */
class TranscribeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var current: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CANCEL -> {
                current?.cancel()
                return START_NOT_STICKY
            }
        }
        val jobId = intent?.getLongExtra(EXTRA_JOB, -1L) ?: -1L
        startForeground(2, notification("準備中", 0f), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        if (jobId < 0 || current?.isActive == true) {
            if (current?.isActive != true) stopSelf()
            return START_NOT_STICKY
        }
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "transcriber:job").apply { acquire(3 * 60 * 60 * 1000L) }
        _active.value = jobId
        current = scope.launch {
            try {
                JobProcessor.process(applicationContext, jobId) { stage, f ->
                    getSystemService(android.app.NotificationManager::class.java).notify(2, notification(stage, f))
                }
            } finally {
                _active.value = null
                if (wakeLock?.isHeld == true) wakeLock?.release()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun notification(stage: String, fraction: Float): Notification =
        NotificationCompat.Builder(this, App.CHANNEL_JOB)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("文字起こし: $stage")
            .setProgress(100, (fraction * 100).toInt(), false)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .addAction(0, "中止", PendingIntent.getService(
                this, 1, Intent(this, TranscribeService::class.java).setAction(ACTION_CANCEL), PendingIntent.FLAG_IMMUTABLE,
            ))
            .build()

    override fun onDestroy() {
        scope.coroutineContext[Job]?.cancel()
        if (wakeLock?.isHeld == true) wakeLock?.release()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_JOB = "job"
        private const val ACTION_CANCEL = "cancel"
        private val _active = MutableStateFlow<Long?>(null)

        /** 現在処理中のジョブ ID。 */
        val active: StateFlow<Long?> = _active.asStateFlow()

        fun start(c: Context, jobId: Long) =
            ContextCompat.startForegroundService(c, Intent(c, TranscribeService::class.java).putExtra(EXTRA_JOB, jobId))

        fun cancel(c: Context) = c.startService(Intent(c, TranscribeService::class.java).setAction(ACTION_CANCEL))
    }
}
