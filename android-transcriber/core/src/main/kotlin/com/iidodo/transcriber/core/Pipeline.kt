package com.iidodo.transcriber.core

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/** 16kHz モノラル float PCM の読み出し元。実装は端末側（ファイル）／テスト側（メモリ）。 */
interface PcmSource {
    val sampleRate: Int get() = AudioMath.SAMPLE_RATE
    val totalSamples: Long

    /** [start, start+length) を返す。範囲外は切り詰める。 */
    fun read(start: Long, length: Int): FloatArray
}

/** VAD。発話区間（サンプル単位）を返す。 */
interface SpeechDetector {
    suspend fun detect(source: PcmSource, onProgress: (Float) -> Unit): List<SampleRange>
}

/** 話者分離。numSpeakers が null なら自動推定。 */
interface Diarizer {
    suspend fun diarize(source: PcmSource, numSpeakers: Int?, onProgress: (Float) -> Unit): List<SpeakerTurn>
}

/** 認識結果。words の時刻は渡した samples の先頭からの相対秒。 */
data class RecognizedText(val text: String, val words: List<Word> = emptyList())

/** 音声認識。engine ごとに hotwords / prompt の扱いは異なる（使えない場合は無視してよい）。 */
interface Recognizer {
    fun transcribe(samples: FloatArray, sampleRate: Int, hotwords: List<String>, prompt: String): RecognizedText
}

/** 途中結果の永続化。再開時は completedCount 以降のタスクだけを処理する。 */
interface CheckpointStore {
    fun loadPlan(jobId: Long): List<Task>?
    fun savePlan(jobId: Long, tasks: List<Task>)
    fun completedCount(jobId: Long): Int

    /** タスク taskIndex の完了を記録する。segment が null なら無音/空認識。1回の呼び出しは原子的であること。 */
    fun saveResult(jobId: Long, taskIndex: Int, segment: Segment?)
    fun loadSegments(jobId: Long): List<Segment>
}

enum class Stage { ANALYZE, DETECT, DIARIZE, RECOGNIZE }

fun interface ProgressListener {
    /** @param fraction 全体の進捗 0..1。 */
    fun onProgress(stage: Stage, fraction: Float)
}

data class PipelineOptions(
    val maxChunkSec: Double = 28.0,
    val chunkOverlapSec: Double = 2.0,
    val minPieceSec: Double = 0.6,
    val numSpeakers: Int? = null,
    val diarize: Boolean = false,
    val targetRmsDb: Double = -20.0,
    /** これ未満の無音に近いタスクは認識せずスキップ（幻覚抑制）。RMS(線形)。 */
    val minTaskRms: Float = 0.0015f,
)

/**
 * 文字起こしパイプライン: 正規化 → VAD → (話者分離) → 区間ごと認識 → 辞書置換。
 * 全タスクをチェックポイント保存するので、キャンセル・失敗後に [run] を再呼び出しすると続きから再開する。
 * キャンセルは呼び出し元コルーチンのキャンセルで行う。
 */
class TranscriptionPipeline(
    private val detector: SpeechDetector,
    private val recognizer: Recognizer,
    private val store: CheckpointStore,
    private val diarizer: Diarizer? = null,
) {
    suspend fun run(
        jobId: Long,
        source: PcmSource,
        glossary: Glossary = Glossary.EMPTY,
        options: PipelineOptions = PipelineOptions(),
        listener: ProgressListener = ProgressListener { _, _ -> },
    ): List<Segment> {
        val sr = source.sampleRate
        listener.onProgress(Stage.ANALYZE, 0f)
        val gain = analyzeGain(source, options.targetRmsDb)
        val gained = GainedSource(source, gain)
        currentCoroutineContext().ensureActive()

        val tasks = store.loadPlan(jobId) ?: buildPlan(jobId, gained, options, listener)
        val done = store.completedCount(jobId)
        val prompt = glossary.buildPrompt()
        val hotwords = glossary.hotwords()
        for (i in done until tasks.size) {
            currentCoroutineContext().ensureActive()
            val t = tasks[i]
            val seg = recognizeTask(i, t, gained, sr, hotwords, prompt, options)
            store.saveResult(jobId, i, seg?.let { it.copy(text = glossary.apply(it.rawText)) })
            listener.onProgress(Stage.RECOGNIZE, (i + 1).toFloat() / tasks.size)
        }
        listener.onProgress(Stage.RECOGNIZE, 1f)
        return store.loadSegments(jobId)
    }

    private fun analyzeGain(source: PcmSource, targetRmsDb: Double): Float {
        val stats = LevelStats()
        val block = source.sampleRate * 30
        var pos = 0L
        while (pos < source.totalSamples) {
            stats.add(source.read(pos, block))
            pos += block
        }
        return stats.gain(targetRmsDb)
    }

    private suspend fun buildPlan(jobId: Long, src: PcmSource, o: PipelineOptions, l: ProgressListener): List<Task> {
        val regions = detector.detect(src) { l.onProgress(Stage.DETECT, it) }
        currentCoroutineContext().ensureActive()
        val turns = if (o.diarize && diarizer != null) {
            Speakers.renumberByFirstAppearance(diarizer.diarize(src, o.numSpeakers) { l.onProgress(Stage.DIARIZE, it) })
        } else {
            emptyList()
        }
        val tasks = Speakers.splitRegions(regions, turns, src.sampleRate, o.minPieceSec)
        store.savePlan(jobId, tasks)
        return tasks
    }

    private fun recognizeTask(
        index: Int,
        t: Task,
        src: PcmSource,
        sr: Int,
        hotwords: List<String>,
        prompt: String,
        o: PipelineOptions,
    ): Segment? {
        val chunks = ChunkPlanner.plan(
            t.end - t.start,
            AudioMath.secToSamples(o.maxChunkSec, sr),
            AudioMath.secToSamples(o.chunkOverlapSec, sr),
        )
        var text = ""
        val words = ArrayList<Word>()
        var any = false
        chunks.forEachIndexed { k, c ->
            val abs0 = t.start + c.start
            val samples = src.read(abs0, (c.end - c.start).toInt())
            if (rms(samples) < o.minTaskRms) return@forEachIndexed
            any = true
            val r = recognizer.transcribe(samples, sr, hotwords, prompt)
            text = OverlapMerger.merge(text, r.text.trim())
            val offset = AudioMath.samplesToSec(abs0, sr)
            val half = o.chunkOverlapSec / 2
            val lo = if (k == 0) Double.NEGATIVE_INFINITY else offset + half
            val hi = if (k == chunks.lastIndex) Double.POSITIVE_INFINITY else AudioMath.samplesToSec(t.start + c.end, sr) - half
            for (w in r.words) {
                val ws = offset + w.start
                if (ws >= lo && ws < hi) words += Word(w.text, ws, offset + w.end)
            }
        }
        if (!any || text.isBlank()) return null
        return Segment(
            index = index,
            start = AudioMath.samplesToSec(t.start, sr),
            end = AudioMath.samplesToSec(t.end, sr),
            rawText = text,
            speakerId = t.speaker,
            words = words,
        )
    }

    private fun rms(a: FloatArray): Float {
        if (a.isEmpty()) return 0f
        var s = 0.0
        for (v in a) s += v.toDouble() * v
        return Math.sqrt(s / a.size).toFloat()
    }
}

/** 読み出し時にゲインを掛ける。 */
internal class GainedSource(private val inner: PcmSource, private val gain: Float) : PcmSource {
    override val sampleRate: Int get() = inner.sampleRate
    override val totalSamples: Long get() = inner.totalSamples
    override fun read(start: Long, length: Int): FloatArray {
        val a = inner.read(start, length)
        if (gain != 1f) for (i in a.indices) a[i] = (a[i] * gain).coerceIn(-1f, 1f)
        return a
    }
}

/** メモリ上の PCM（テスト・短い音声用）。 */
class ArrayPcmSource(private val data: FloatArray, override val sampleRate: Int = AudioMath.SAMPLE_RATE) : PcmSource {
    override val totalSamples: Long get() = data.size.toLong()
    override fun read(start: Long, length: Int): FloatArray {
        val s = start.coerceIn(0, data.size.toLong()).toInt()
        val e = (start + length).coerceIn(s.toLong(), data.size.toLong()).toInt()
        return data.copyOfRange(s, e)
    }
}
