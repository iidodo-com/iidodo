package com.iidodo.transcriber.core

import kotlin.math.max
import kotlin.math.min

/** 話者分離結果の利用。 */
object Speakers {
    /**
     * VAD 区間を話者の交代点で分割して Task にする。分割前に話者を決めておくことで、
     * 1つの発言区間に複数話者が混ざるのを防ぐ。
     *
     * @param turns 話者区間（秒）。空なら話者なし(null)の Task を返す。
     * @param minPieceSec これより短い断片は直前（なければ直後）の断片へ併合する。
     */
    fun splitRegions(
        regions: List<SampleRange>,
        turns: List<SpeakerTurn>,
        sampleRate: Int = AudioMath.SAMPLE_RATE,
        minPieceSec: Double = 0.6,
    ): List<Task> {
        if (turns.isEmpty()) return regions.map { Task(it.start, it.end, null) }
        val sorted = turns.sortedBy { it.start }
        val out = ArrayList<Task>()
        for (r in regions) {
            val rs = AudioMath.samplesToSec(r.start, sampleRate)
            val re = AudioMath.samplesToSec(r.end, sampleRate)
            // 区間内を、重なる話者区間で刻む
            val pieces = ArrayList<Triple<Double, Double, Int?>>()
            var cursor = rs
            for (t in sorted) {
                if (t.end <= rs || t.start >= re) continue
                val s = max(t.start, rs)
                val e = min(t.end, re)
                if (s > cursor) pieces += Triple(cursor, s, null) // 話者不明の隙間
                val from = max(s, cursor)
                if (e > from) {
                    pieces += Triple(from, e, t.speaker)
                    cursor = e
                }
            }
            if (cursor < re) pieces += Triple(cursor, re, null)
            if (pieces.isEmpty()) pieces += Triple(rs, re, null)
            // 短い断片・不明断片を隣へ併合し、同一話者の連続を結合
            val merged = ArrayList<Triple<Double, Double, Int?>>()
            for (p in pieces) {
                val last = merged.lastOrNull()
                val shortOrUnknown = (p.second - p.first) < minPieceSec || p.third == null
                when {
                    last != null && (last.third == p.third || shortOrUnknown) ->
                        merged[merged.lastIndex] = Triple(last.first, p.second, last.third ?: p.third)
                    else -> merged += p
                }
            }
            // 先頭が短い断片だった場合の後始末
            if (merged.size >= 2 && (merged[0].second - merged[0].first) < minPieceSec) {
                val a = merged.removeAt(0)
                val b = merged[0]
                merged[0] = Triple(a.first, b.second, b.third ?: a.third)
            }
            for (m in merged) {
                val s = if (m === merged.first()) r.start else AudioMath.secToSamples(m.first, sampleRate)
                val e = if (m === merged.last()) r.end else AudioMath.secToSamples(m.second, sampleRate)
                if (e > s) out += Task(s, e, m.third)
            }
        }
        return out
    }

    /** 話者を持たない既存セグメントに、時間の重なりが最大の話者を割り当てる（後から話者分離した場合用）。 */
    fun assign(segments: List<Segment>, turns: List<SpeakerTurn>, maxGapSec: Double = 1.0): List<Segment> {
        if (turns.isEmpty()) return segments
        return segments.map { seg ->
            val overlap = HashMap<Int, Double>()
            for (t in turns) {
                val o = min(seg.end, t.end) - max(seg.start, t.start)
                if (o > 0) overlap.merge(t.speaker, o, Double::plus)
            }
            val best = overlap.maxByOrNull { it.value }?.key ?: run {
                val mid = (seg.start + seg.end) / 2
                turns.minByOrNull { distance(mid, it) }?.takeIf { distance(mid, it) <= maxGapSec }?.speaker
            }
            seg.copy(speakerId = best)
        }
    }

    private fun distance(t: Double, turn: SpeakerTurn): Double = when {
        t < turn.start -> turn.start - t
        t > turn.end -> t - turn.end
        else -> 0.0
    }

    /** 話者 ID を出現順に 0,1,2… へ振り直す（分離モデルの ID を安定した表示順にする）。 */
    fun renumberByFirstAppearance(turns: List<SpeakerTurn>): List<SpeakerTurn> {
        val map = LinkedHashMap<Int, Int>()
        for (t in turns.sortedBy { it.start }) map.getOrPut(t.speaker) { map.size }
        return turns.map { it.copy(speaker = map.getValue(it.speaker)) }
    }

    /** 全セグメントの話者 ID を from→to に付け替える（話者の統合）。 */
    fun mergeSpeakers(segments: List<Segment>, from: Int, to: Int): List<Segment> =
        segments.map { if (it.speakerId == from) it.copy(speakerId = to) else it }
}
