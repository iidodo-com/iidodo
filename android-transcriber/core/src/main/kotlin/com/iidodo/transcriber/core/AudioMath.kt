package com.iidodo.transcriber.core

import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/** 16kHz モノラル PCM に関する純粋関数群。 */
object AudioMath {
    const val SAMPLE_RATE = 16_000

    fun pcm16ToFloat(src: ShortArray, length: Int = src.size): FloatArray =
        FloatArray(length) { src[it] / 32768f }

    fun floatToPcm16(src: FloatArray): ShortArray =
        ShortArray(src.size) { (src[it].coerceIn(-1f, 1f) * 32767f).toInt().toShort() }

    /** ブロックの RMS を 0..1 に正規化したレベル（レベルメーター用、dBFS -60..0 を線形化）。 */
    fun meterLevel(block: FloatArray, length: Int = block.size): Float {
        if (length == 0) return 0f
        var sum = 0.0
        for (i in 0 until length) sum += block[i].toDouble() * block[i]
        val rms = sqrt(sum / length)
        if (rms <= 1e-6) return 0f
        val db = 20 * log10(rms)
        return ((db + 60) / 60).coerceIn(0.0, 1.0).toFloat()
    }

    /** サンプル数 → 秒。 */
    fun samplesToSec(samples: Long, sampleRate: Int = SAMPLE_RATE): Double = samples.toDouble() / sampleRate

    fun secToSamples(sec: Double, sampleRate: Int = SAMPLE_RATE): Long = (sec * sampleRate).toLong()
}

/**
 * 音量正規化のためのレベル統計。ブロックを順に add し、最後に [gain] を得る。
 * ピークで頭打ちにするのでクリッピングしない。無音のみの音声ではゲイン 1.0。
 */
class LevelStats {
    private var peak = 0f
    private var sumSq = 0.0
    private var count = 0L

    fun add(block: FloatArray, length: Int = block.size) {
        for (i in 0 until length) {
            val v = block[i]
            val a = abs(v)
            if (a > peak) peak = a
            sumSq += v.toDouble() * v
        }
        count += length
    }

    val rms: Double get() = if (count == 0L) 0.0 else sqrt(sumSq / count)
    val peakValue: Float get() = peak

    /**
     * @param targetRmsDb 目標 RMS (dBFS)。
     * @param maxGainDb 増幅の上限。ノイズの過増幅を避ける。
     * @param peakCeiling ピークの上限（線形）。
     */
    fun gain(targetRmsDb: Double = -20.0, maxGainDb: Double = 20.0, peakCeiling: Float = 0.97f): Float {
        if (count == 0L || rms < 1e-5 || peak <= 0f) return 1f
        val wantDb = targetRmsDb - 20 * log10(rms)
        val gainByRms = 10.0.pow(min(wantDb, maxGainDb) / 20)
        val gainByPeak = peakCeiling / peak.toDouble()
        return min(gainByRms, gainByPeak).toFloat()
    }
}

/** 長時間音声のチャンク（サンプル単位）。 */
data class Chunk(val start: Long, val end: Long)

/** 重なり付きチャンク分割。境界の単語欠落を防ぐため、隣接チャンクは overlap だけ重なる。 */
object ChunkPlanner {
    fun plan(total: Long, chunk: Long, overlap: Long): List<Chunk> {
        require(chunk > 0) { "chunk must be positive" }
        require(overlap in 0 until chunk) { "overlap must be in [0, chunk)" }
        if (total <= 0) return emptyList()
        if (total <= chunk) return listOf(Chunk(0, total))
        val result = ArrayList<Chunk>()
        val step = chunk - overlap
        var start = 0L
        while (true) {
            val end = min(start + chunk, total)
            result += Chunk(start, end)
            if (end >= total) break
            start += step
        }
        return result
    }
}

/** 重なり部分で重複した文字列を除去して結合する。 */
object OverlapMerger {
    /**
     * prev の末尾と next の先頭の最長一致（minOverlap 文字以上）を重複とみなして除く。
     * 一致がなければ単純連結。
     */
    fun merge(prev: String, next: String, minOverlap: Int = 3): String {
        if (prev.isEmpty()) return next
        if (next.isEmpty()) return prev
        val maxK = min(prev.length, next.length)
        for (k in maxK downTo max(1, minOverlap)) {
            if (prev.regionMatches(prev.length - k, next, 0, k)) return prev + next.substring(k)
        }
        return prev + next
    }
}
