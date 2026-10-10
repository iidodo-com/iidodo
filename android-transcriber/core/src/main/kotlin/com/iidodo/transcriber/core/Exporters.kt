package com.iidodo.transcriber.core

import java.io.ByteArrayOutputStream
import java.time.format.DateTimeFormatter
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

enum class ExportFormat(val extension: String, val mime: String) {
    TXT("txt", "text/plain"),
    MD("md", "text/markdown"),
    SRT("srt", "application/x-subrip"),
    VTT("vtt", "text/vtt"),
    DOCX("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
}

/** 書き出し。テキスト系は String、docx は ByteArray を返す。 */
object Exporters {
    private val DATE_FMT = DateTimeFormatter.ofPattern("yyyy年M月d日(E) HH:mm", java.util.Locale.JAPANESE)

    fun export(t: Transcript, format: ExportFormat, granularity: Granularity = Granularity.SEGMENT): ByteArray =
        when (format) {
            ExportFormat.TXT -> txt(t).toByteArray(Charsets.UTF_8)
            ExportFormat.MD -> md(t).toByteArray(Charsets.UTF_8)
            ExportFormat.SRT -> srt(t, granularity).toByteArray(Charsets.UTF_8)
            ExportFormat.VTT -> vtt(t, granularity).toByteArray(Charsets.UTF_8)
            ExportFormat.DOCX -> docx(t)
        }

    /** 連続する同一話者の発言を1つの段落にまとめる。 */
    internal data class Turn(val start: Double, val speakerId: Int?, val text: String)

    internal fun turns(t: Transcript): List<Turn> {
        val out = ArrayList<Turn>()
        for (s in t.segments) {
            val text = s.text.trim()
            if (text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.speakerId == s.speakerId && s.speakerId != null) {
                out[out.lastIndex] = last.copy(text = last.text + text)
            } else {
                out += Turn(s.start, s.speakerId, text)
            }
        }
        return out
    }

    fun txt(t: Transcript): String = buildString {
        if (t.info.title.isNotBlank()) appendLine(t.info.title)
        t.info.dateTime?.let { appendLine("日時: ${DATE_FMT.format(it)}") }
        if (t.info.attendees.isNotEmpty()) appendLine("出席者: ${t.info.attendees.joinToString("、")}")
        if (isNotEmpty()) appendLine()
        for (turn in turns(t)) {
            append('[').append(TimeFormat.hms(turn.start)).append("] ")
            val label = t.speakerLabel(turn.speakerId)
            if (label.isNotEmpty()) append(label).append(": ")
            appendLine(turn.text)
        }
    }

    fun md(t: Transcript): String = buildString {
        appendLine("# ${t.info.title.ifBlank { "議事録" }}")
        appendLine()
        t.info.dateTime?.let { appendLine("- **日時**: ${DATE_FMT.format(it)}") }
        if (t.info.attendees.isNotEmpty()) appendLine("- **出席者**: ${t.info.attendees.joinToString("、")}")
        appendLine()
        appendLine("## 発言記録")
        appendLine()
        for (turn in turns(t)) {
            val label = t.speakerLabel(turn.speakerId)
            append("**").append(label.ifEmpty { "発言" }).append("** (").append(TimeFormat.hms(turn.start)).appendLine(")")
            appendLine()
            appendLine(turn.text)
            appendLine()
        }
    }

    internal data class Cue(val start: Double, val end: Double, val text: String)

    internal fun cues(t: Transcript, granularity: Granularity): List<Cue> = buildList {
        for (s in t.segments) {
            if (s.text.isBlank()) continue
            val label = t.speakerLabel(s.speakerId)
            val prefix = if (label.isEmpty()) "" else "$label: "
            // 単語単位は、辞書置換前の語しか持たないため、手修正・辞書適用済みの場合はセグメント単位に戻す
            val useWords = granularity == Granularity.WORD && s.words.isNotEmpty() && !s.edited && s.text == s.rawText
            if (useWords) {
                s.words.forEachIndexed { i, w -> add(Cue(w.start, w.end, if (i == 0) prefix + w.text else w.text)) }
            } else {
                add(Cue(s.start, s.end, prefix + s.text.trim()))
            }
        }
    }

    fun srt(t: Transcript, granularity: Granularity = Granularity.SEGMENT): String = buildString {
        cues(t, granularity).forEachIndexed { i, c ->
            appendLine(i + 1)
            appendLine("${TimeFormat.srt(c.start)} --> ${TimeFormat.srt(c.end)}")
            appendLine(c.text)
            appendLine()
        }
    }

    fun vtt(t: Transcript, granularity: Granularity = Granularity.SEGMENT): String = buildString {
        appendLine("WEBVTT")
        appendLine()
        for (c in cues(t, granularity)) {
            appendLine("${TimeFormat.vtt(c.start)} --> ${TimeFormat.vtt(c.end)}")
            appendLine(c.text)
            appendLine()
        }
    }

    // ---- docx（最小限の OOXML を自前生成。外部ライブラリ不要で Android でも動く）----

    fun docx(t: Transcript): ByteArray {
        val bos = ByteArrayOutputStream()
        ZipOutputStream(bos).use { zip ->
            fun put(name: String, content: String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(content.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
            put("[Content_Types].xml", CONTENT_TYPES)
            put("_rels/.rels", RELS)
            put("word/_rels/document.xml.rels", DOC_RELS)
            put("word/styles.xml", STYLES)
            put("word/document.xml", documentXml(t))
        }
        return bos.toByteArray()
    }

    private fun esc(s: String): String = buildString(s.length) {
        for (c in s) when (c) {
            '&' -> append("&amp;")
            '<' -> append("&lt;")
            '>' -> append("&gt;")
            '"' -> append("&quot;")
            else -> if (c.code >= 0x20 || c == '\t') append(c)
        }
    }

    private fun run(text: String, bold: Boolean = false): String =
        "<w:r>${if (bold) "<w:rPr><w:b/></w:rPr>" else ""}<w:t xml:space=\"preserve\">${esc(text)}</w:t></w:r>"

    private fun para(inner: String, style: String? = null): String =
        "<w:p>${if (style != null) "<w:pPr><w:pStyle w:val=\"$style\"/></w:pPr>" else ""}$inner</w:p>"

    private fun cell(text: String, bold: Boolean, width: Int): String =
        "<w:tc><w:tcPr><w:tcW w:w=\"$width\" w:type=\"dxa\"/></w:tcPr>${para(run(text, bold))}</w:tc>"

    internal fun documentXml(t: Transcript): String {
        val body = StringBuilder()
        body.append(para(run(t.info.title.ifBlank { "議事録" }), "Title"))
        val rows = buildList {
            add("日時" to (t.info.dateTime?.let { DATE_FMT.format(it) } ?: ""))
            add("出席者" to t.info.attendees.joinToString("、"))
        }
        body.append("<w:tbl><w:tblPr><w:tblW w:w=\"9000\" w:type=\"dxa\"/><w:tblBorders>")
        for (side in listOf("top", "left", "bottom", "right", "insideH", "insideV")) {
            body.append("<w:$side w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"999999\"/>")
        }
        body.append("</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w=\"1800\"/><w:gridCol w:w=\"7200\"/></w:tblGrid>")
        for ((k, v) in rows) body.append("<w:tr>${cell(k, true, 1800)}${cell(v, false, 7200)}</w:tr>")
        body.append("</w:tbl>")
        body.append(para(run("発言記録"), "Heading1"))
        for (turn in turns(t)) {
            val label = t.speakerLabel(turn.speakerId).ifEmpty { "発言" }
            body.append(para(run(label, bold = true) + run("  (${TimeFormat.hms(turn.start)})")))
            body.append(para(run(turn.text)))
        }
        return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$body<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>"""
    }

    private const val CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"""

    private const val RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""

    private const val DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"""

    private const val STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Yu Gothic" w:eastAsia="Yu Gothic" w:hAnsi="Yu Gothic"/><w:sz w:val="21"/><w:lang w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>"""
}
