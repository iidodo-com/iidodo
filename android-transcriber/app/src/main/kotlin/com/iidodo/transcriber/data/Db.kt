package com.iidodo.transcriber.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

/** ジョブ状態。 */
object JobStatus {
    const val PENDING = "PENDING"
    const val RUNNING = "RUNNING"
    const val DONE = "DONE"
    const val FAILED = "FAILED"
    const val CANCELED = "CANCELED"
}

@Entity(tableName = "jobs")
data class JobEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val createdAt: Long,
    val meetingAt: Long,
    val attendees: String = "",
    /** 再生用の音声ファイル（アプリ専用領域）。 */
    val audioPath: String,
    val durationSec: Double = 0.0,
    val status: String = JobStatus.PENDING,
    val stage: String = "",
    val progress: Float = 0f,
    val diarize: Boolean = false,
    val numSpeakers: Int? = null,
    /** これまでの処理時間の累計(ms)。再開しても加算される。実測値の表示用。 */
    val processingMs: Long = 0,
    /** 失敗理由（例外クラス名のみ。本文・パスは入れない）。 */
    val error: String? = null,
)

@Entity(tableName = "tasks", primaryKeys = ["jobId", "idx"])
data class TaskEntity(
    val jobId: Long,
    val idx: Int,
    val startSample: Long,
    val endSample: Long,
    val speaker: Int?,
    val done: Boolean = false,
)

@Entity(tableName = "segments", primaryKeys = ["jobId", "idx"])
data class SegmentEntity(
    val jobId: Long,
    val idx: Int,
    val start: Double,
    val end: Double,
    val rawText: String,
    val text: String,
    val speakerId: Int?,
    val wordsJson: String = "[]",
    val edited: Boolean = false,
)

@Entity(tableName = "speakers", primaryKeys = ["jobId", "speakerId"])
data class SpeakerEntity(val jobId: Long, val speakerId: Int, val name: String)

/** 修正履歴。kind: TEXT / SPEAKER_NAME / SPEAKER_MERGE / GLOSSARY。 */
@Entity(tableName = "edits")
data class EditEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val jobId: Long,
    val at: Long,
    val kind: String,
    val segmentIdx: Int?,
    val oldValue: String,
    val newValue: String,
)

@Dao
abstract class AppDao {
    // --- jobs ---
    @Query("SELECT * FROM jobs ORDER BY createdAt DESC")
    abstract fun observeJobs(): Flow<List<JobEntity>>

    @Query("SELECT * FROM jobs WHERE id = :id")
    abstract fun observeJob(id: Long): Flow<JobEntity?>

    @Query("SELECT * FROM jobs WHERE id = :id")
    abstract fun getJob(id: Long): JobEntity?

    @Insert
    abstract fun insertJob(job: JobEntity): Long

    @Query("UPDATE jobs SET status = :status, error = :error WHERE id = :id")
    abstract fun setStatus(id: Long, status: String, error: String? = null)

    @Query("UPDATE jobs SET stage = :stage, progress = :progress WHERE id = :id")
    abstract fun setProgress(id: Long, stage: String, progress: Float)

    @Query("UPDATE jobs SET processingMs = processingMs + :ms WHERE id = :id")
    abstract fun addProcessingMs(id: Long, ms: Long)

    @Query("UPDATE jobs SET durationSec = :sec WHERE id = :id")
    abstract fun setDuration(id: Long, sec: Double)

    @Query("UPDATE jobs SET diarize = :diarize, numSpeakers = :n WHERE id = :id")
    abstract fun setDiarize(id: Long, diarize: Boolean, n: Int?)

    @Query("UPDATE jobs SET title = :title, attendees = :attendees, meetingAt = :meetingAt WHERE id = :id")
    abstract fun setInfo(id: Long, title: String, attendees: String, meetingAt: Long)

    @Query("UPDATE jobs SET status = 'CANCELED', error = 'interrupted' WHERE status = 'RUNNING'")
    abstract fun markInterrupted()

    @Query("SELECT * FROM jobs")
    abstract fun allJobs(): List<JobEntity>

    @Query("DELETE FROM jobs WHERE id = :id")
    abstract fun deleteJobRow(id: Long)

    // --- tasks (checkpoint) ---
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun insertTasks(tasks: List<TaskEntity>)

    @Query("SELECT * FROM tasks WHERE jobId = :jobId ORDER BY idx")
    abstract fun getTasks(jobId: Long): List<TaskEntity>

    @Query("SELECT COUNT(*) FROM tasks WHERE jobId = :jobId AND done = 1")
    abstract fun countDone(jobId: Long): Int

    @Query("UPDATE tasks SET done = 1 WHERE jobId = :jobId AND idx = :idx")
    abstract fun markTaskDone(jobId: Long, idx: Int)

    @Query("DELETE FROM tasks WHERE jobId = :jobId")
    abstract fun deleteTasks(jobId: Long)

    // --- segments ---
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun upsertSegment(s: SegmentEntity)

    @Query("SELECT * FROM segments WHERE jobId = :jobId ORDER BY idx")
    abstract fun observeSegments(jobId: Long): Flow<List<SegmentEntity>>

    @Query("SELECT * FROM segments WHERE jobId = :jobId ORDER BY idx")
    abstract fun getSegments(jobId: Long): List<SegmentEntity>

    @Query("UPDATE segments SET text = :text, edited = :edited WHERE jobId = :jobId AND idx = :idx")
    abstract fun updateSegmentText(jobId: Long, idx: Int, text: String, edited: Boolean)

    @Query("UPDATE segments SET speakerId = :speakerId WHERE jobId = :jobId AND idx = :idx")
    abstract fun updateSegmentSpeaker(jobId: Long, idx: Int, speakerId: Int?)

    @Query("DELETE FROM segments WHERE jobId = :jobId")
    abstract fun deleteSegments(jobId: Long)

    // --- speakers ---
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract fun upsertSpeaker(s: SpeakerEntity)

    @Query("SELECT * FROM speakers WHERE jobId = :jobId")
    abstract fun observeSpeakers(jobId: Long): Flow<List<SpeakerEntity>>

    @Query("SELECT * FROM speakers WHERE jobId = :jobId")
    abstract fun getSpeakers(jobId: Long): List<SpeakerEntity>

    @Query("DELETE FROM speakers WHERE jobId = :jobId")
    abstract fun deleteSpeakers(jobId: Long)

    // --- edits ---
    @Insert
    abstract fun insertEdit(e: EditEntity)

    @Query("SELECT * FROM edits WHERE jobId = :jobId ORDER BY at DESC, id DESC")
    abstract fun observeEdits(jobId: Long): Flow<List<EditEntity>>

    @Query("DELETE FROM edits WHERE jobId = :jobId")
    abstract fun deleteEdits(jobId: Long)

    // --- transactions ---
    /** タスク完了とセグメント保存を原子的に行う。 */
    @Transaction
    open fun saveResult(jobId: Long, idx: Int, segment: SegmentEntity?) {
        if (segment != null) upsertSegment(segment)
        markTaskDone(jobId, idx)
    }

    /** ジョブに紐づく全行を削除する（ファイルは呼び出し側で消す）。 */
    @Transaction
    open fun deleteJobCascade(id: Long) {
        deleteTasks(id); deleteSegments(id); deleteSpeakers(id); deleteEdits(id); deleteJobRow(id)
    }

    /** 再処理用: 結果だけを消して未処理に戻す。 */
    @Transaction
    open fun resetResults(id: Long) {
        deleteTasks(id); deleteSegments(id); deleteSpeakers(id); deleteEdits(id)
        setProgress(id, "", 0f)
        setStatus(id, JobStatus.PENDING, null)
    }

    @Transaction
    open fun renameSpeaker(jobId: Long, speakerId: Int, oldName: String, newName: String, at: Long) {
        upsertSpeaker(SpeakerEntity(jobId, speakerId, newName))
        insertEdit(EditEntity(jobId = jobId, at = at, kind = "SPEAKER_NAME", segmentIdx = null, oldValue = oldName, newValue = newName))
    }

    @Transaction
    open fun editText(jobId: Long, idx: Int, oldText: String, newText: String, at: Long) {
        updateSegmentText(jobId, idx, newText, true)
        insertEdit(EditEntity(jobId = jobId, at = at, kind = "TEXT", segmentIdx = idx, oldValue = oldText, newValue = newText))
    }
}

@Database(
    entities = [JobEntity::class, TaskEntity::class, SegmentEntity::class, SpeakerEntity::class, EditEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun dao(): AppDao

    companion object {
        const val NAME = "minutes.db"

        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, NAME)
                // 完全削除時に WAL に本文が残らないよう、ジャーナルは TRUNCATE を使う
                .setJournalMode(JournalMode.TRUNCATE)
                .build()
    }
}
