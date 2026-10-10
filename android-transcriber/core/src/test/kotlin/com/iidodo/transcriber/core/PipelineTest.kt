package com.iidodo.transcriber.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private class MemStore : CheckpointStore {
    var plan: List<Task>? = null
    val results = sortedMapOf<Int, Segment?>()
    var planSaves = 0
    override fun loadPlan(jobId: Long) = plan
    override fun savePlan(jobId: Long, tasks: List<Task>) { plan = tasks; planSaves++ }
    override fun completedCount(jobId: Long) = results.size
    override fun saveResult(jobId: Long, taskIndex: Int, segment: Segment?) { results[taskIndex] = segment }
    override fun loadSegments(jobId: Long) = results.values.filterNotNull()
}

private class FixedVad(val regions: List<SampleRange>) : SpeechDetector {
    var calls = 0
    override suspend fun detect(source: PcmSource, onProgress: (Float) -> Unit): List<SampleRange> { calls++; return regions }
}

private class FixedDiarizer(val turns: List<SpeakerTurn>) : Diarizer {
    override suspend fun diarize(source: PcmSource, numSpeakers: Int?, onProgress: (Float) -> Unit) = turns
}

/** 先頭サンプルの値で識別する偽の認識器。 */
private class FakeRecognizer(val onCall: (Int) -> Unit = {}) : Recognizer {
    val calls = ArrayList<Pair<Int, List<String>>>()
    var prompt = ""
    override fun transcribe(samples: FloatArray, sampleRate: Int, hotwords: List<String>, prompt: String): RecognizedText {
        calls += samples.size to hotwords
        this.prompt = prompt
        onCall(calls.size)
        return RecognizedText("ひろしま市の発言${calls.size}")
    }
}

class PipelineTest {
    private val sr = 16000
    private fun loud(sec: Double) = FloatArray((sec * sr).toInt()) { if (it % 2 == 0) 0.3f else -0.3f }
    private fun r(s: Double, e: Double) = SampleRange((s * sr).toLong(), (e * sr).toLong())
    private val glossary = Glossary(listOf(GlossaryEntry("広島市", listOf("ひろしま市"))))

    @Test
    fun `transcribes regions, applies glossary and passes hotwords`() = runBlocking {
        val store = MemStore()
        val rec = FakeRecognizer()
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.0, 2.0), r(3.0, 5.0))), rec, store)
        val segs = p.run(1, ArrayPcmSource(loud(6.0)), glossary)
        assertEquals(2, segs.size)
        assertEquals("ひろしま市の発言1", segs[0].rawText)
        assertEquals("広島市の発言1", segs[0].text)
        assertEquals(3.0, segs[1].start, 1e-9)
        assertEquals(listOf("広島市"), rec.calls[0].second)
        assertTrue(rec.prompt.contains("広島市"))
    }

    @Test
    fun `silent regions are not sent to the recognizer`() = runBlocking {
        val audio = FloatArray(6 * sr)
        loud(2.0).copyInto(audio, 0)
        val rec = FakeRecognizer()
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.0, 2.0), r(3.0, 5.0))), rec, MemStore())
        val segs = p.run(1, ArrayPcmSource(audio))
        assertEquals(1, rec.calls.size)
        assertEquals(1, segs.size)
    }

    @Test
    fun `long task is chunked with overlap`() = runBlocking {
        val rec = FakeRecognizer()
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.0, 60.0))), rec, MemStore())
        p.run(1, ArrayPcmSource(loud(60.0)), options = PipelineOptions(maxChunkSec = 28.0, chunkOverlapSec = 2.0))
        // step = 26s → 0-28, 26-54, 52-60
        assertEquals(listOf(28 * sr, 28 * sr, 8 * sr), rec.calls.map { it.first })
    }

    @Test
    fun `cancel then resume continues from checkpoint without redoing work`() = runBlocking {
        val store = MemStore()
        val vad = FixedVad(listOf(r(0.0, 1.0), r(1.0, 2.0), r(2.0, 3.0), r(3.0, 4.0)))
        val source = ArrayPcmSource(loud(5.0))
        var cancelAfterTwo = true
        val rec1 = FakeRecognizer { n -> if (cancelAfterTwo && n == 2) throw CancellationException("user cancel") }
        assertFailsWith<CancellationException> { TranscriptionPipeline(vad, rec1, store).run(7, source) }
        assertEquals(1, store.results.size) // 2件目は完了前に中断
        cancelAfterTwo = false

        val rec2 = FakeRecognizer()
        val segs = TranscriptionPipeline(vad, rec2, store).run(7, source)
        assertEquals(3, rec2.calls.size) // 残り3件だけ
        assertEquals(1, vad.calls) // 計画は再利用（VAD 再実行なし）
        assertEquals(1, store.planSaves)
        assertEquals(4, segs.size)
        assertEquals(listOf(0, 1, 2, 3), segs.map { it.index })
    }

    @Test
    fun `diarization assigns speakers and splits regions`() = runBlocking {
        val turns = listOf(SpeakerTurn(0.0, 3.0, 5), SpeakerTurn(3.0, 6.0, 9))
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.5, 5.5))), FakeRecognizer(), MemStore(), FixedDiarizer(turns))
        val segs = p.run(1, ArrayPcmSource(loud(6.0)), options = PipelineOptions(diarize = true))
        assertEquals(listOf(0, 1), segs.map { it.speakerId }) // 出現順に 0,1 へ振り直し
        assertEquals(segs[0].end, segs[1].start, 1e-9)
    }

    @Test
    fun `diarizer is ignored when option is off`() = runBlocking {
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.0, 2.0))), FakeRecognizer(), MemStore(), FixedDiarizer(listOf(SpeakerTurn(0.0, 2.0, 1))))
        val segs = p.run(1, ArrayPcmSource(loud(3.0)))
        assertEquals(null, segs.single().speakerId)
    }

    @Test
    fun `progress is reported and ends at 1`() = runBlocking {
        val seen = ArrayList<Pair<Stage, Float>>()
        val p = TranscriptionPipeline(FixedVad(listOf(r(0.0, 1.0), r(1.0, 2.0))), FakeRecognizer(), MemStore())
        p.run(1, ArrayPcmSource(loud(2.0)), listener = { s, f -> seen += s to f })
        assertEquals(Stage.RECOGNIZE to 1f, seen.last())
        assertTrue(seen.any { it.first == Stage.ANALYZE })
    }

    @Test
    fun `quiet audio is amplified before recognition`() = runBlocking {
        var maxSeen = 0f
        val rec = object : Recognizer {
            override fun transcribe(samples: FloatArray, sampleRate: Int, hotwords: List<String>, prompt: String): RecognizedText {
                maxSeen = samples.maxOf { kotlin.math.abs(it) }
                return RecognizedText("x")
            }
        }
        val quiet = FloatArray(2 * sr) { if (it % 2 == 0) 0.02f else -0.02f }
        TranscriptionPipeline(FixedVad(listOf(r(0.0, 2.0))), rec, MemStore()).run(1, ArrayPcmSource(quiet))
        assertTrue(maxSeen > 0.09f, "gain applied: $maxSeen") // 0.02 → 目標RMS -20dBFS(=0.1) 付近
    }
}
