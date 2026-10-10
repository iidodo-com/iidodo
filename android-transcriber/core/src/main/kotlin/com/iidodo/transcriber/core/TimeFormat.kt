package com.iidodo.transcriber.core

/** タイムスタンプ整形。 */
object TimeFormat {
    private fun parts(sec: Double): LongArray {
        val totalMs = Math.round(sec.coerceAtLeast(0.0) * 1000)
        return longArrayOf(totalMs / 3_600_000, totalMs / 60_000 % 60, totalMs / 1000 % 60, totalMs % 1000)
    }

    /** `HH:MM:SS`（議事録・txt 用）。 */
    fun hms(sec: Double): String = parts(sec).let { "%02d:%02d:%02d".format(it[0], it[1], it[2]) }

    /** SRT 形式 `HH:MM:SS,mmm`。 */
    fun srt(sec: Double): String = parts(sec).let { "%02d:%02d:%02d,%03d".format(it[0], it[1], it[2], it[3]) }

    /** WebVTT 形式 `HH:MM:SS.mmm`。 */
    fun vtt(sec: Double): String = srt(sec).replace(',', '.')
}
