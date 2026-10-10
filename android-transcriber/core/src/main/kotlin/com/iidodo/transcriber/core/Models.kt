package com.iidodo.transcriber.core

import java.time.LocalDateTime

/** 単語（または文字・トークン）単位のタイムスタンプ。秒。 */
data class Word(val text: String, val start: Double, val end: Double)

/**
 * 文字起こしの1区間。
 *
 * @property rawText 認識エンジンの出力そのまま（辞書置換前）。
 * @property text 表示・出力に使う本文（辞書置換・手修正後）。
 * @property edited ユーザーが手修正した場合 true。辞書の再適用の対象外になる。
 */
data class Segment(
    val index: Int,
    val start: Double,
    val end: Double,
    val rawText: String,
    val text: String = rawText,
    val speakerId: Int? = null,
    val words: List<Word> = emptyList(),
    val edited: Boolean = false,
)

/** 話者分離の1区間。秒。 */
data class SpeakerTurn(val start: Double, val end: Double, val speaker: Int)

/** サンプル単位の区間 [start, end)。 */
data class SampleRange(val start: Long, val end: Long) {
    init {
        require(end >= start) { "end < start" }
    }

    val length: Long get() = end - start
}

/** 処理タスク（VAD 区間を話者境界で分割したもの）。サンプル単位。 */
data class Task(val start: Long, val end: Long, val speaker: Int?)

/** 議事録のヘッダ情報。 */
data class MeetingInfo(
    val title: String = "",
    val dateTime: LocalDateTime? = null,
    val attendees: List<String> = emptyList(),
)

/** 出力対象。話者名は speakerNames で解決する。 */
data class Transcript(
    val info: MeetingInfo,
    val segments: List<Segment>,
    val speakerNames: Map<Int, String> = emptyMap(),
) {
    /** 話者 ID の表示名。未設定なら「話者N」(1始まり)。null は空文字。 */
    fun speakerLabel(id: Int?): String = when (id) {
        null -> ""
        else -> speakerNames[id]?.takeIf { it.isNotBlank() } ?: "話者${id + 1}"
    }
}

/** タイムスタンプの粒度。 */
enum class Granularity { SEGMENT, WORD }
