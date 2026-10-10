package com.iidodo.transcriber.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 用語辞書の1項目。
 *
 * @property canonical 正しい表記。
 * @property variants 誤認識されやすい表記ゆれ（これを canonical に置換する）。
 * @property usePrompt initial_prompt / ホットワードに使うか。
 */
data class GlossaryEntry(
    val canonical: String,
    val variants: List<String> = emptyList(),
    val usePrompt: Boolean = true,
)

/** 用語辞書。CSV/JSON で読み書きし、プロンプト生成と出力後置換を行う。 */
class Glossary(val entries: List<GlossaryEntry>) {
    private val regex: Regex?
    private val map: Map<String, String>

    init {
        val pairs = entries.flatMap { e -> e.variants.filter { it.isNotBlank() && it != e.canonical }.map { it to e.canonical } }
        val m = HashMap<String, String>()
        for ((v, c) in pairs) m.putIfAbsent(v.lowercase(), c)
        map = m
        // 長い表記ゆれを優先してマッチさせる（置換結果への再置換を避けるため1パスで処理）
        val keys = pairs.map { it.first }.distinct().sortedByDescending { it.length }
        regex = if (keys.isEmpty()) null else Regex(keys.joinToString("|") { Regex.escape(it) }, RegexOption.IGNORE_CASE)
    }

    /** 表記ゆれを正しい表記へ置換する。 */
    fun apply(text: String): String {
        val r = regex ?: return text
        return r.replace(text) { m -> map[m.value.lowercase()] ?: m.value }
    }

    /** initial_prompt 用の文字列。maxChars を超えない範囲で先頭から詰める。 */
    fun buildPrompt(maxChars: Int = 200, prefix: String = "用語: "): String {
        val sb = StringBuilder(prefix)
        var added = 0
        for (t in hotwords()) {
            val piece = if (added == 0) t else "、$t"
            if (sb.length + piece.length > maxChars) break
            sb.append(piece)
            added++
        }
        return if (added == 0) "" else sb.toString()
    }

    /** ホットワード（canonical のうち usePrompt のもの、重複なし）。 */
    fun hotwords(): List<String> = entries.filter { it.usePrompt && it.canonical.isNotBlank() }.map { it.canonical }.distinct()

    /** 手修正されていないセグメントへ辞書を（再）適用する。 */
    fun applyTo(segments: List<Segment>): List<Segment> =
        segments.map { if (it.edited) it else it.copy(text = apply(it.rawText)) }

    fun toCsv(): String {
        val sb = StringBuilder("canonical,variants,use_prompt\n")
        for (e in entries) {
            sb.append(csvField(e.canonical)).append(',')
                .append(csvField(e.variants.joinToString("|"))).append(',')
                .append(e.usePrompt).append('\n')
        }
        return sb.toString()
    }

    fun toJson(): String {
        val arr = JSONArray()
        for (e in entries) {
            arr.put(
                JSONObject()
                    .put("canonical", e.canonical)
                    .put("variants", JSONArray(e.variants))
                    .put("use_prompt", e.usePrompt),
            )
        }
        return arr.toString(2)
    }

    companion object {
        val EMPTY = Glossary(emptyList())

        /** ヘッダ行 `canonical,variants,use_prompt` を持つ CSV。variants は `|` 区切り。use_prompt は省略可。 */
        fun fromCsv(csv: String): Glossary {
            val rows = parseCsv(csv.removePrefix("﻿"))
            if (rows.isEmpty()) return EMPTY
            val header = rows.first().map { it.trim().lowercase() }
            val hasHeader = "canonical" in header
            val body = if (hasHeader) rows.drop(1) else rows
            val ci = if (hasHeader) header.indexOf("canonical") else 0
            val vi = if (hasHeader) header.indexOf("variants") else 1
            val pi = if (hasHeader) header.indexOf("use_prompt") else 2
            val entries = body.mapNotNull { r ->
                val canonical = r.getOrNull(ci)?.trim().orEmpty()
                if (canonical.isEmpty()) return@mapNotNull null
                val variants = r.getOrNull(vi).orEmpty().split('|').map { it.trim() }.filter { it.isNotEmpty() }
                val usePrompt = r.getOrNull(pi)?.trim()?.lowercase()?.let { it != "false" && it != "0" } ?: true
                GlossaryEntry(canonical, variants, usePrompt)
            }
            return Glossary(entries)
        }

        fun fromJson(json: String): Glossary {
            val arr = JSONArray(json)
            val entries = (0 until arr.length()).mapNotNull { i ->
                val o = arr.getJSONObject(i)
                val canonical = o.optString("canonical").trim()
                if (canonical.isEmpty()) return@mapNotNull null
                val va = o.optJSONArray("variants") ?: JSONArray()
                GlossaryEntry(
                    canonical,
                    (0 until va.length()).map { va.getString(it).trim() }.filter { it.isNotEmpty() },
                    o.optBoolean("use_prompt", true),
                )
            }
            return Glossary(entries)
        }

        private fun csvField(s: String): String =
            if (s.any { it == ',' || it == '"' || it == '\n' }) "\"" + s.replace("\"", "\"\"") + "\"" else s

        /** RFC4180 相当の簡易パーサ（引用符・改行を含むフィールド対応）。 */
        internal fun parseCsv(text: String): List<List<String>> {
            val rows = ArrayList<List<String>>()
            var row = ArrayList<String>()
            val field = StringBuilder()
            var inQuotes = false
            var i = 0
            while (i < text.length) {
                val c = text[i]
                when {
                    inQuotes && c == '"' && text.getOrNull(i + 1) == '"' -> { field.append('"'); i++ }
                    c == '"' -> inQuotes = !inQuotes
                    !inQuotes && c == ',' -> { row.add(field.toString()); field.clear() }
                    !inQuotes && (c == '\n' || c == '\r') -> {
                        if (c == '\r' && text.getOrNull(i + 1) == '\n') i++
                        row.add(field.toString()); field.clear()
                        if (row.any { it.isNotEmpty() }) rows.add(row)
                        row = ArrayList()
                    }
                    else -> field.append(c)
                }
                i++
            }
            if (field.isNotEmpty() || row.isNotEmpty()) {
                row.add(field.toString())
                if (row.any { it.isNotEmpty() }) rows.add(row)
            }
            return rows
        }
    }
}
