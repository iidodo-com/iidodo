/**
 * ダメージ計算 (純関数)。
 *   dmg = atk × 倍率 × 40/(40+def) × 乱数(±variance) × (クリティカル時 critMul)
 * 防御は上げるほど効くが 0 にはならない。最小 1。
 */
export function calcDamage({ atk, def = 0, mul = 1, critRate = 0, critMul = 1.6, variance = 0.1, bonus = 1, rand = Math.random }) {
  const base = atk * mul * (40 / (40 + Math.max(def, 0)));
  const v = 1 + (rand() * 2 - 1) * variance;
  const crit = rand() < critRate;
  const dmg = Math.max(1, Math.round(base * v * (crit ? critMul : 1) * bonus));
  return { dmg, crit };
}
