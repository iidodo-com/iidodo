package com.iidodo.transcriber

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.iidodo.transcriber.data.AppDatabase
import com.iidodo.transcriber.data.Storage
import com.iidodo.transcriber.engine.ModelPaths
import com.iidodo.transcriber.engine.SherpaEngine
import java.util.concurrent.Executors

class App : Application() {
    lateinit var db: AppDatabase
        private set
    lateinit var storage: Storage
        private set

    /** DB 書き込み用（Room はメインスレッド不可）。 */
    val io = Executors.newSingleThreadExecutor()

    private var engine: SherpaEngine? = null

    @Synchronized
    fun engine(): SherpaEngine = engine ?: SherpaEngine(ModelPaths(storage.modelsDir)).also { engine = it }

    @Synchronized
    fun releaseEngine() {
        engine?.close()
        engine = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        db = AppDatabase.create(this)
        storage = Storage(this)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_REC, "録音", NotificationManager.IMPORTANCE_LOW))
        nm.createNotificationChannel(NotificationChannel(CHANNEL_JOB, "文字起こし", NotificationManager.IMPORTANCE_LOW))
        // プロセスが落ちて RUNNING のまま残ったジョブを再開可能(CANCELED)へ戻す
        io.execute { db.dao().markInterrupted() }
    }

    companion object {
        const val CHANNEL_REC = "rec"
        const val CHANNEL_JOB = "job"
        lateinit var instance: App
            private set
    }
}
