package com.iidodo.transcriber.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GlossaryTest {
    private val csv = """
        canonical,variants,use_prompt
        広島市,ひろしま市|広島氏,true
        DX推進課,ディーエックス推進課|DX 推進課,true
        "A,B社",エービー社,false
    """.trimIndent()

    @Test
    fun `csv parsing with quotes and flags`() {
        val g = Glossary.fromCsv(csv)
        assertEquals(3, g.entries.size)
        assertEquals("A,B社", g.entries[2].canonical)
        assertEquals(false, g.entries[2].usePrompt)
        assertEquals(listOf("ディーエックス推進課", "DX 推進課"), g.entries[1].variants)
    }

    @Test
    fun `replacement fixes variants`() {
        val g = Glossary.fromCsv(csv)
        assertEquals("広島市のDX推進課です", g.apply("ひろしま市のディーエックス推進課です"))
        assertEquals("A,B社", g.apply("エービー社"))
    }

    @Test
    fun `longest variant wins and replacement is single pass`() {
        val g = Glossary(
            listOf(
                GlossaryEntry("甲", listOf("こう")),
                GlossaryEntry("甲乙", listOf("こうおつ")),
                GlossaryEntry("こう", listOf("X")), // 置換結果の再置換が起きないこと
            ),
        )
        assertEquals("甲乙", g.apply("こうおつ"))
        assertEquals("こう", g.apply("X"))
        assertEquals("甲", g.apply("こう"))
    }

    @Test
    fun `special regex characters in variants are escaped`() {
        val g = Glossary(listOf(GlossaryEntry("C++", listOf("シープラ+(", "c.."))))
        assertEquals("C++で", g.apply("シープラ+(で"))
        assertEquals("abc", g.apply("abc")) // "c.." が正規表現として働かない
    }

    @Test
    fun `empty glossary is identity`() {
        assertEquals("そのまま", Glossary.EMPTY.apply("そのまま"))
    }

    @Test
    fun `prompt respects max length and use_prompt`() {
        val g = Glossary.fromCsv(csv)
        val p = g.buildPrompt()
        assertTrue("広島市" in p && "DX推進課" in p)
        assertTrue("A,B社" !in p)
        assertTrue(g.buildPrompt(maxChars = 8).length <= 8)
        assertEquals("", Glossary.EMPTY.buildPrompt())
    }

    @Test
    fun `json round trip and csv round trip`() {
        val g = Glossary.fromCsv(csv)
        assertEquals(g.entries, Glossary.fromJson(g.toJson()).entries)
        assertEquals(g.entries, Glossary.fromCsv(g.toCsv()).entries)
    }

    @Test
    fun `applyTo skips edited segments`() {
        val g = Glossary(listOf(GlossaryEntry("広島市", listOf("ひろしま市"))))
        val segs = listOf(
            Segment(0, 0.0, 1.0, "ひろしま市です"),
            Segment(1, 1.0, 2.0, "ひろしま市です", text = "手修正", edited = true),
        )
        val out = g.applyTo(segs)
        assertEquals("広島市です", out[0].text)
        assertEquals("手修正", out[1].text)
    }

    @Test
    fun `csv without header and with BOM`() {
        val g = Glossary.fromCsv("﻿用語,ようご\n")
        assertEquals("用語", g.entries.single().canonical)
        assertEquals(listOf("ようご"), g.entries.single().variants)
    }
}
