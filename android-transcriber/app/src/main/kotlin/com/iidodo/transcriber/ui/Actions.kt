package com.iidodo.transcriber.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.iidodo.transcriber.App
import com.iidodo.transcriber.core.Exporters
import com.iidodo.transcriber.core.MeetingInfo
import com.iidodo.transcriber.core.Transcript
import com.iidodo.transcriber.data.JobEntity
import com.iidodo.transcriber.data.toModel
import com.iidodo.transcriber.work.JobProcessor
import com.iidodo.transcriber.work.TranscribeService
import java.io.File
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId

/** 新規ジョブの入力。 */
data class NewJobInput(val title: String, val attendees: String, val diarize: Boolean, val numSpeakers: Int?)

/** UI から呼ぶ、DB/ファイルを伴う操作。すべて IO スレッド（呼び出し側が app.io か Dispatchers.IO を使う）で実行する。 */
object Actions {
    fun displayName(context: Context, uri: Uri): String? =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }

    /** 選択した音声/動画ファイルをアプリ専用領域へコピーしてジョブを作り、処理を開始する。 */
    fun importUri(context: Context, uri: Uri, input: NewJobInput): Long {
        val app = context.applicationContext as App
        val ext = displayName(context, uri)?.substringAfterLast('.', "bin")?.lowercase()?.takeIf { it.length in 1..5 } ?: "bin"
        val dest = File(app.storage.audioDir, "${System.currentTimeMillis()}.$ext")
        context.contentResolver.openInputStream(uri)!!.use { src -> dest.outputStream().use { src.copyTo(it, 256 * 1024) } }
        return createJob(context, dest, input)
    }

    /** 録音済み WAV を確定し、ジョブを作って処理を開始する。 */
    fun importRecording(context: Context, wav: File, input: NewJobInput): Long {
        val app = context.applicationContext as App
        val dest = File(app.storage.audioDir, "${System.currentTimeMillis()}.rec.wav")
        if (!wav.renameTo(dest)) { wav.copyTo(dest, overwrite = true); wav.delete() }
        return createJob(context, dest, input)
    }

    private fun createJob(context: Context, audio: File, input: NewJobInput): Long {
        val app = context.applicationContext as App
        val now = System.currentTimeMillis()
        val id = app.db.dao().insertJob(
            JobEntity(
                title = input.title.ifBlank { "無題の会議" }, createdAt = now, meetingAt = now,
                attendees = input.attendees, audioPath = audio.absolutePath,
                diarize = input.diarize, numSpeakers = input.numSpeakers,
            ),
        )
        TranscribeService.start(context, id)
        return id
    }

    fun deleteJob(context: Context, id: Long) {
        val app = context.applicationContext as App
        val job = app.db.dao().getJob(id) ?: return
        app.storage.deleteJobFiles(job)
        app.db.dao().deleteJobCascade(id)
    }

    /** 音声・文字起こし・履歴・作業ファイルをすべて消す。辞書ファイルは残す。 */
    fun deleteAll(context: Context) {
        val app = context.applicationContext as App
        TranscribeService.cancel(context)
        app.releaseEngine()
        app.storage.deleteAllMedia()
        app.db.clearAllTables()
        // 削除済み行の内容がファイル内に残らないよう詰める
        app.db.openHelper.writableDatabase.execSQL("VACUUM")
    }

    fun reprocess(context: Context, id: Long, diarize: Boolean, numSpeakers: Int?) {
        val app = context.applicationContext as App
        app.db.dao().resetResults(id)
        app.db.dao().setDiarize(id, diarize, numSpeakers)
        TranscribeService.start(context, id)
    }

    /** 辞書を、手修正されていないセグメントへ再適用する。 */
    fun reapplyGlossary(context: Context, id: Long): Int {
        val app = context.applicationContext as App
        val dao = app.db.dao()
        val g = JobProcessor.loadGlossary(app)
        var n = 0
        for (s in dao.getSegments(id)) {
            if (s.edited) continue
            val t = g.apply(s.rawText)
            if (t != s.text) { dao.updateSegmentText(id, s.idx, t, false); n++ }
        }
        return n
    }

    fun buildTranscript(app: App, job: JobEntity): Transcript {
        val dao = app.db.dao()
        val dt = LocalDateTime.ofInstant(Instant.ofEpochMilli(job.meetingAt), ZoneId.systemDefault())
        return Transcript(
            info = MeetingInfo(job.title, dt, job.attendees.split('、', ',', '，').map { it.trim() }.filter { it.isNotEmpty() }),
            segments = dao.getSegments(job.id).map { it.toModel() },
            speakerNames = dao.getSpeakers(job.id).associate { it.speakerId to it.name },
        )
    }

    fun export(app: App, job: JobEntity, format: com.iidodo.transcriber.core.ExportFormat, g: com.iidodo.transcriber.core.Granularity): ByteArray =
        Exporters.export(buildTranscript(app, job), format, g)
}
