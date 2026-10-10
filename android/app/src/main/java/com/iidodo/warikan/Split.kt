package com.iidodo.warikan

/** 割り勘の計算結果。 */
data class SplitResult(
    val perPerson: Long,
    /** 集金総額（perPerson × 人数）。 */
    val collected: Long,
    /** 集金総額 − 合計金額。正なら幹事の余り、0なら過不足なし。 */
    val surplus: Long,
)

/** total を people 人で割り、unit 円単位で切り上げる。 */
fun calcSplit(total: Long, people: Int, unit: Int): SplitResult {
    require(total >= 0 && people >= 1 && unit >= 1)
    val raw = (total + people - 1) / people
    val perPerson = (raw + unit - 1) / unit * unit
    val collected = perPerson * people
    return SplitResult(perPerson, collected, collected - total)
}
