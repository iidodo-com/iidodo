package com.iidodo.transcriber.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LinearResamplerTest {
    private fun run(inRate: Int, input: FloatArray): FloatArray {
        val r = AudioDecoder.LinearResampler()
        val out = ArrayList<Float>()
        for (x in input) r.push(x, inRate) { out += it }
        return out.toFloatArray()
    }

    @Test
    fun `16k passes through unchanged`() {
        val x = FloatArray(100) { it / 100f }
        assertEquals(x.toList(), run(16000, x).toList())
    }

    @Test
    fun `44_1k to 16k keeps duration within one sample`() {
        val out = run(44100, FloatArray(44100))
        assertTrue("size=${out.size}", abs(out.size - 16000) <= 2)
    }

    @Test
    fun `48k to 16k keeps duration and low frequency tone`() {
        val f = 440.0
        val input = FloatArray(48000) { sin(2 * PI * f * it / 48000).toFloat() }
        val out = run(48000, input)
        assertTrue("size=${out.size}", abs(out.size - 16000) <= 2)
        for (i in 100 until 200) {
            val expected = sin(2 * PI * f * i / 16000).toFloat()
            assertEquals(expected, out[i], 0.05f)
        }
    }

    @Test
    fun `8k upsamples to 16k`() {
        val out = run(8000, FloatArray(8000) { 0.5f })
        assertTrue(abs(out.size - 16000) <= 2)
        assertTrue(out.all { abs(it - 0.5f) < 1e-6f })
    }
}
