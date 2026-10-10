package com.iidodo.warikan

import org.junit.Assert.assertEquals
import org.junit.Test

class SplitTest {
    @Test fun roundsUpTo100() {
        val r = calcSplit(10000, 3, 100)
        assertEquals(3400, r.perPerson)
        assertEquals(10200, r.collected)
        assertEquals(200, r.surplus)
    }

    @Test fun exactDivision() {
        val r = calcSplit(9000, 3, 1)
        assertEquals(3000, r.perPerson)
        assertEquals(0, r.surplus)
    }

    @Test fun singlePerson() {
        assertEquals(1234, calcSplit(1234, 1, 1).perPerson)
    }
}
