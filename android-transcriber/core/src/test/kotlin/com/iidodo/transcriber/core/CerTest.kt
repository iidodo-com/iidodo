package com.iidodo.transcriber.core

import kotlin.test.Test
import kotlin.test.assertEquals

class CerTest {
    @Test
    fun `identical text is zero`() = assertEquals(0.0, Cer.rate("今日は晴れです。", "今日は 晴れです"))

    @Test
    fun `one substitution out of five`() = assertEquals(0.2, Cer.rate("今日は晴れ", "今日は雨れ"), 1e-9)

    @Test
    fun `insertions and deletions counted`() {
        assertEquals(1.0 / 3, Cer.rate("あいう", "あいうえ"), 1e-9)
        assertEquals(1.0 / 3, Cer.rate("あいう", "あい"), 1e-9)
    }

    @Test
    fun `empty reference`() {
        assertEquals(0.0, Cer.rate("", ""))
        assertEquals(1.0, Cer.rate("", "あ"))
    }
}
