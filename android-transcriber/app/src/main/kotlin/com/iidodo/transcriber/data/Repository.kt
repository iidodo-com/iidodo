package com.iidodo.transcriber.data

import android.content.Context
import com.iidodo.transcriber.core.CheckpointStore
import com.iidodo.transcriber.core.Segment
import com.iidodo.transcriber.core.Task
import com.iidodo.transcriber.core.Word
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Room による途中結果の永続化。再開時は done フラグの立っていないタスクから処理される。 */
class RoomCheckpointStore(private val dao: AppDao) : CheckpointStore {
    override fun loadPlan(jobId: Long): List<Task>? =
        dao.getTasks(jobId).takeIf { it.isNotEmpty() }?.map { Task(it.startSample, it.endSample, it.speaker) }

    override fun savePlan(jobId: Long, tasks: List<Task>) {
        dao.insertTasks(tasks.mapIndexed { i, t -> TaskEntity(jobId, i, t.start, t.end, t.speaker) })
    }

    override fun completedCount(jobId: Long): Int = dao.countDone(jobId)

    override fun saveResult(jobId: Long, taskIndex: Int, segment: Segment?) {
        dao.saveResult(jobId, taskIndex, segment?.toEntity(jobId))
    }

    override fun loadSegments(jobId: Long): List<Segment> = dao.getSegments(jobId).map { it.toModel() }
}

fun Segment.toEntity(jobId: Long) = SegmentEntity(
    jobId = jobId, idx = index, start = start, end = end, rawText = rawText, text = text,
    speakerId = speakerId, wordsJson = wordsToJson(words), edited = edited,
)

fun SegmentEntity.toModel() = Segment(
    index = idx, start = start, end = end, rawText = rawText, text = text,
    speakerId = speakerId, words = wordsFromJson(wordsJson), edited = edited,
)

private fun wordsToJson(words: List<Word>): String {
    val a = JSONArray()
    for (w in words) a.put(JSONObject().put("t", w.text).put("s", w.start).put("e", w.end))
    return a.toString()
}

private fun wordsFromJson(json: String): List<Word> {
    val a = JSONArray(json)
    return (0 until a.length()).map { val o = a.getJSONObject(it); Word(o.getString("t"), o.getDouble("s"), o.getDouble("e")) }
}

/** アプリ専用領域のパス。 */
class Storage(private val context: Context) {
    val audioDir: File get() = File(context.filesDir, "audio").apply { mkdirs() }
    val workDir: File get() = File(context.filesDir, "work").apply { mkdirs() }
    val glossaryFile: File get() = File(context.filesDir, "glossary.csv")

    /** モデル置き場（adb push で配置できるアプリ専用外部領域）。 */
    val modelsDir: File get() = (context.getExternalFilesDir("models") ?: File(context.filesDir, "models")).apply { mkdirs() }

    fun pcmFile(jobId: Long) = File(workDir, "$jobId.pcm")

    /** ジョブの音声・作業ファイルを削除する。 */
    fun deleteJobFiles(job: JobEntity) {
        secureDelete(File(job.audioPath))
        secureDelete(pcmFile(job.id))
    }

    /** 全ファイル削除（音声・作業ファイル・辞書は残す）。 */
    fun deleteAllMedia() {
        audioDir.listFiles()?.forEach { secureDelete(it) }
        workDir.listFiles()?.forEach { secureDelete(it) }
        context.cacheDir.listFiles()?.forEach { it.deleteRecursively() }
    }

    /** 0 で上書きしてから削除する（フラッシュでは完全消去を保証できないが、通常復元を困難にする）。 */
    private fun secureDelete(f: File) {
        if (!f.exists()) return
        if (f.isFile) runCatching {
            java.io.RandomAccessFile(f, "rws").use { raf ->
                val zero = ByteArray(64 * 1024)
                var left = raf.length()
                raf.seek(0)
                while (left > 0) { val n = minOf(left, zero.size.toLong()).toInt(); raf.write(zero, 0, n); left -= n }
            }
        }
        f.delete()
    }
}
