package com.iidodo.transcriber.audio

import com.iidodo.transcriber.core.AudioMath
import com.iidodo.transcriber.core.PcmSource
import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile

/** 16kHz モノラル 16bit LE PCM（生、または 44 バイトヘッダの WAV）をファイルから読む。 */
class FilePcmSource(file: File, private val headerBytes: Int = 0) : PcmSource, Closeable {
    private val raf = RandomAccessFile(file, "r")
    override val totalSamples: Long = ((raf.length() - headerBytes).coerceAtLeast(0)) / 2

    @Synchronized
    override fun read(start: Long, length: Int): FloatArray {
        val s = start.coerceIn(0, totalSamples)
        val n = minOf(length.toLong(), totalSamples - s).toInt().coerceAtLeast(0)
        if (n == 0) return FloatArray(0)
        val bytes = ByteArray(n * 2)
        raf.seek(headerBytes + s * 2)
        raf.readFully(bytes)
        return FloatArray(n) { i ->
            val lo = bytes[2 * i].toInt() and 0xFF
            val hi = bytes[2 * i + 1].toInt()
            ((hi shl 8) or lo).toShort() / 32768f
        }
    }

    /** 全体を読み込む（話者分離用。長時間音声ではメモリを使う）。 */
    fun readAll(): FloatArray = read(0, totalSamples.toInt())

    override fun close() = raf.close()

    companion object {
        const val WAV_HEADER = 44
        val SAMPLE_RATE = AudioMath.SAMPLE_RATE
    }
}
