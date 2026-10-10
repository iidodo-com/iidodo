package com.iidodo.transcriber.work

import android.content.Context
import com.iidodo.transcriber.App
import com.iidodo.transcriber.audio.AudioDecoder
import com.iidodo.transcriber.audio.FilePcmSource
import com.iidodo.transcriber.core.Glossary
import com.iidodo.transcriber.core.PipelineOptions
import com.iidodo.transcriber.core.Stage
import com.iidodo.transcriber.core.TranscriptionPipeline
import com.iidodo.transcriber.data.JobStatus
import com.iidodo.transcriber.data.RoomCheckpointStore
import com.iidodo.transcriber.engine.ModelsMissingException
import kotlinx.coroutines.CancellationException
import java.io.File

/** 1ジョブの実行（復号 → パイプライン）。キャンセル・失敗後に再実行すると途中から再開する。 */
object JobProcessor {
    fun loadGlossary(app: App): Glossary = runCatching {
        val f = app.storage.glossaryFile
        if (f.isFile) Glossary.fromCsv(f.readText()) else Glossary.EMPTY
    }.getOrDefault(Glossary.EMPTY)

    suspend fun process(context: Context, jobId: Long, onProgress: (String, Float) -> Unit) {
        val app = context.applicationContext as App
        val dao = app.db.dao()
        val job = dao.getJob(jobId) ?: return
        val started = System.currentTimeMillis()
        dao.setStatus(jobId, JobStatus.RUNNING, null)
        fun report(stage: String, f: Float) {
            dao.setProgress(jobId, stage, f)
            onProgress(stage, f)
        }
        try {
            val audio = File(job.audioPath)
            // 録音 WAV(16k mono) はそのまま読む。それ以外は生 PCM へ復号して作業ファイルに置く。
            val isWav16k = job.audioPath.endsWith(".rec.wav")
            val pcm = if (isWav16k) audio else app.storage.pcmFile(jobId)
            val header = if (isWav16k) FilePcmSource.WAV_HEADER else 0
            if (!isWav16k && !pcm.isFile) {
                val tmp = File(pcm.path + ".part")
                val sec = AudioDecoder.decodeToPcm16k(audio, tmp) { report("音声を変換中", it) }
                tmp.renameTo(pcm)
                dao.setDuration(jobId, sec)
            }
            FilePcmSource(pcm, header).use { source ->
                if (job.durationSec <= 0.0) dao.setDuration(jobId, source.totalSamples / 16000.0)
                com.iidodo.transcriber.engine.ModelInstaller.ensure(app, app.storage.modelsDir)
                val engine = app.engine()
                val pipeline = TranscriptionPipeline(
                    detector = engine.detector,
                    recognizer = engine.recognizerAdapter,
                    store = RoomCheckpointStore(dao),
                    diarizer = engine.diarizer,
                )
                pipeline.run(
                    jobId, source, loadGlossary(app),
                    PipelineOptions(diarize = job.diarize, numSpeakers = job.numSpeakers),
                ) { stage, f ->
                    val label = when (stage) {
                        Stage.ANALYZE -> "音量を解析中"
                        Stage.DETECT -> "発話区間を検出中"
                        Stage.DIARIZE -> "話者を分離中"
                        Stage.RECOGNIZE -> "文字起こし中"
                    }
                    report(label, f)
                }
            }
            if (!isWav16k) app.storage.pcmFile(jobId).delete()
            dao.setProgress(jobId, "完了", 1f)
            dao.setStatus(jobId, JobStatus.DONE, null)
        } catch (e: CancellationException) {
            dao.setStatus(jobId, JobStatus.CANCELED, null)
            throw e
        } catch (e: ModelsMissingException) {
            dao.setStatus(jobId, JobStatus.FAILED, "モデル未配置: " + e.files.joinToString())
        } catch (e: Throwable) {
            // 本文・パスを含みうる message は記録しない
            dao.setStatus(jobId, JobStatus.FAILED, e.javaClass.simpleName)
        } finally {
            dao.addProcessingMs(jobId, System.currentTimeMillis() - started)
        }
    }
}
