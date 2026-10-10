package com.iidodo.transcriber.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SpeakersTest {
    private fun r(s: Double, e: Double) = SampleRange((s * 16000).toLong(), (e * 16000).toLong())

    @Test
    fun `no turns keeps regions without speaker`() {
        val t = Speakers.splitRegions(listOf(r(0.0, 5.0)), emptyList())
        assertEquals(listOf(Task(0, 80000, null)), t)
    }

    @Test
    fun `region is split at speaker change`() {
        val turns = listOf(SpeakerTurn(0.0, 4.0, 0), SpeakerTurn(4.0, 9.0, 1))
        val t = Speakers.splitRegions(listOf(r(1.0, 8.0)), turns)
        assertEquals(2, t.size)
        assertEquals(0, t[0].speaker)
        assertEquals(1, t[1].speaker)
        assertEquals(r(1.0, 8.0).start, t.first().start)
        assertEquals(r(1.0, 8.0).end, t.last().end)
        assertEquals(t[0].end, t[1].start)
    }

    @Test
    fun `tiny piece is absorbed instead of creating a new speaker segment`() {
        val turns = listOf(SpeakerTurn(0.0, 4.9, 0), SpeakerTurn(4.9, 5.2, 1), SpeakerTurn(5.2, 10.0, 0))
        val t = Speakers.splitRegions(listOf(r(0.0, 10.0)), turns, minPieceSec = 0.6)
        assertEquals(1, t.size)
        assertEquals(0, t.single().speaker)
    }

    @Test
    fun `tasks are contiguous within a region and cover it`() {
        val turns = listOf(SpeakerTurn(0.0, 3.0, 0), SpeakerTurn(5.0, 9.0, 1))
        val region = r(0.0, 9.0)
        val t = Speakers.splitRegions(listOf(region), turns)
        assertEquals(region.start, t.first().start)
        assertEquals(region.end, t.last().end)
        t.zipWithNext().forEach { (a, b) -> assertEquals(a.end, b.start) }
    }

    @Test
    fun `assign picks max overlap speaker`() {
        val segs = listOf(Segment(0, 0.0, 10.0, "a"), Segment(1, 20.0, 21.0, "b"))
        val turns = listOf(SpeakerTurn(0.0, 3.0, 0), SpeakerTurn(3.0, 10.0, 1))
        val out = Speakers.assign(segs, turns)
        assertEquals(1, out[0].speakerId)
        assertNull(out[1].speakerId) // 1秒以内に話者区間がない
    }

    @Test
    fun `renumber by first appearance and merge`() {
        val turns = listOf(SpeakerTurn(5.0, 6.0, 7), SpeakerTurn(0.0, 1.0, 3))
        val r = Speakers.renumberByFirstAppearance(turns)
        assertEquals(1, r[0].speaker)
        assertEquals(0, r[1].speaker)
        val segs = listOf(Segment(0, 0.0, 1.0, "a", speakerId = 2), Segment(1, 1.0, 2.0, "b", speakerId = 1))
        assertEquals(listOf(1, 1), Speakers.mergeSpeakers(segs, 2, 1).map { it.speakerId })
    }
}
