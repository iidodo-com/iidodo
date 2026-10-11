// 超小型の量子コンピュータ・シミュレータ（教材用）
// このアプリで使うゲート(H, X, Z, CNOT)は実数だけで書けるので、振幅は実数で扱う。
// 量子ビット 0 番を一番左のビットとして表示する（例: 3量子ビットの |101⟩ = q0=1, q1=0, q2=1）。
const Q = (() => {
  const S = Math.SQRT1_2;
  const H = [S, S, S, -S];
  const X = [0, 1, 1, 0];
  const Z = [1, 0, 0, -1];

  function create(n) {
    const amp = new Float64Array(1 << n);
    amp[0] = 1;
    return { n, amp };
  }

  function clone(s) {
    return { n: s.n, amp: Float64Array.from(s.amp) };
  }

  // 1量子ビットゲートを q 番目に適用
  function apply1(s, q, m) {
    const bit = 1 << (s.n - 1 - q);
    const a = s.amp;
    for (let i = 0; i < a.length; i++) {
      if (i & bit) continue;
      const j = i | bit;
      const x = a[i];
      const y = a[j];
      a[i] = m[0] * x + m[1] * y;
      a[j] = m[2] * x + m[3] * y;
    }
  }

  // CNOT: control が 1 のとき target を反転
  function cnot(s, c, t) {
    const cb = 1 << (s.n - 1 - c);
    const tb = 1 << (s.n - 1 - t);
    const a = s.amp;
    for (let i = 0; i < a.length; i++) {
      if ((i & cb) && !(i & tb)) {
        const j = i | tb;
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
    }
  }

  function probs(s) {
    return Array.from(s.amp, (v) => v * v);
  }

  // 全体を観測して、結果の番号を返す（状態もその結果に収縮する）
  function measureAll(s) {
    const p = probs(s);
    let r = Math.random();
    let k = p.length - 1;
    for (let i = 0; i < p.length; i++) {
      r -= p[i];
      if (r < 0) { k = i; break; }
    }
    s.amp.fill(0);
    s.amp[k] = 1;
    return k;
  }

  // 1つの量子ビットだけ観測（0 or 1 を返し、残りは正規化し直す）
  function measureQubit(s, q) {
    const bit = 1 << (s.n - 1 - q);
    const a = s.amp;
    let p1 = 0;
    for (let i = 0; i < a.length; i++) if (i & bit) p1 += a[i] * a[i];
    const r = Math.random() < p1 ? 1 : 0;
    let norm = 0;
    for (let i = 0; i < a.length; i++) {
      if (!!(i & bit) !== !!r) a[i] = 0;
      else norm += a[i] * a[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < a.length; i++) a[i] /= norm;
    return r;
  }

  // 状態を壊さずに k 回ぶん観測した度数を返す
  function sample(s, k) {
    const p = probs(s);
    const counts = new Array(p.length).fill(0);
    for (let n = 0; n < k; n++) {
      let r = Math.random();
      let idx = p.length - 1;
      for (let i = 0; i < p.length; i++) {
        r -= p[i];
        if (r < 0) { idx = i; break; }
      }
      counts[idx]++;
    }
    return counts;
  }

  function label(i, n) {
    return i.toString(2).padStart(n, "0");
  }

  return { H, X, Z, create, clone, apply1, cnot, probs, measureAll, measureQubit, sample, label };
})();
