package com.iidodo.transcriber.core

import kotlin.math.min

/** 文字誤り率（CER）。 */
object Cer {
    /** 空白と句読点・記号を除いてコードポイント列にする。 */
    fun normalize(s: String): IntArray =
        s.codePoints().filter { cp ->
            !Character.isWhitespace(cp) && !Character.isISOControl(cp) && when (Character.getType(cp).toByte()) {
                Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION,
                Character.END_PUNCTUATION, Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION,
                Character.OTHER_PUNCTUATION, Character.MATH_SYMBOL, Character.CURRENCY_SYMBOL,
                Character.MODIFIER_SYMBOL, Character.OTHER_SYMBOL,
                -> false
                else -> true
            }
        }.toArray()

    /** レーベンシュタイン距離。 */
    fun distance(a: IntArray, b: IntArray): Int {
        if (a.isEmpty()) return b.size
        if (b.isEmpty()) return a.size
        var prev = IntArray(b.size + 1) { it }
        var cur = IntArray(b.size + 1)
        for (i in 1..a.size) {
            cur[0] = i
            for (j in 1..b.size) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.size]
    }

    /** CER = 編集距離 / 正解の文字数。正解が空なら、仮説も空で 0.0、そうでなければ 1.0。 */
    fun rate(reference: String, hypothesis: String): Double {
        val r = normalize(reference)
        val h = normalize(hypothesis)
        if (r.isEmpty()) return if (h.isEmpty()) 0.0 else 1.0
        return distance(r, h).toDouble() / r.size
    }
}
