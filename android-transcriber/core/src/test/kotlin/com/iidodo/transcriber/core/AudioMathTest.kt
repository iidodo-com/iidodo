package com.iidodo.transcriber.core

import kotlin.math.abs
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AudioMathTest {
    private fun sine(amp: Float, n: Int = 16000) = FloatArray(n) { amp * sin(it * 0.1f) }

    @Test
    fun `pcm16 round trip`() {
        val f = floatArrayOf(0f, 0.5f, -0.5f, 1f, -1f)
        val back = AudioMath.pcm16ToFloat(AudioMath.floatToPcm16(f))
        f.indices.forEach { assertTrue(abs(f[it] - back[it]) < 1e-3, "idx $it") }
    }

    @Test
    fun `meter level is zero for silence and rises with amplitude`() {
        assertEquals(0f, AudioMath.meterLevel(FloatArray(100)))
        assertTrue(AudioMath.meterLevel(sine(0.5f)) > AudioMath.meterLevel(sine(0.01f)))
        assertTrue(AudioMath.meterLevel(sine(1f)) <= 1f)
    }

    @Test
    fun `gain amplifies quiet audio but not beyond peak ceiling`() {
        val s = LevelStats().apply { add(sine(0.01f)) }
        val g = s.gain()
        assertTrue(g > 1f)
        assertTrue(0.01f * g <= 0.97f + 1e-6f)
    }

    @Test
    fun `gain is capped by max gain db`() {
        val s = LevelStats().apply { add(sine(0.0005f)) }
        assertTrue(s.gain(maxGainDb = 20.0) <= 10.0001f)
    }

    @Test
    fun `gain does not clip loud audio and returns 1 for silence`() {
        val loud = LevelStats().apply { add(sine(0.99f)) }
        assertTrue(loud.gain() * 0.99f <= 0.97f + 1e-6f)
        assertEquals(1f, LevelStats().apply { add(FloatArray(100)) }.gain())
        assertEquals(1f, LevelStats().gain())
    }

    @Test
    fun `chunk planner covers whole range with overlap`() {
        val chunks = ChunkPlanner.plan(total = 100, chunk = 40, overlap = 10)
        assertEquals(0L, chunks.first().start)
        assertEquals(100L, chunks.last().end)
        chunks.zipWithNext().forEach { (a, b) ->
            assertEquals(10L, a.end - b.start, "overlap")
            assertTrue(b.end > a.end)
        }
    }

    @Test
    fun `chunk planner short audio is a single chunk and validates args`() {
        assertEquals(listOf(Chunk(0, 30)), ChunkPlanner.plan(30, 40, 10))
        assertEquals(emptyList(), ChunkPlanner.plan(0, 40, 10))
        assertFailsWith<IllegalArgumentException> { ChunkPlanner.plan(100, 40, 40) }
    }

    @Test
    fun `chunk planner exact multiple does not emit tail-only chunk`() {
        val chunks = ChunkPlanner.plan(70, 40, 10) // step 30: [0,40) [30,70)
        assertEquals(listOf(Chunk(0, 40), Chunk(30, 70)), chunks)
    }

    @Test
    fun `overlap merger removes duplicated boundary text`() {
        assertEquals("今日は会議を始めます", OverlapMerger.merge("今日は会議を", "会議を始めます"))
        assertEquals("abcdef", OverlapMerger.merge("abc", "def"))
        assertEquals("x", OverlapMerger.merge("", "x"))
        assertEquals("x", OverlapMerger.merge("x", ""))
    }
}
