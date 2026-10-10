package com.iidodo.transcriber.core

import java.io.ByteArrayInputStream
import java.time.LocalDateTime
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExportersTest {
    private val t = Transcript(
        info = MeetingInfo("定例会議", LocalDateTime.of(2026, 10, 10, 14, 30), listOf("山田", "佐藤")),
        segments = listOf(
            Segment(0, 0.0, 2.5, "はじめます", speakerId = 0, words = listOf(Word("はじめ", 0.0, 1.2), Word("ます", 1.2, 2.5))),
            Segment(1, 2.5, 5.0, "よろしく", speakerId = 0),
            Segment(2, 3725.123, 3727.0, "了解です", speakerId = 1),
        ),
        speakerNames = mapOf(0 to "山田"),
    )

    @Test
    fun `srt format`() {
        val srt = Exporters.srt(t)
        val expectedStart = "1\n00:00:00,000 --> 00:00:02,500\n山田: はじめます\n\n"
        assertTrue(srt.startsWith(expectedStart), srt)
        assertTrue("00:00:02,500 --> 00:00:05,000" in srt)
        assertTrue("01:02:05,123 --> 01:02:07,000\n話者2: 了解です" in srt)
        assertEquals(3, Regex("^\\d+$", RegexOption.MULTILINE).findAll(srt).count())
    }

    @Test
    fun `vtt format uses dot and header`() {
        val vtt = Exporters.vtt(t)
        assertTrue(vtt.startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n山田: はじめます"))
    }

    @Test
    fun `word granularity emits one cue per word when available`() {
        val srt = Exporters.srt(t, Granularity.WORD)
        assertTrue("00:00:00,000 --> 00:00:01,200\n山田: はじめ" in srt)
        assertTrue("00:00:01,200 --> 00:00:02,500\nます" in srt)
        // 単語を持たないセグメントはセグメント単位にフォールバック
        assertTrue("よろしく" in srt)
    }

    @Test
    fun `word granularity falls back when text was edited`() {
        val edited = t.copy(segments = listOf(t.segments[0].copy(text = "修正後", edited = true)))
        val srt = Exporters.srt(edited, Granularity.WORD)
        assertTrue("山田: 修正後" in srt)
    }

    @Test
    fun `txt groups same speaker and shows header`() {
        val txt = Exporters.txt(t)
        assertTrue(txt.startsWith("定例会議\n日時: 2026年10月10日"))
        assertTrue("出席者: 山田、佐藤" in txt)
        assertTrue("[00:00:00] 山田: はじめますよろしく\n" in txt)
        assertTrue("[01:02:05] 話者2: 了解です\n" in txt)
    }

    @Test
    fun `markdown has headings and bold speaker`() {
        val md = Exporters.md(t)
        assertTrue(md.startsWith("# 定例会議\n"))
        assertTrue("- **出席者**: 山田、佐藤" in md)
        assertTrue("**山田** (00:00:00)\n\nはじめますよろしく" in md)
    }

    @Test
    fun `blank segments are skipped`() {
        val blank = t.copy(segments = listOf(Segment(0, 0.0, 1.0, "  ")))
        assertEquals("", Exporters.srt(blank))
    }

    @Test
    fun `docx is a valid zip with well-formed xml containing the text`() {
        val bytes = Exporters.docx(t)
        val entries = HashMap<String, String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            generateSequence { z.nextEntry }.forEach { e -> entries[e.name] = z.readBytes().toString(Charsets.UTF_8) }
        }
        assertEquals(
            setOf("[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/styles.xml", "word/document.xml"),
            entries.keys,
        )
        val dbf = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        entries.values.forEach { dbf.newDocumentBuilder().parse(ByteArrayInputStream(it.toByteArray())) }
        val doc = entries.getValue("word/document.xml")
        listOf("定例会議", "山田、佐藤", "はじめますよろしく", "話者2").forEach { assertTrue(it in doc, it) }
    }

    @Test
    fun `docx escapes xml special characters`() {
        val tr = t.copy(segments = listOf(Segment(0, 0.0, 1.0, "A & B <tag> \"q\"", speakerId = 0)))
        val doc = Exporters.documentXml(tr)
        assertTrue("A &amp; B &lt;tag&gt; &quot;q&quot;" in doc)
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(ByteArrayInputStream(doc.toByteArray()))
    }

    @Test
    fun `export dispatch returns utf8 bytes`() {
        assertEquals(Exporters.txt(t), Exporters.export(t, ExportFormat.TXT).toString(Charsets.UTF_8))
        assertTrue(Exporters.export(t, ExportFormat.DOCX).size > 500)
    }
}
