(() => {
  "use strict";

  // ---------- 小さな道具 ----------
  const $ = (s, r = document) => r.querySelector(s);

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }

  const buzz = (ms = 25) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* noop */ } };

  // 効果音（WebAudio。ユーザー操作のあとに鳴る）
  const sfx = (() => {
    let ac = null, on = true;
    try { on = localStorage.getItem("quantum.mute") !== "1"; } catch (_) { /* noop */ }
    function tone(f, d = 0.12, type = "sine", v = 0.07, when = 0, slide) {
      if (!on) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === "suspended") ac.resume();
        const t = ac.currentTime + when, o = ac.createOscillator(), gn = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
        gn.gain.setValueAtTime(v, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(gn); gn.connect(ac.destination); o.start(t); o.stop(t + d + 0.03);
      } catch (_) { /* noop */ }
    }
    return {
      get on() { return on; },
      toggle() { on = !on; try { localStorage.setItem("quantum.mute", on ? "0" : "1"); } catch (_) { /* noop */ } return on; },
      tap: () => tone(520, 0.08, "triangle"),
      blip: () => tone(1200 + Math.random() * 900, 0.04, "sine", 0.025),
      gate: () => tone(330, 0.2, "sine", 0.08, 0, 760),
      measure: () => { tone(880, 0.1, "square", 0.04); tone(1320, 0.16, "sine", 0.06, 0.07); },
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "sine", 0.07, i * 0.08)),
    };
  })();
  const fx = {
    tap() { buzz(12); sfx.tap(); }, gate() { buzz(18); sfx.gate(); },
    measure() { buzz(40); sfx.measure(); }, win() { buzz([30, 40, 30]); sfx.win(); },
  };
  const pct = (v) => Math.round(v * 100) + "%";
  const sgn = (v) => (Math.abs(v) < 1e-9 ? "0.00" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(2));
  const rad = (d) => (d * Math.PI) / 180;

  // 棒グラフ（signed=true で振幅のプラス/マイナスを上下に表示）
  function bars(labels, { signed = false, height = 130, fmt } = {}) {
    const f = fmt || (signed ? sgn : pct);
    const wrap = h("div", { class: "bars" + (signed ? " signed" : ""), style: `--bh:${height}px` });
    const cols = labels.map((l) => {
      const val = h("span", { class: "bval" }, "");
      const bar = h("i", { class: "bar" });
      wrap.append(h("div", { class: "bcol" }, val, h("div", { class: "btrack" }, bar), h("span", { class: "blab" }, l)));
      return { bar, val };
    });
    wrap.set = (vals, { hot = -1, text } = {}) => {
      vals.forEach((v, i) => {
        const { bar, val } = cols[i];
        if (signed) {
          bar.style.height = Math.min(1, Math.abs(v)) * 50 + "%";
          bar.style.bottom = v >= 0 ? "50%" : "auto";
          bar.style.top = v < 0 ? "50%" : "auto";
          bar.classList.toggle("neg", v < -1e-9);
        } else {
          bar.style.height = Math.min(1, v) * 100 + "%";
        }
        bar.classList.toggle("hot", i === hot);
        val.textContent = text ? text[i] : f(v);
      });
    };
    return wrap;
  }

  function slider(min, max, value, step, onInput) {
    const s = h("input", { type: "range", class: "slider", min, max, value, step });
    s.addEventListener("input", () => onInput(parseFloat(s.value)));
    return s;
  }

  // ---------- 紙ふぶき ----------
  function confetti() {
    const c = $("#confetti");
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const colors = ["#3de6ff", "#9b7bff", "#ff5fa8", "#ffd166", "#4be0a0"];
    const ps = Array.from({ length: 110 }, () => ({
      x: innerWidth / 2, y: innerHeight * 0.65,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 16 - 4,
      s: 4 + Math.random() * 6, r: Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
    }));
    let t = 0;
    (function frame() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach((p) => {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.2;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (++t < 110) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }

  // ---------- ホームのヒーローアニメーション ----------
  let heroRaf = 0;
  function startHero() {
    cancelAnimationFrame(heroRaf);
    const cv = $("#hero-canvas");
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 360;
    const H = cv.clientHeight || 230;
    cv.width = W * dpr; cv.height = H * dpr;
    const stars = Array.from({ length: 50 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }));
    let t = 0;
    (function frame() {
      t += 0.016;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      stars.forEach((s) => {
        ctx.fillStyle = `rgba(190,210,255,${0.25 + 0.25 * Math.sin(t * 2 + s.p)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill();
      });
      const cx = W / 2, cy = H / 2 + 6;
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
      g.addColorStop(0, "#ffffffee"); g.addColorStop(0.25, "#3de6ffcc"); g.addColorStop(1, "#3de6ff00");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 46, 0, 7); ctx.fill();
      const cols = ["#3de6ff", "#9b7bff", "#ff5fa8"];
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3 + t * 0.15;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.strokeStyle = cols[i] + "66"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(0, 0, 108, 36, 0, 0, 7); ctx.stroke();
        const th = t * (1.4 + i * 0.5) + i * 2;
        const ex = Math.cos(th) * 108, ey = Math.sin(th) * 36;
        const eg = ctx.createRadialGradient(ex, ey, 0, ex, ey, 12);
        eg.addColorStop(0, "#fff"); eg.addColorStop(0.3, cols[i]); eg.addColorStop(1, cols[i] + "00");
        ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(ex, ey, 12, 0, 7); ctx.fill();
        ctx.restore();
      }
      heroRaf = requestAnimationFrame(frame);
    })();
  }

  // =====================================================================
  //  ウィジェット（さわれる実験）
  // =====================================================================
  const W = {};

  // --- 1: ふつうのビット
  W.bit = (box) => {
    let bit = 0;
    const coin = h("div", { class: "coin" }, "0");
    const btn = h("button", {
      class: "btn primary",
      onclick: () => {
        bit ^= 1; coin.textContent = bit;
        coin.classList.remove("flip"); void coin.offsetWidth; coin.classList.add("flip");
        buzz(15);
      },
    }, "スイッチを切り替える");
    box.append(h("div", { class: "wlabel" }, "ふつうのビット"), coin, h("div", { class: "row" }, btn),
      h("p", { class: "note" }, "いつ見ても、0か1のどちらか。ずっとハッキリしています。"));
  };

  // --- 1: 量子ビット（回るコイン）
  W.qubit = (box, ctx) => {
    const s = Q.create(1);
    let spinning = false;
    let timer = 0;
    const tally = [0, 0];
    const coin = h("div", { class: "coin q" }, "0");
    const note = h("p", { class: "note" }, "まずは「重ね合わせにする」を押してみて！");
    const chart = bars(["0", "1"], { height: 70, fmt: (v) => v + "回" });
    chart.set([0, 0], { text: ["0回", "0回"] });
    const hBtn = h("button", { class: "btn primary", onclick: () => {
      if (spinning) return;
      Q.apply1(s, 0, Q.H);
      spinning = true; coin.classList.add("spin"); coin.classList.remove("pop");
      timer = setInterval(() => { coin.textContent = Math.random() < 0.5 ? "0" : "1"; }, 110);
      note.innerHTML = "いま量子ビットは<b>回転中＝0と1の重ね合わせ</b>。まだ0とも1とも決まっていません。数字がチラつくのは、イメージです。次は「観測する」で止めてみよう。";
      refresh(); fx.gate(); ctx.tick(0);
    } }, "🌀 重ね合わせにする");
    const mBtn = h("button", { class: "btn", onclick: () => {
      if (!spinning) return;
      const r = Q.measureQubit(s, 0);
      clearInterval(timer); spinning = false;
      coin.classList.remove("spin"); coin.textContent = r; void coin.offsetWidth; coin.classList.add("pop");
      tally[r]++;
      const n = tally[0] + tally[1];
      chart.set([tally[0] / n, tally[1] / n], { text: [tally[0] + "回", tally[1] + "回"] });
      note.innerHTML = `止めたら <b>${r}</b> が出ました（${n}回目）。<br>観測した瞬間、「混ざった状態」は消えて、${r}にピタッと決まりました。もう一度「重ね合わせにする」で回せます。`;
      refresh(); fx.measure();
      ctx.tick(1); if (n >= 5) ctx.tick(2);
    } }, "👁 観測する");
    function refresh() { hBtn.disabled = spinning; mBtn.disabled = !spinning; }
    refresh(); ctx.hint("「重ね合わせ」→「観測」を5回くり返そう");
    box.append(h("div", { class: "wlabel" }, "量子ビット（キュービット）"), coin,
      h("div", { class: "row" }, hBtn, mBtn), note, chart);
    return () => clearInterval(timer);
  };

  // --- 2: 確率の矢印
  W.bloch = (box, ctx) => {
    let phi = 0; // 度
    const cv = h("canvas", { class: "w" });
    const size = 280;
    cv.style.height = size + "px";
    const dpr = window.devicePixelRatio || 1;
    const info = h("p", { class: "note" });
    const chart = bars(["0", "1"], { height: 70 });
    const obs = h("div", { class: "cap" }, "");
    const obsChart = bars(["0", "1"], { height: 60, fmt: (v) => v + "回" });
    obsChart.hidden = true;

    function draw() {
      const w = cv.clientWidth || 320;
      cv.width = w * dpr; cv.height = size * dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, size);
      const cx = w / 2, cy = size / 2, R = Math.min(w, size) / 2 - 38;
      ctx.strokeStyle = "#3a4888"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - R - 14, cy); ctx.lineTo(cx + R + 14, cy); ctx.moveTo(cx, cy - R - 14); ctx.lineTo(cx, cy + R + 14); ctx.stroke();
      ctx.fillStyle = "#98a4cf"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("|0⟩", cx + R + 22, cy + 5); ctx.fillText("|1⟩", cx, cy - R - 20);
      const a = Math.cos(rad(phi)), b = Math.sin(rad(phi));
      const tx = cx + a * R, ty = cy - b * R;
      // 影（射影）
      ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#3de6ff"; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, cy); ctx.stroke();
      ctx.strokeStyle = "#ff9d3d"; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(cx, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 5; ctx.strokeStyle = "#3de6ff"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, cy); ctx.stroke();
      ctx.strokeStyle = "#ff9d3d"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, ty); ctx.stroke();
      // 矢印
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, 16);
      g.addColorStop(0, "#fff"); g.addColorStop(0.35, "#9b7bff"); g.addColorStop(1, "#9b7bff00");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, 16, 0, 7); ctx.fill();
      return { a, b };
    }

    function update() {
      if (phi !== 0) ctx.tick(0);
      const { a, b } = draw();
      chart.set([a * a, b * b]);
      info.innerHTML = `影の長さ <b>${sgn(a)}</b>（横）と <span style="color:#ff9d3d;font-weight:700">${sgn(b)}</span>（縦）。<br>2乗すると、0が出る確率 <b>${pct(a * a)}</b>、1が出る確率 <b>${pct(b * b)}</b>`;
      obsChart.hidden = true; obs.textContent = "";
    }

    function setFromPointer(ev) {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left - r.width / 2;
      const y = -(ev.clientY - r.top - size / 2);
      phi = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
      slide.value = Math.round(phi);
      update();
    }
    let drag = false;
    cv.addEventListener("pointerdown", (e) => { drag = true; cv.setPointerCapture(e.pointerId); setFromPointer(e); });
    cv.addEventListener("pointermove", (e) => { if (drag) setFromPointer(e); });
    cv.addEventListener("pointerup", () => { drag = false; });

    const slide = slider(0, 359, 0, 1, (v) => { phi = v; update(); });
    const preset = (label, deg) => h("button", { class: "btn small", onclick: () => { phi = deg; slide.value = deg; update(); } }, label);
    const measure = h("button", { class: "btn primary small", onclick: () => {
      const p1 = Math.sin(rad(phi)) ** 2;
      let n1 = 0;
      for (let i = 0; i < 100; i++) if (Math.random() < p1) n1++;
      obsChart.hidden = false;
      obsChart.set([(100 - n1) / 100, n1 / 100], { text: [100 - n1 + "回", n1 + "回"] });
      obs.innerHTML = `100回観測した結果（理論値は 0:${pct(1 - p1)} / 1:${pct(p1)}）`;
      fx.measure();
      const dd = ((phi % 360) + 360) % 360;
      if (Math.abs(dd - 45) <= 10) ctx.tick(1);
      if (Math.abs(dd - 315) <= 10) ctx.tick(2);
    } }, "👁 100回観測");

    box.append(h("div", { class: "wlabel" }, "矢印をドラッグ！ または下のバーを動かす"), cv, slide,
      h("div", { class: "row" }, preset("|0⟩", 0), preset("半々 45°", 45), preset("|1⟩", 90), preset("半々 315°", 315)),
      info, chart, h("div", { class: "row" }, measure), obs, obsChart);
    setTimeout(update, 0);
    ctx.hint("矢印を動かして「100回観測」を押そう");
  };

  // --- 3: 指数の力（メモリ換算つき）
  W.exp = (box, ctx) => {
    const big = h("div", { class: "big-num" });
    const dots = h("div", { class: "dotgrid" });
    const label = h("div", { class: "val" });
    const note = h("p", { class: "note" });
    const mem = h("div", { class: "mem" });
    const marks = [
      [1, "1個では 2通り。コインの表と裏と同じ。"],
      [4, "4個で16通り。"],
      [10, "10個で1024通り。"],
      [20, "20個で約100万通り。"],
      [33, "33個で約86億通り。<b>世界の人口（約80億）を超えた</b>！"],
      [50, "50個で約1000兆通り。<b>世界最高クラスのスパコン</b>でも苦しい規模。"],
      [80, "80個で約10²⁴通り。コップ1杯の水の分子の数に近い規模！"],
      [150, "150個で約10⁴⁵通り。もう想像できない数。"],
      [266, "266個で約10⁸⁰通り。<b>宇宙にある原子の総数</b>と同じくらい！"],
    ];
    function fmtPow(n) {
      if (n <= 50) return Math.pow(2, n).toLocaleString("ja-JP");
      const lg = n * Math.log10(2);
      const e = Math.floor(lg);
      return Math.pow(10, lg - e).toFixed(2) + " × 10^" + e;
    }
    function memText(n) {
      // 2^n 個の振幅 × 16バイト（複素数）。スマホは 256GB と仮定
      const lgB = n * Math.log10(2) + Math.log10(16);
      const units = [[24, "YB"], [21, "ZB"], [18, "EB"], [15, "PB"], [12, "TB"], [9, "GB"], [6, "MB"], [3, "KB"]];
      let size = Math.pow(10, lgB) + " バイト";
      if (lgB >= 3) {
        const [e, u] = units.find((x) => lgB >= x[0]) || [3, "KB"];
        size = lgB < 27 ? (Math.pow(10, lgB - e)).toFixed(1) + " " + u : "10^" + Math.floor(lgB) + " バイト";
      } else size = Math.round(Math.pow(10, lgB)) + " バイト";
      const lgP = lgB - Math.log10(256e9);
      let phones;
      if (lgP < 0) phones = "スマホ1台で余裕";
      else if (lgP < 4) phones = `スマホ <b>${Math.round(Math.pow(10, lgP)).toLocaleString("ja-JP")}</b> 台ぶん`;
      else if (lgP < 8) phones = `スマホ <b>${Math.round(Math.pow(10, lgP - 4)).toLocaleString("ja-JP")}万</b> 台ぶん`;
      else phones = `スマホ <b>10^${Math.floor(lgP)}</b> 台ぶん`;
      const extra = n >= 70 ? "<br>世界中のデータを全部集めても足りません。" : "";
      return `ふつうのコンピュータで、この状態を<b>まるごと記録</b>するには…<br><b>${size}</b>（${phones}）${extra}`;
    }
    function update(n) {
      label.textContent = n + " 個";
      big.innerHTML = fmtPow(n) + `<small>= 2 の ${n} 乗 通りの矢印</small>`;
      dots.innerHTML = "";
      if (n <= 6) for (let i = 0; i < 1 << n; i++) dots.append(h("i"));
      let msg = marks[0][1];
      for (const [k, m] of marks) if (n >= k) msg = m;
      note.innerHTML = msg;
      mem.innerHTML = memText(n);
      if (n >= 10) ctx.tick(0);
      if (n >= 33) ctx.tick(1);
      if (n >= 50) ctx.tick(2);
    }
    const s = slider(1, 300, 3, 1, (v) => { update(v); if (v % 5 === 0) sfx.blip(); });
    box.append(h("div", { class: "wlabel" }, "量子ビットの数を増やしてみよう"),
      h("div", { class: "slider-row" }, "1", s, "300", label), big, dots, note, mem,
      h("p", { class: "cap" }, "n個の量子ビットは、2ⁿ個の「矢印（振幅）」を同時に持てます"));
    update(3);
  };

  // --- 1: 二重スリット実験
  W.slit = (box, ctx) => {
    const Hh = 430;
    const cv = h("canvas", { class: "w" });
    cv.style.height = Hh + "px";
    const g = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let Wd = 320, raf = 0, last = 0, acc = 0, observe = false, auto = false;
    let dots = [];
    const parts = [];
    const seen = { wave: 0, obs: 0 };
    const env = (x, c = 0) => Math.exp(-(((x - c) / 0.5) ** 2));
    const pdf = (x) => (observe ? 0.5 * (env(x, 0.12) + env(x, -0.12)) : env(x) * Math.cos(Math.PI * 6.5 * x) ** 2);
    function sampleX() { for (;;) { const x = Math.random() * 2 - 1; if (Math.random() < pdf(x)) return x; } }
    const note = h("p", { class: "note" }, "「連射」で粒を撃ってみよう。壁の向こうに、どんな形ができる？");
    const count = h("div", { class: "cap" });

    function land(x) {
      dots.push({ x, j: Math.random() });
      seen[observe ? "obs" : "wave"]++;
      if (dots.length % 3 === 0) sfx.blip();
      status();
    }
    function status() {
      count.textContent = `撃った粒：${dots.length} 個`;
      const n = dots.length;
      if (!observe) {
        if (n >= 150) note.innerHTML = "<b>縞模様ができた！</b> 1個ずつ撃ったのに、波が干渉したときの形です。粒は<b>両方の穴を同時に通った</b>としか説明できません。";
        else if (n > 0) note.innerHTML = "1個ずつ、バラバラに着弾…。まだ模様は見えない。もっと撃ってみて！";
      } else if (n >= 80) note.innerHTML = "見張ると<b>縞が消えた！</b> ふつうの粒のように、2本の帯になりました。<b>見るだけで結果が変わる</b>のが量子の世界です。";
      if (seen.wave >= 150) ctx.tick(0);
      if (seen.obs >= 80) ctx.tick(1);
    }
    function spawn() { parts.push({ t: 0, x: sampleX(), side: Math.random() < 0.5 ? -1 : 1 }); }
    function burst(n) { for (let i = 0; i < n; i++) land(sampleX()); fx.tap(); }

    function geo() { return { cx: Wd / 2, Wx: Wd * 0.44, srcY: Hh - 34, barY: Hh * 0.6, scrY: Hh * 0.22, slit: Wd * 0.09 }; }
    function glow(x, y, r, col, a = 1) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.35, col.replace("A", a * 0.8)); gr.addColorStop(1, col.replace("A", 0));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    function draw(ts) {
      const w = cv.clientWidth || 320;
      if (w !== Wd || cv.width !== Math.round(w * dpr)) { Wd = w; cv.width = Math.round(w * dpr); cv.height = Hh * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, Wd, Hh);
      const { cx, Wx, srcY, barY, scrY, slit } = geo();
      // 波紋（見張っていないときだけ）
      if (!observe) {
        for (const sx of [cx - slit, cx + slit]) for (let k = 0; k < 4; k++) {
          const r = ((ts / 1000) * 45 + k * 36) % 144;
          g.strokeStyle = `rgba(61,230,255,${0.22 * (1 - r / 144)})`; g.lineWidth = 2;
          g.beginPath(); g.arc(sx, barY, r, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
        }
      }
      // 壁
      g.fillStyle = "#5b6bb5";
      g.fillRect(0, barY - 5, cx - slit - 9, 10);
      g.fillRect(cx - slit + 9, barY - 5, slit * 2 - 18, 10);
      g.fillRect(cx + slit + 9, barY - 5, Wd - (cx + slit + 9), 10);
      // 発射口
      glow(cx, srcY, 26, "rgba(255,209,102,A)");
      g.fillStyle = "#98a4cf"; g.font = "12px sans-serif"; g.textAlign = "center";
      g.fillText("粒の発射口", cx, srcY + 24);
      g.textAlign = "left"; g.fillText("2つの穴のある壁", 8, barY - 12);
      // スクリーン
      g.strokeStyle = "#8fa0e8"; g.lineWidth = 2; g.beginPath(); g.moveTo(8, scrY); g.lineTo(Wd - 8, scrY); g.stroke();
      g.fillStyle = "#98a4cf"; g.fillText("スクリーン（粒がぶつかった場所）", 8, scrY + 30);
      // ヒストグラム + 着弾点
      const bins = 64, cnt = new Array(bins).fill(0);
      for (const d of dots) cnt[Math.min(bins - 1, Math.floor(((d.x + 1) / 2) * bins))]++;
      const mx = Math.max(6, ...cnt), bw = (Wx * 2) / bins;
      for (let i = 0; i < bins; i++) {
        const hh = (cnt[i] / mx) * (scrY - 26);
        const gr = g.createLinearGradient(0, scrY, 0, scrY - hh);
        gr.addColorStop(0, observe ? "#ff5fa8" : "#9b7bff"); gr.addColorStop(1, observe ? "#ff9d3d" : "#3de6ff");
        g.fillStyle = gr; g.fillRect(cx - Wx + i * bw + 0.5, scrY - hh, bw - 1, hh);
      }
      g.fillStyle = observe ? "#ffd2a8" : "#d6f6ff";
      for (const d of dots.slice(-400)) { g.beginPath(); g.arc(cx + d.x * Wx, scrY + 4 + d.j * 14, 1.7, 0, 7); g.fill(); }
      // 見張り
      if (observe) {
        g.font = "20px sans-serif"; g.textAlign = "center";
        g.fillText("👁", cx - slit, barY + 28); g.fillText("👁", cx + slit, barY + 28);
      }
      // 飛んでいる粒
      for (const p of parts) {
        const tx = cx + p.x * Wx;
        const sides = observe ? [p.side] : [-1, 1];
        for (const sd of sides) {
          const sxp = cx + sd * slit;
          let x, y;
          if (p.t < 0.5) { const u = p.t / 0.5; x = cx + (sxp - cx) * u; y = srcY + (barY - srcY) * u; }
          else { const u = (p.t - 0.5) / 0.5; x = sxp + (tx - sxp) * u; y = barY + (scrY - barY) * u; }
          glow(x, y, observe ? 13 : 11, observe ? "rgba(255,157,61,A)" : "rgba(155,123,255,A)", observe ? 1 : 0.8);
        }
      }
      g.fillStyle = "#eaf0ff"; g.font = "bold 13px sans-serif"; g.textAlign = "right";
      g.fillText(dots.length + " 個", Wd - 10, 18);
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
      if (auto) { acc += dt * 9; while (acc >= 1) { acc--; spawn(); } }
      for (const p of parts) p.t += dt * 0.95;
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= 1) { land(parts[i].x); parts.splice(i, 1); }
      draw(ts);
    }

    const autoBtn = h("button", { class: "btn primary", onclick: () => { auto = !auto; autoBtn.textContent = auto ? "⏸ 止める" : "▶ 連射"; fx.tap(); } }, "▶ 連射");
    const one = h("button", { class: "btn", onclick: () => { spawn(); fx.tap(); } }, "1個だけ");
    const bst = h("button", { class: "btn", onclick: () => burst(300) }, "⚡ 一気に300個");
    const sw = h("button", { class: "switch", onclick: () => {
      observe = !observe; sw.classList.toggle("on", observe);
      sw.lastChild.textContent = observe ? "どっちの穴を通ったか見張る：ON" : "どっちの穴を通ったか見張る：OFF";
      dots = []; parts.length = 0; seen[observe ? "obs" : "wave"] = 0;
      note.textContent = observe ? "見張りON。もう一度、連射してみよう。" : "見張りOFF。";
      count.textContent = ""; fx.gate();
    } }, h("i"), h("span", {}, "どっちの穴を通ったか見張る：OFF"));
    box.append(cv, h("div", { class: "row" }, autoBtn, one, bst), sw, count, note);
    ctx.hint("まず「連射」で粒をたくさん撃とう");
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  // --- 3: 3D 量子ビット球（ブロッホ球）
  W.sphere = (box, ctx) => {
    const size = 330;
    const cv = h("canvas", { class: "w" });
    cv.style.height = size + "px";
    const g = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    let v = [0, 0, 1], az = -0.6, el = 0.4, drag = false, lastX = 0, anim = null, raf = 0, used = 0;
    let trail = [];
    const SEQ = ["H", "Z", "H"];
    const note = h("p", { class: "note" }, "ゲートのボタンを押すと、矢印が球の上を回ります。");
    const chart = bars(["|0⟩", "|1⟩"], { height: 56 });
    const r2 = Math.SQRT1_2;
    const GATES = {
      H: { k: [r2, 0, r2], a: Math.PI, d: "<b>H</b>：北極から赤道へ。矢印が<b>90°倒れて</b>、0と1が半々に。" },
      X: { k: [1, 0, 0], a: Math.PI, d: "<b>X</b>：球をひっくり返す。0 ⇄ 1 の入れ替え。" },
      Y: { k: [0, 1, 0], a: Math.PI, d: "<b>Y</b>：0 ⇄ 1 を入れ替えつつ、向きも変える。" },
      Z: { k: [0, 0, 1], a: Math.PI, d: "<b>Z</b>：真上の軸のまわりに半回転。<b>高さ（確率）は変わらない</b>けど、向きは変わった！これが「位相」。" },
      S: { k: [0, 0, 1], a: Math.PI / 2, d: "<b>S</b>：軸のまわりに90°。確率は同じ、向きだけ変化。" },
      T: { k: [0, 0, 1], a: Math.PI / 4, d: "<b>T</b>：軸のまわりに45°。小さな位相の変化。" },
    };
    function rot(p, k, t) {
      const c = Math.cos(t), s = Math.sin(t), dot = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
      const cr = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
      return [0, 1, 2].map((i) => p[i] * c + cr[i] * s + k[i] * dot * (1 - c));
    }
    function P(p, cx, cy, R) {
      const ca = Math.cos(az), sa = Math.sin(az);
      const x1 = p[0] * ca - p[1] * sa, y1 = p[0] * sa + p[1] * ca, z1 = p[2];
      const ce = Math.cos(el), se = Math.sin(el);
      return { x: cx + R * x1, y: cy - R * (y1 * se + z1 * ce), d: y1 * ce - z1 * se };
    }
    function ring(fn, cx, cy, R, col) {
      let prev = null;
      for (let i = 0; i <= 90; i++) {
        const q = P(fn((i / 90) * Math.PI * 2), cx, cy, R);
        if (prev) {
          g.strokeStyle = col + ((q.d + prev.d) / 2 > 0 ? "30" : "88"); g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(q.x, q.y); g.stroke();
        }
        prev = q;
      }
    }
    function draw() {
      const w = cv.clientWidth || 320;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = size * dpr; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, size);
      const cx = w / 2, cy = size / 2 + 4, R = Math.min(w, size) / 2 - 56;
      const bg = g.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 4, cx, cy, R);
      bg.addColorStop(0, "#2a3c8a66"); bg.addColorStop(1, "#0a103a22");
      g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
      ring((t) => [Math.cos(t), Math.sin(t), 0], cx, cy, R, "#8fa0ff");
      ring((t) => [Math.cos(t), 0, Math.sin(t)], cx, cy, R, "#8fa0ff");
      ring((t) => [0, Math.cos(t), Math.sin(t)], cx, cy, R, "#8fa0ff");
      // 軸とラベル
      const ax = [[[0, 0, 1], "|0⟩", "#3de6ff"], [[0, 0, -1], "|1⟩", "#ff9d3d"], [[1, 0, 0], "|＋⟩", "#98a4cf"], [[-1, 0, 0], "|－⟩", "#98a4cf"]];
      g.font = "bold 14px sans-serif"; g.textAlign = "center";
      const o = P([0, 0, 0], cx, cy, R);
      for (const [p, t, c] of ax) {
        const q = P(p, cx, cy, R), l = P(p.map((x) => x * 1.22), cx, cy, R);
        g.strokeStyle = c + "99"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(q.x, q.y); g.stroke();
        g.fillStyle = c; g.fillText(t, l.x, l.y + 5);
      }
      // 軌跡
      for (let i = 1; i < trail.length; i++) {
        const a = P(trail[i - 1], cx, cy, R), b = P(trail[i], cx, cy, R);
        g.strokeStyle = `rgba(255,209,102,${(i / trail.length) * 0.9})`; g.lineWidth = 3;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      // 高さの投影（=確率）
      const tip = P(v, cx, cy, R), foot = P([0, 0, v[2]], cx, cy, R);
      g.setLineDash([4, 4]); g.strokeStyle = "#ffd166"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(tip.x, tip.y); g.lineTo(foot.x, foot.y); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#ffd166"; g.beginPath(); g.arc(foot.x, foot.y, 4, 0, 7); g.fill();
      // 矢印
      g.strokeStyle = "#fff"; g.lineWidth = 4; g.lineCap = "round";
      g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(tip.x, tip.y); g.stroke();
      const gl = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 20);
      gl.addColorStop(0, "#fff"); gl.addColorStop(0.3, "#9b7bff"); gl.addColorStop(1, "#9b7bff00");
      g.fillStyle = gl; g.beginPath(); g.arc(tip.x, tip.y, 20, 0, 7); g.fill();
      g.fillStyle = "#98a4cf"; g.font = "11px sans-serif"; g.fillText("ドラッグで球を回して見る", cx, size - 8);
    }
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!drag) az += 0.003;
      if (anim) {
        const u = Math.min(1, (ts - anim.t0) / 650), e = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
        v = rot(anim.from, anim.k, anim.a * e);
        trail.push(v.slice()); if (trail.length > 60) trail.shift();
        if (u >= 1) { anim = null; }
      } else if (trail.length) trail.shift();
      chart.set([(1 + v[2]) / 2, (1 - v[2]) / 2]);
      draw();
    }
    cv.addEventListener("pointerdown", (e) => { drag = true; lastX = e.clientX; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", (e) => { if (drag) { az += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
    cv.addEventListener("pointerup", () => { drag = false; });
    const row = h("div", { class: "row" });
    Object.keys(GATES).forEach((name) => row.append(h("button", { class: "btn", onclick: (ev) => {
      if (anim) return;
      const gt = GATES[name];
      anim = { from: v.slice(), k: gt.k, a: gt.a, t0: performance.now() };
      note.innerHTML = gt.d; fx.gate();
      if (name === SEQ[used]) { ctx.tick(used); used++; }
    } }, name)));
    const reset = h("button", { class: "btn ghost small", onclick: () => { v = [0, 0, 1]; trail = []; anim = null; note.textContent = "|0⟩（北極）に戻しました。"; used = 0; } }, "リセット");
    const obs = h("button", { class: "btn primary small", onclick: () => {
      if (anim) return;
      const r = Math.random() < (1 - v[2]) / 2 ? 1 : 0;
      v = [0, 0, r ? -1 : 1]; trail = [];
      note.innerHTML = `👁 観測 → <b>${r}</b>。矢印は北極か南極にピタッと固定されました。`; fx.measure(); if (used >= 3) ctx.tick(3);
    } }, "👁 観測する");
    box.append(h("div", { class: "wlabel" }, "量子ビット＝球の上の矢印。高さ＝「0が出やすい度合い」"), cv, h("div", { class: "row" }, h("span", { class: "cap" }, "ゲート（球を回す操作）")), row,
      h("div", { class: "row" }, obs, reset), note, chart);
    ctx.hint("ゲートを押して矢印を動かそう（あと3回）");
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  };

  // --- 4: 波の干渉
  W.waves = (box, api) => {
    const cv = h("canvas", { class: "w" });
    const hh = 220;
    cv.style.height = hh + "px";
    const dpr = window.devicePixelRatio || 1;
    const note = h("p", { class: "note" });
    let ph = 0, seenCancel = false;
    function draw() {
      const w = cv.clientWidth || 320;
      cv.width = w * dpr; cv.height = hh * dpr;
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hh);
      const rows = [[40, "#3de6ff", 0], [100, "#ff5fa8", rad(ph)]];
      const wave = (y0, col, off, amp = 24) => {
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y = y0 - amp * Math.sin((x / w) * Math.PI * 4 + off);
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      };
      rows.forEach(([y, c, o]) => { wave(y, c, o); });
      ctx.fillStyle = "#98a4cf"; ctx.font = "12px sans-serif";
      ctx.fillText("波A", 8, 14); ctx.fillText("波B", 8, 74); ctx.fillText("A + B（合成）", 8, 134);
      // 合成
      ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 4; ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const t = (x / w) * Math.PI * 4;
        const y = 180 - 24 * (Math.sin(t) + Math.sin(t + rad(ph)));
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      const strength = Math.abs(Math.cos(rad(ph) / 2));
      note.innerHTML = strength > 0.9 ? "山と山が重なる → <b>強め合う！</b>" : strength < 0.1 ? "山と谷が重なる → <b>打ち消し合って消えた！</b>" : "ずらし具合で、強さが変わります。";
      if (strength < 0.1) { seenCancel = true; api.tick(0); } else if (strength > 0.9 && seenCancel) api.tick(1);
    }
    const s = slider(0, 360, 0, 1, (v) => { ph = v; draw(); });
    box.append(h("div", { class: "wlabel" }, "波Bのズレを動かしてみよう"), cv, s, note);
    setTimeout(draw, 0);
  };

  // --- 4: Hゲート2回（干渉の実験）
  W.interf = (box, ctx) => {
    let s = Q.create(1);
    let hist = ["|0⟩"];
    let presses = 0;
    const amp = bars(["|0⟩", "|1⟩"], { signed: true, height: 120 });
    const prob = bars(["0", "1"], { height: 70 });
    const histEl = h("div", { class: "cap" });
    const win = h("div", { class: "win" });
    const note = h("p", { class: "note" });
    const obsEl = h("div", { class: "cap" });

    function update() {
      amp.set(Array.from(s.amp));
      prob.set(Q.probs(s));
      histEl.textContent = hist.join(" → ");
      const p1 = s.amp[1] ** 2;
      if (p1 > 0.999 && hist.length > 1) ctx.tick(3);
      win.textContent = p1 > 0.999 ? "🎉 ミッション成功！ 必ず「1」が出る状態にできた！" : "";
      obsEl.textContent = "";
    }
    const gate = (name, m, desc) => h("button", { class: "btn", onclick: () => {
      Q.apply1(s, 0, m); hist.push(name); update(); note.innerHTML = desc; fx.gate();
      if (hist.length === 2 && name === "H") ctx.tick(0);
      if (hist.length >= 3 && hist.slice(-3).join() === "|0⟩,H,H") ctx.tick(1);
    } }, name);
    const reset = h("button", { class: "btn ghost", onclick: () => { s = Q.create(1); hist = ["|0⟩"]; update(); note.textContent = ""; } }, "リセット");
    const obs = h("button", { class: "btn primary small", onclick: () => {
      const c = Q.sample(s, 100);
      obsEl.innerHTML = `100回観測 → 0が <b>${c[0]}</b>回 / 1が <b>${c[1]}</b>回`; buzz(30); ctx.tick(2);
    } }, "👁 100回観測");

    box.append(h("div", { class: "wlabel" }, "上のバー＝矢印の長さ（＋は上、−は下）／下のバー＝確率"), amp,
      h("div", { class: "wlabel", style: "margin-top:12px" }, "観測したときの確率"), prob,
      histEl,
      h("div", { class: "row" },
        gate("H", Q.H, "H：0と1の「重ね合わせ」を作る（または戻す）ゲート"),
        gate("X", Q.X, "X：0と1を入れ替えるゲート（ふつうのNOT）"),
        gate("Z", Q.Z, "Z：1側の矢印の向きだけ反転（確率は変わらない！）"),
        reset),
      h("div", { class: "row" }, obs), obsEl, note,
      h("div", { class: "explain" }, "🎯 ミッション：ゲートを組み合わせて、必ず「1」が出る状態を作ろう。方法は2通りあるよ！（ヒント：Xを使う方法と、Hで挟んで…）"),
      win);
    update(); ctx.hint("H を2回押してみよう！（ミッション達成でも次へ進める）");
  };

  // --- 5: もつれ
  W.bell = (box, ctx) => {
    let s, stage, aRes, bRes;
    const labels = ["00", "01", "10", "11"];
    const prob = bars(labels, { height: 90 });
    const coinA = h("div", { class: "coin q unknown" }, "?");
    const coinB = h("div", { class: "coin q unknown" }, "?");
    const note = h("p", { class: "note" });
    const stat = h("div", { class: "cap" });
    const statChart = bars(labels, { height: 70, fmt: (v) => v + "組" });
    statChart.hidden = true;
    const b1 = h("button", { class: "btn primary", onclick: () => { Q.apply1(s, 0, Q.H); stage = 1; ctx.tick(0); render("HゲートでAだけを<b>0と1の重ね合わせ</b>にしました。Bはまだ0のまま。棒グラフは「00」と「10」が半々（左の数字がA、右がB）。AとBはまだ無関係です。"); } }, "① Aに H");
    const b2 = h("button", { class: "btn primary", onclick: () => { Q.cnot(s, 0, 1); stage = 2; ctx.tick(1); render("CNOTでAとBを<b>つなぎました</b>。「Aが1ならBも反転」という操作で、棒グラフが<b>「00」と「11」だけ</b>になりました。01と10は0%。A・Bは<b>もつれた状態</b>です。"); buzz(30); } }, "② つなぐ(CNOT)");
    const bA = h("button", { class: "btn", onclick: () => {
      aRes = Q.measureQubit(s, 0); stage = 3; ctx.tick(2); coinA.textContent = aRes; spinStop(coinA); render(`Aを観測 → <b>${aRes}</b>。この瞬間、AもBも <b>${aRes}</b> に決まりました（00か11しか無かったから）。<br>Bはまだ見ていません。何が出ると思う？ 予想してから「Bを観測」を押そう。`); buzz(40);
    } }, "③ Aを観測");
    const bB = h("button", { class: "btn", onclick: () => {
      bRes = Q.measureQubit(s, 1); stage = 4; ctx.tick(3); coinB.textContent = bRes; spinStop(coinB); render(`Bは <b>${bRes}</b>！ Aと同じ！ Aを見た時点で、Bの結果はもう決まっていました。もう一度「最初から」やっても、必ず一致します。`); fx.measure();
    } }, "④ Bを観測");
    const bR = h("button", { class: "btn ghost", onclick: init }, "最初から");
    const bN = h("button", { class: "btn small", onclick: () => {
      const t = Q.create(2); Q.apply1(t, 0, Q.H); Q.cnot(t, 0, 1);
      const c = Q.sample(t, 100);
      ctx.tick(4); statChart.hidden = false; statChart.set(c.map((x) => x / 100), { text: c.map((x) => x + "組") });
      stat.innerHTML = `もつれペアを100組作って観測：<b>00と11だけ</b>。01・10は一度も出ません。`; buzz(30);
    } }, "🔁 100組まとめて観測");
    function spinStop(c) { c.classList.remove("unknown", "spin"); void c.offsetWidth; c.classList.add("pop"); }
    function render(msg) {
      prob.set(Q.probs(s));
      b1.disabled = stage !== 0; b2.disabled = stage !== 1; bA.disabled = stage !== 2; bB.disabled = stage !== 3;
      if (stage >= 1 && stage < 3) { coinA.classList.add("spin"); coinA.classList.remove("unknown"); }
      if (stage >= 2 && stage < 4) { coinB.classList.add("spin"); coinB.classList.remove("unknown"); }
      note.innerHTML = msg;
    }
    function init() {
      s = Q.create(2); stage = 0;
      [coinA, coinB].forEach((c) => { c.className = "coin q unknown"; c.textContent = "?"; });
      stat.textContent = ""; statChart.hidden = true;
      render("ボタンを順番に押していこう。"); ctx.hint("①〜④のボタンを順番に押そう");
    }
    box.append(h("div", { class: "wlabel" }, "量子ビット A と B（観測したときの確率）"), prob,
      h("div", { class: "cols2", style: "margin-top:12px" }, h("div", {}, h("div", { class: "wlabel" }, "A"), coinA), h("div", {}, h("div", { class: "wlabel" }, "B"), coinB)),
      h("div", { class: "row" }, b1, b2, bA, bB), h("div", { class: "row" }, bR, bN), note, stat, statChart);
    init();
  };

  // --- 6: 回路ラボ
  W.lab = (box, ctx) => {
    const NQ = 3, NC = 6;
    let placed = 0;
    const cols = new Array(NC).fill(null); // {type, q}
    let tool = "H";
    const grid = h("div", { class: "circuit" });
    const prob = bars(Array.from({ length: 8 }, (_, i) => Q.label(i, 3)), { height: 110 });
    const note = h("p", { class: "note" }, "ゲートを選んで、線の上をタップして並べよう。左から順に実行されます。");
    const obs = h("div", { class: "cap" });

    function run() {
      const s = Q.create(NQ);
      for (const g of cols) {
        if (!g) continue;
        if (g.type === "CNOT") Q.cnot(s, g.q, (g.q + 1) % NQ);
        else Q.apply1(s, g.q, Q[g.type]);
      }
      return s;
    }
    function render() {
      grid.innerHTML = "";
      for (let r = 0; r < NQ; r++) {
        const wire = h("div", { class: "cwire" }, h("span", { class: "qn" }, "q" + r));
        for (let c = 0; c < NC; c++) {
          const g = cols[c];
          const cell = h("button", { class: "cell", "aria-label": `量子ビット${r} ${c + 1}列目`, onclick: () => place(r, c) });
          if (g && g.type !== "CNOT" && g.q === r) cell.append(h("span", { class: "gate " + g.type }, g.type));
          else if (g && g.type === "CNOT") {
            const t = (g.q + 1) % NQ;
            if (g.q === r) {
              cell.append(h("span", { class: "gate ctrl" }));
              const dist = Math.abs(t - r);
              cell.append(h("span", { class: "vlink", style: t > r ? `top:50%;height:${dist * 54}px` : `bottom:50%;height:${dist * 54}px` }));
            } else if (t === r) cell.append(h("span", { class: "gate tgt" }, "+"));
          }
          wire.append(cell);
        }
        grid.append(wire);
      }
      const s = run();
      prob.set(Q.probs(s));
      if (Q.probs(s)[5] > 0.999) ctx.tick(2);
      obs.textContent = "";
    }
    function place(r, c) {
      if (tool === "erase") cols[c] = null;
      else if (cols[c] && cols[c].type === tool && cols[c].q === r) cols[c] = null;
      else cols[c] = { type: tool, q: r };
      fx.tap(); render();
    }
    const palette = h("div", { class: "palette" });
    [["H", "H 重ね合わせ"], ["X", "X 反転"], ["Z", "Z 符号"], ["CNOT", "CNOT つなぐ"], ["erase", "消す"]].forEach(([k, t]) => {
      const b = h("button", { class: "btn small" + (k === tool ? " on" : ""), onclick: () => {
        tool = k; palette.querySelectorAll(".btn").forEach((x) => x.classList.remove("on")); b.classList.add("on");
        note.innerHTML = { H: "H：0を「0と1の半々」に（もう一度かけると元に戻る）", X: "X：0と1を入れ替え", Z: "Z：1側の矢印の向きを反転（確率は変わらない）", CNOT: "CNOT：タップした線が「制御」、そのすぐ下の線が「ターゲット」。制御が1ならターゲットを反転。", erase: "タップしたマスのゲートを消します" }[k];
      } }, t);
      palette.append(b);
    });
    const set = (arr) => { cols.fill(null); arr.forEach((g, i) => { cols[i] = g; }); render(); };
    const presets = h("div", { class: "row" },
      h("button", { class: "btn small ghost", onclick: () => set([]) }, "クリア"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "CNOT", q: 0 }]); note.innerHTML = "<b>もつれ</b>：000 と 110 だけが出る（q0とq1が連動）。Hで重ね合わせにして、CNOTでつないだ回路です。"; ctx.tick(0); } }, "例:もつれ"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "H", q: 1 }, { type: "H", q: 2 }]); note.innerHTML = "<b>3個ぜんぶ重ね合わせ</b>：8通りが同じ確率に！"; } }, "例:全部H"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "CNOT", q: 0 }, { type: "CNOT", q: 1 }]); note.innerHTML = "<b>3個もつれ</b>：000 と 111 だけ。（GHZ状態）"; } }, "例:3個もつれ"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "H", q: 0 }]); note.innerHTML = "H→H で<b>元に戻る</b>！（干渉：1へ向かう矢印が＋と−で打ち消し合う）"; ctx.tick(1); } }, "例:H→H"));
    const mBtn = h("button", { class: "btn primary small", onclick: () => {
      const s = run(); const k = Q.measureAll(s);
      obs.innerHTML = `1回だけ観測 → 結果は <b>${Q.label(k, 3)}</b>`; buzz(40);
    } }, "👁 1回観測");
    const m100 = h("button", { class: "btn small", onclick: () => {
      const c = Q.sample(run(), 100);
      const out = c.map((v, i) => [i, v]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).map(([i, v]) => `${Q.label(i, 3)}:${v}回`).join("　");
      obs.innerHTML = "100回観測 → " + out;
    } }, "100回観測");
    box.append(h("div", { class: "wlabel" }, "量子回路（左→右へ実行）"), palette, grid, presets,
      h("div", { class: "wlabel", style: "margin-top:10px" }, "観測したときの確率（q0 q1 q2）"), prob,
      h("div", { class: "row" }, mBtn, m100), obs, note);
    render(); ctx.hint("「例」ボタンか、線をタップして回路を組もう");
  };

  // --- 7: 古典的な探索（宝箱）
  W.searchClassic = (box, ctx) => {
    let treasure, tries, done;
    const boxes = h("div", { class: "boxes" });
    const note = h("p", { class: "note" });
    function init() {
      treasure = (Math.random() * 8) | 0; tries = 0; done = false;
      boxes.innerHTML = "";
      for (let i = 0; i < 8; i++) {
        const b = h("button", { class: "box", onclick: () => {
          if (done || b.classList.contains("open")) return;
          tries++; buzz(15);
          if (i === treasure) { done = true; ctx.tick(0); fx.win(); b.classList.add("found"); b.textContent = "💎"; note.innerHTML = `見つけた！ <b>${tries}回</b>で発見。<br>運が悪いと8回、平均は約4.5回かかります。`; }
          else { b.classList.add("open"); b.textContent = "✕"; note.innerHTML = `ハズレ…（${tries}回目）`; }
        } }, i + 1);
        boxes.append(b);
      }
      note.textContent = "8個の箱のうち1つに宝石💎。順番に開けて探そう！";
    }
    box.append(h("div", { class: "wlabel" }, "ふつうのコンピュータの探し方：1つずつ開ける"), boxes, note,
      h("div", { class: "row" }, h("button", { class: "btn small", onclick: init }, "もう一度")));
    init(); ctx.hint("箱をタップして宝石を探そう");
  };

  // --- 7: グローバー探索
  W.searchQuantum = (box, ctx) => {
    const N = 8;
    let target = 4, s, phase, rounds;
    const labels = Array.from({ length: N }, (_, i) => String(i + 1));
    const ampChart = bars(labels, { signed: true, height: 120 });
    const probChart = bars(labels, { height: 70 });
    const note = h("p", { class: "note" });
    const pick = h("div", { class: "row" });
    const stepBtn = h("button", { class: "btn primary" }, "");
    const obs = h("div", { class: "win" });

    function init() {
      s = Q.create(3); for (let q = 0; q < 3; q++) Q.apply1(s, q, Q.H);
      phase = 0; rounds = 0; obs.textContent = "";
      note.innerHTML = `全部の箱が「同じ強さ」で重なった状態からスタート。宝石は<b>${target + 1}番</b>の箱にある、としよう。`;
      show(); label();
    }
    function show() {
      ampChart.set(Array.from(s.amp), { hot: target });
      const p = Q.probs(s);
      probChart.set(p, { hot: target });
    }
    function label() { stepBtn.textContent = phase === 0 ? `① 正解に目印をつける（${rounds}周目）` : `② 平均で折り返して増幅（${rounds}周目）`; }
    stepBtn.addEventListener("click", () => {
      fx.gate();
      const a = s.amp;
      if (phase === 0) {
        a[target] = -a[target];
        note.innerHTML = "<b>① 目印</b>：正解の箱の矢印だけを<b>マイナスに反転</b>。確率はまだ変わっていないのがミソ！";
        phase = 1; ctx.tick(0);
      } else {
        const mean = a.reduce((x, y) => x + y, 0) / N;
        for (let i = 0; i < N; i++) a[i] = 2 * mean - a[i];
        rounds++; phase = 0; ctx.tick(1); if (rounds >= 2) ctx.tick(2);
        const p = a[target] ** 2;
        note.innerHTML = `<b>② 増幅</b>：平均を軸に折り返す。マイナスだった正解が<b>大きく伸びた</b>！ 今、正解を引く確率は <b>${pct(p)}</b>。` + (rounds === 2 ? "<br>2周でほぼ完成。（ここで観測するのがベスト！）" : rounds >= 3 ? "<br>やり過ぎると行き過ぎて、また下がります。" : "");
      }
      show(); label(); buzz(20);
    });
    const obsBtn = h("button", { class: "btn", onclick: () => {
      const t = Q.clone(s); const k = Q.measureAll(t);
      obs.innerHTML = k === target ? `👁 観測 → <b>${k + 1}番</b>！ 💎 大当たり！` : `👁 観測 → ${k + 1}番… ハズレ。もう少し増幅してから観測しよう。`;
      if (k === target) confetti();
      fx.measure(); ctx.tick(3);
    } }, "👁 観測する");
    for (let i = 0; i < N; i++) {
      pick.append(h("button", { class: "btn small ghost", onclick: () => { target = i; init(); } }, String(i + 1)));
    }
    box.append(h("div", { class: "wlabel" }, "宝石の箱を選ぶ（運営は知っている側）"), pick,
      h("div", { class: "wlabel", style: "margin-top:12px" }, "矢印の長さ（＋は上／−は下）"), ampChart,
      h("div", { class: "wlabel", style: "margin-top:10px" }, "観測したときに選ばれる確率"), probChart,
      h("div", { class: "row" }, stepBtn, obsBtn), note, obs,
      h("div", { class: "row" }, h("button", { class: "btn small ghost", onclick: init }, "最初から")));
    init(); ctx.hint("①②を押して正解を増幅し、「観測」しよう");
  };

  // --- 7: 規模が大きいと…
  W.searchScale = (box, ctx) => {
    const out = h("div");
    const label = h("div", { class: "val" });
    const fmt = (x) => (x >= 1e12 ? (x / 1e12).toFixed(1) + " 兆" : x >= 1e8 ? (x / 1e8).toFixed(1) + " 億" : x >= 1e4 ? (x / 1e4).toFixed(1) + " 万" : Math.round(x).toLocaleString("ja-JP"));
    function update(e) {
      const n = Math.pow(10, e);
      const classic = n / 2;
      const grover = (Math.PI / 4) * Math.sqrt(n);
      label.textContent = fmt(n) + " 個";
      out.innerHTML = `
        <div class="cols2">
          <div><div class="wlabel">ふつうの探し方<br>(平均)</div><div class="big-num" style="font-size:22px">${fmt(classic)} 回</div></div>
          <div><div class="wlabel">量子（グローバー法）</div><div class="big-num" style="font-size:22px;color:#3de6ff">${fmt(grover)} 回</div></div>
        </div>
        <p class="note">およそ <b>${fmt(classic / grover)} 倍</b> の差。数が増えるほど、差は開きます。</p>`;
    }
    const s = slider(2, 12, 6, 0.1, (v) => { update(v); if (v >= 5.95) ctx.tick(0); if (v >= 11.5) ctx.tick(1); });
    box.append(h("div", { class: "wlabel" }, "探す相手の数（10の何乗か）"), h("div", { class: "slider-row" }, "100", s, "1兆", label), out);
    update(6); ctx.hint("バーを右に動かして、差の広がりを見よう");
  };

  // --- 9: クイズ
  const QUIZ = [
    { q: "量子ビットが「重ね合わせ」の状態のとき、観測するとどうなる？", o: ["0と1が同時に見える", "0か1のどちらか一方が出る", "壊れて何も出ない"], a: 1, e: "観測すると必ずどちらか一方に決まります。見えるのは1つだけ。" },
    { q: "0の状態にHゲートを2回続けてかけると？", o: ["ランダムに0か1", "必ず元の0に戻る", "必ず1になる"], a: 1, e: "1に向かう2つの道が＋と−で打ち消し合い、0に向かう道は強め合うから。これが「干渉」です。" },
    { q: "10個の量子ビットが同時に持てる「矢印（振幅）」の数は？", o: ["10個", "100個", "1024個（2の10乗）"], a: 2, e: "n個なら2のn乗。だから増やすほど爆発的に大きな空間を扱えます。" },
    { q: "「もつれ」状態の2つの量子ビット（H＋CNOT）を観測すると？", o: ["結果は必ず一致する", "結果はいつもバラバラ", "どちらも必ず0"], a: 0, e: "00か11のどちらかがランダムに出ます。ただし結果を自由に選べないので、超光速通信はできません。" },
    { q: "量子コンピュータが得意なのは？", o: ["動画の再生を速くする", "特定のタイプの問題（探索・化学計算・素因数分解など）", "あらゆるアプリを速くする"], a: 1, e: "万能の高速化マシンではなく、「干渉をうまく使える問題」が得意なのです。" },
    { q: "100万個から1つを探す。ふつうは平均約50万回。グローバー法ではおよそ何回？", o: ["約800回", "約50万回", "1回"], a: 0, e: "約 π/4 × √100万 ≒ 785回。√N に減るのがグローバー法の力です。" },
    { q: "「量子コンピュータは全部の答えを同時に計算して、全部読み出せる」これは？", o: ["正しい", "まちがい（読み出せるのは観測した1つだけ）"], a: 1, e: "だから「正解の矢印だけを干渉で大きくしてから観測する」工夫が必要なのです。" },
  ];
  W.quiz = (box, ctx) => {
    let i = 0, score = 0;
    const area = h("div");
    function show() {
      area.innerHTML = "";
      if (i >= QUIZ.length) {
        const all = score === QUIZ.length;
        area.append(h("div", { class: "wlabel" }, "けっか"), h("div", { class: "score" }, `${score} / ${QUIZ.length}`),
          h("p", { class: "note" }, all ? "全問正解！ もう量子コンピュータの基本はバッチリです🎉" : score >= 5 ? "すばらしい！ 間違えた所は、各章に戻って触ってみよう。" : "もう一度、各章で実験してみよう。さわるとわかります！"),
          h("div", { class: "row" }, h("button", { class: "btn", onclick: () => { i = 0; score = 0; show(); } }, "もう一度")));
        if (all) setTimeout(confetti, 200);
        markDone();
        return;
      }
      const it = QUIZ[i];
      area.append(h("div", { class: "wlabel" }, `Q${i + 1} / ${QUIZ.length}`), h("p", { style: "font-weight:700;font-size:16.5px;margin:6px 0" }, it.q));
      const exp = h("div");
      const btns = it.o.map((t, k) => h("button", { class: "opt", onclick: () => {
        btns.forEach((b, j) => { b.disabled = true; if (j === it.a) b.classList.add("right"); });
        if (k === it.a) { score++; buzz(30); } else { btns[k].classList.add("wrong"); buzz([60, 40, 60]); }
        exp.append(h("div", { class: "explain" }, (k === it.a ? "⭕ 正解！ " : "❌ ざんねん。 ") + it.e),
          h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => { i++; show(); } }, i + 1 < QUIZ.length ? "次の問題" : "結果を見る")));
      } }, t));
      area.append(...btns, exp);
    }
    box.append(area);
    show();
  };

  // =====================================================================
  //  用語ミニ辞典
  // =====================================================================
  const GL = {
    bit: ["ビット", "コンピュータが扱う情報の最小単位。スイッチのオン／オフのように、0か1のどちらか。"],
    qubit: ["量子ビット（キュービット）", "量子コンピュータの情報の最小単位。0と1の「重ね合わせ」になれるビット。"],
    sup: ["重ね合わせ", "0と1が「どちらか分からない」のではなく、「混ざった状態」そのものとして存在していること。回っているコインのイメージ。"],
    obs: ["観測", "量子ビットを調べて、0か1かを読み取ること。読み取った瞬間、混ざった状態は0か1のどちらかに決まる。"],
    prob: ["確率", "観測したとき、0や1がどれくらい出やすいか。矢印の長さを2乗したもの。"],
    amp: ["振幅（矢印）", "確率のもとになる量。「長さ」と「向き（＋／−）」を持つ矢印のイメージ。長さの2乗が確率になる。"],
    phase: ["位相", "矢印の「向き」のこと。確率には現れないが、干渉のときに結果を左右する。"],
    interf: ["干渉", "波が重なって、強め合ったり打ち消し合ったりすること。量子では矢印の＋と−が打ち消し合う。"],
    gate: ["量子ゲート", "量子ビットに対する「操作」。球の上の矢印を回す操作だと思えばOK。"],
    H: ["Hゲート", "0を「0と1の半々」に、半々を0や1に変える操作。2回かけると元に戻る。"],
    X: ["Xゲート", "0と1を入れ替える操作。ふつうのNOTと同じ。"],
    Z: ["Zゲート", "1の側の矢印の向きだけをひっくり返す操作。確率は変わらない。"],
    cnot: ["CNOTゲート", "2つの量子ビットをつなぐ操作。片方（制御）が1のときだけ、もう片方（ターゲット）を反転する。"],
    ent: ["もつれ", "2つ以上の量子ビットが連動して、1つのまとまった状態になること。"],
    circuit: ["量子回路", "ゲートを順番に並べた図。量子コンピュータのプログラム。"],
    grover: ["グローバー法", "干渉を使って正解の矢印だけを大きくする探索法。N個の中から約√N回で探せる。"],
  };
  const D = (k, label) => `<dfn data-k="${k}">${label || GL[k][0]}</dfn>`;

  function openGloss(key) {
    const body = $("#gloss-body");
    body.innerHTML = "";
    let target = null;
    Object.entries(GL).forEach(([k, [t, d]]) => {
      const it = h("div", { class: "gl-item" + (k === key ? " hl" : "") }, h("b", {}, t), h("p", {}, d));
      if (k === key) target = it;
      body.append(it);
    });
    $("#gloss").hidden = false;
    if (target) setTimeout(() => target.scrollIntoView({ block: "start" }), 30);
    sfx.tap();
  }
  $("#gloss-close").addEventListener("click", () => { $("#gloss").hidden = true; });
  $("#gloss").addEventListener("click", (e) => { if (e.target.id === "gloss") $("#gloss").hidden = true; });
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("dfn[data-k]");
    if (t) openGloss(t.dataset.k);
  });
  $("#gloss-btn").addEventListener("click", () => openGloss());
  $("#gloss-btn2").addEventListener("click", () => openGloss());

  // =====================================================================
  //  章の内容（ナビの「キュー」が案内します）
  //   intro  : 章のはじまり（わかること／先に結論／たとえ）
  //   what   : この実験は何をしているのか
  //   look   : どこを見ればいいか
  //   todo   : やること（実験側が自動でチェックします）
  //   result : やり終えたあとに出る「わかったこと」
  // =====================================================================
  const CHAPTERS = [
    { emoji: "🌈", title: "ありえない実験", sub: "粒なのに、波になる",
      goal: ["量子の粒が、ふつうの物体とはまったく違う動きをすること", "量子コンピュータの2大ルール「重ね合わせ」「干渉」のさわり"],
      conclusion: "量子の粒は、見ていない間は<b>「両方の穴を同時に通る」</b>ようにふるまう。でも、どっちを通ったか見張ると、1つの穴だけを通る。",
      analogy: "投げたボールが1球ずつなのに、なぜか「波」のような模様を描く…そんな不思議な実験です。",
      gist: "量子の粒は、見ていない間は「全部の道」を通る。見た瞬間に1つに決まる。",
      steps: [
        { h: "実験：2つの穴に向けて、粒を撃つ", w: "slit",
          p: "物理学者が実際に行ってきた有名な実験を、アプリで再現しました。<br>画面の下から、とても小さな粒（電子や光の粒）を<b>1個ずつ</b>撃ちます。粒は途中の壁にある<b>2つの穴</b>を通り抜けて、いちばん上の<b>スクリーン</b>にぶつかり、跡を残します。",
          what: "スクリーンには「粒がぶつかった場所」が点と棒グラフでたまっていきます。ふつうのボールなら、穴の正面あたりに<b>2本の帯</b>ができるはずです。さて、実際は？",
          look: ["上の棒グラフ ＝ 粒がたくさんぶつかった場所", "光る玉 ＝ 飛んでいる粒1個", "穴の上の水色の波紋 ＝ 粒が「波」としてふるまうイメージ"],
          todo: ["「▶ 連射」を押して、粒を150個以上ためよう（模様が見えるまで待つ）", "「どっちの穴を通ったか見張る」をONにして、もう一度80個以上撃とう"],
          result: "<b>見張らないとき</b>：棒グラフは<b>縞模様</b>（高い所と低い所が交互）になりました。粒は1個ずつ撃ったのに、波のように<b>干渉</b>しています。1個の粒が<b>両方の穴を同時に通って、自分自身と干渉した</b>と考えるしかありません。<br><br><b>見張ったとき</b>：縞が消えて、ふつうの<b>2本の帯</b>になりました。「どっちの穴か」を調べた瞬間、粒は片方しか通らなくなったのです。<br><br>👉 量子の世界では、<b>見ていない間は「全部の可能性」が同時にあり、見ると1つに決まる</b>。" },
        { h: "この実験は、量子コンピュータと何の関係があるの？",
          p: `縞模様ができた理由は、2つの穴を通る「可能性」が<b>波のように足し算された</b>から。山と山が重なる所は強め合って粒がたくさん来て、山と谷が重なる所は<b>打ち消し合って</b>粒が来ません。<br><br>この2つの性質を計算に使うのが量子コンピュータです。<ul><li><b>${D("sup")}</b>：たくさんの可能性が同時にある</li><li><b>${D("interf")}</b>：可能性どうしが強め合ったり、打ち消し合ったりする</li></ul>つまり量子コンピュータは、<b>「間違いの可能性を打ち消して、正解の可能性だけを強める」マシン</b>なのです。次の章から、1つずつ体験していきましょう。` },
      ] },

    { emoji: "🪙", title: "ビットと量子ビット", sub: "回っているコインの正体",
      goal: ["「量子ビット」がふつうのビットと何が違うのか", "「重ね合わせ」と「観測」とは何か"],
      conclusion: "量子ビットは、観測するまで<b>0と1が混ざった状態</b>。観測すると、確率にしたがって0か1のどちらかに決まる。",
      analogy: "テーブルの上で回っているコイン。回っている間は「表でも裏でもある」。手で押さえて止めると、表か裏に決まる。",
      gist: "量子ビットは0と1の重ね合わせ。観測すると、確率にしたがって0か1に決まる。",
      steps: [
        { h: "ふつうのビット", w: "bit",
          p: `パソコンやスマホの中の情報は、すべて<b>0か1</b>の並びでできています。その1つぶんを${D("bit")}と呼びます。スイッチの「オフ（0）」「オン（1）」のようなものです。`,
          what: "1つのスイッチです。ボタンを押すと、0と1が入れ替わります。",
          look: ["コインの数字は、いつ見ても0か1のどちらか1つ"] },
        { h: "量子ビットを回してみよう", w: "qubit",
          p: `量子コンピュータの部品は${D("qubit")}です。コインにたとえると、ふつうのビットは「表か裏が上を向いて止まっている」状態。量子ビットは<b>回転している状態</b>にもなれます。<br>この「0でもあり1でもある」状態が${D("sup")}。回っているコインを手で止める操作が${D("obs")}です。`,
          what: "青いコインが量子ビットです。「重ね合わせにする」で回転（＝0と1が混ざった状態）。「観測する」で止まって、0か1に決まります。",
          look: ["回転中は数字がチラチラ変わりますが、実際は「まだ決まっていない」状態", "下の棒グラフ ＝ これまでに観測して出た0と1の回数"],
          todo: ["「重ね合わせにする」を押そう", "「観測する」を押して、0か1か見よう", "これを合計5回くり返そう"],
          result: "5回やって、0と1の回数はどうでしたか？ 1回1回はランダムで予測できません。でも、たくさんやると<b>だいたい半々</b>に近づきます。<br><br>これが量子の「<b>確率</b>」です。1回ごとの結果は決められなくても、<b>出やすさ（確率）は決まっている</b>のです。" },
        { h: "ここが、いちばん大事なポイント",
          p: `回っているコインは「表か裏か、まだ分かっていないだけ」ではありません。<b>「0と1が混ざった状態」という、はっきりした1つの状態</b>です。<br><br>そして観測すると<b>必ず0か1のどちらか</b>に決まり、もう混ざった状態には戻れません（もう一度「重ね合わせにする」が必要）。<br><br>ふつうのビットとの違いは、この<b>「混ざった状態を作って、計算に使える」</b>こと。次の章では、この「混ざり具合」を矢印で見える化します。` },
      ] },

    { emoji: "🧭", title: "状態は「矢印」で表せる", sub: "平面から、立体の球へ",
      goal: ["量子ビットの「状態」をどう表すか", "「確率」「矢印」「位相」「ゲート」の関係"],
      conclusion: "量子ビットの状態は<b>「矢印」</b>で表せる。矢印の影の長さを<b>2乗すると確率</b>。ゲートは矢印を回す操作。",
      analogy: "時計の針。針が指す向きで、「0の出やすさ・1の出やすさ」が決まります。",
      gist: "量子ビットの状態は球の上の矢印。ゲートは球を回す操作。高さが確率、向きが位相。",
      steps: [
        { h: "混ざり具合を、矢印にしてみよう", w: "bloch",
          p: `回っているコインにも、「どれくらい混ざっているか」の段階があります。それを<b>矢印</b>で表します。矢印が右向きなら「100%の0」、上向きなら「100%の1」、斜めなら「混ざっている」。<br>矢印の先から2本の影（横と縦）を落とすと、<b>影の長さの2乗</b>が、それぞれが出る${D("prob")}になります。`,
          what: "円の上の矢印が量子ビットの状態です。下の棒グラフは、観測したとき0と1がどれくらい出るかの確率です。",
          look: ["水色の線 ＝ 横の影（0らしさ）", "オレンジの線 ＝ 縦の影（1らしさ）", "影の長さを2乗したものが、棒グラフの%"],
          todo: ["矢印をドラッグするか、バーを動かしてみよう", "「半々 45°」を押して「100回観測」。0と1がほぼ半々に", "「半々 315°」を押して「100回観測」。45°のときと同じ結果に"],
          result: `45°と315°は、矢印の向きが違う<b>別の状態</b>なのに、観測結果（確率）は同じ半々でした。<br><br>この「矢印の向きの違い」は、確率には現れません。でも<b>隠れた重要な情報</b>で、${D("phase")}と呼びます。のちの「干渉」で効いてきます。` },
        { h: "立体にすると、もっとわかる！", w: "sphere",
          p: `実は量子ビットの状態は、<b>球の上の矢印</b>ですべて表せます。北極が0、南極が1。<b>矢印の高さ</b>が「0の出やすさ」で、赤道は半々です。<br>量子の操作である${D("gate")}は、<b>この球を回す操作</b>です。`,
          what: "ゲートのボタンを押すと、矢印が球の上をくるっと回ります。黄色い点線の長さ＝矢印の高さです。",
          look: ["黄色い点線と点 ＝ 高さ（これが確率のもと）", "金色の軌跡 ＝ 矢印が通ってきた道", "下の棒グラフ ＝ いま観測したときの確率"],
          todo: ["H を押す：矢印が北極から赤道へ倒れ、0と1が半々に", "Z を押す：高さ（確率）は変わらないのに、矢印の向きだけ変わる", "もう一度 H を押す：矢印はどこへ行く？（予想してから！）", "「観測する」を押そう"],
          result: `<b>H → Z → H</b> で、矢印は北極（0）から南極（1）へ行きました！<br>Hを2回続けると元の0に戻りますが、<b>間にZを挟むと1になる</b>のです。Zは確率を変えないのに、あとの結果を変えました。<br><br>👉 <b>見えない「向き」が、あとで結果を左右する</b>。これが量子計算のカラクリで、次々章の「干渉」の正体です。` },
      ] },

    { emoji: "🚀", title: "増えると爆発する", sub: "量子ビット n 個 = 2ⁿ の世界",
      goal: ["量子ビットを増やすと、扱える情報がどれだけ増えるか", "なぜ「量子コンピュータは速い」と言われるのか"],
      conclusion: "量子ビットがn個あると、<b>2のn乗個の矢印</b>を同時に持てる。ただし、取り出せるのは<b>観測した1つだけ</b>。",
      analogy: "ふつうのビット3個は「8通りのうち1つ」を書いたメモ1枚。量子ビット3個は「8通りぜんぶに旗を立てた」状態です。",
      gist: "n個の量子ビットは2ⁿ個の矢印を持てる。でも取り出せるのは、観測した1つだけ。",
      steps: [
        { h: "量子ビットを増やすと…？", w: "exp",
          p: "ふつうのビット3個は、000〜111の<b>8通り</b>のうち<b>どれか1つ</b>しか表せません。<br>量子ビット3個は、8通り<b>ぜんぶに「矢印」を持てます</b>。n個なら<b>2のn乗個</b>です。",
          what: "スライダーで量子ビットの個数を増やすと、持てる矢印の数と、それを「ふつうのコンピュータで記録する」のに必要な容量が表示されます。",
          look: ["大きな数字 ＝ 矢印の数（2のn乗）", "ピンクの枠 ＝ ふつうのコンピュータで記録する量", "1〜6個のときは、光る点で矢印の数が見えます"],
          todo: ["10個まで増やそう", "33個まで増やそう（世界の人口より多くなる）", "50個以上に増やして、必要なメモリを見よう"],
          result: "たった50個の量子ビットが持つ矢印は、約1000兆個。ふつうのコンピュータで<b>まるごと記録</b>しようとすると、スマホ約7万台ぶんのメモリが必要になります。<br><br>量子コンピュータは、この巨大な矢印の集まりを<b>そのまま物理的に持ち、操作できます</b>。これが「速くなる可能性」の源です。" },
        { h: "ただし、大事な注意",
          p: `矢印を2のn乗個持っていても、<b>観測すると取り出せるのは1つだけ</b>。「全部の答えが同時に出て、全部読める」わけではありません。<br><br>だから量子コンピュータの腕の見せどころは、<b>計算の途中で${D("interf")}を使って、正解の矢印だけを大きく、間違いの矢印を小さくしておく</b>こと。そうすれば、観測したときに高い確率で正解が出ます。<br><br>次の章で、その「干渉」を体験します。` },
      ] },

    { emoji: "🌊", title: "波が打ち消し合う（干渉）", sub: "量子計算の心臓部",
      goal: ["「干渉」とは何か", "Hゲートを2回かけると何が起こるか", "なぜ干渉が量子計算の心臓部なのか"],
      conclusion: "矢印の<b>＋と−が出会うと打ち消し合う</b>。これを使って、間違いの答えを消し、正解を残す。",
      analogy: "ノイズキャンセリングイヤホン。逆向きの音をぶつけて、雑音を消します。",
      gist: "矢印は＋と−で打ち消し合う。正解を強め、間違いを消す。それが量子計算。",
      steps: [
        { h: "まずは、身近な「波」で", w: "waves",
          p: `まず水の波で${D("interf")}を体験します。2つの波が重なるとき、山と山が重なれば<b>強め合い</b>、山と谷が重なれば<b>打ち消し合って消えます</b>。ノイズキャンセリングイヤホンの原理です。`,
          what: "水色の波Aとピンクの波Bを足し合わせたものが、黄色い波（合成）です。バーで波Bを横にずらせます。",
          look: ["黄色い波の高さ（振れ幅）が、強め合い・打ち消し合いの結果"],
          todo: ["黄色い波がほぼ平らに「消える」所までバーを動かそう", "バーを動かして、黄色い波が一番大きくなる所を見つけよう"],
          result: "ずらし具合が半周（180°）のとき、2つの波は<b>完全に打ち消し合って</b>消えました。<br>量子の矢印（＋と−）にも、まったく同じことが起こります。次は本物の量子ビットで確かめましょう。" },
        { h: "実験：Hゲートを2回かけてみよう", w: "interf",
          p: `${D("H")}は「0を、0と1の半々の状態にする」操作です。では、これを<b>2回</b>かけたらどうなるでしょう？<br>直感では「半々の半々だから、やっぱりランダム」ですよね。本当にそうか、確かめましょう。`,
          what: "量子ビットにゲートを順番にかけていきます。上のバーは「矢印の長さ（＋は上、−は下）」、下のバーは「観測したときの確率」です。",
          look: ["上のバーが上向き（水色）＝＋、下向き（ピンク）＝−", "「|0⟩ → H → H」のように、いま何をしたかが表示されます"],
          todo: ["H を1回押す：確率が半々（50%・50%）になる", "もう一度 H を押す：さあ、どうなる？", "「100回観測」を押して確かめよう", "ミッション：必ず「1」が出る状態を作ろう（ヒント：X、または H → Z → H）"],
          result: "<b>2回目のHで、確率は「半々」ではなく「100%で0」に戻りました。</b>ランダムを2回重ねたら確実になる、という不思議です。<br><br>理由：1回目のHで矢印は（＋0.71、＋0.71）。2回目のHは、それぞれを「0へ行く分」と「1へ行く分」に分けて足し算します。<br>・<b>0へ</b>：＋0.5 と ＋0.5 → <b>強め合って 1.0</b><br>・<b>1へ</b>：＋0.5 と −0.5 → <b>打ち消し合って 0</b><br><br>確率ではなく<b>「矢印」を足し算している</b>から、こうなるのです。" },
        { h: "量子計算の基本レシピ",
          p: `量子コンピュータの計算は、ざっくりこの3ステップです。<ol><li>量子ビットを${D("sup")}にして、たくさんの可能性を<b>同時に用意</b>する</li><li>ゲートで矢印を操作して、${D("interf")}で<b>間違いを打ち消し、正解を強める</b></li><li>最後に${D("obs")}して、答えを読む</li></ol>この「<b>用意 → 干渉で整える → 観測</b>」が、ほとんどの量子アルゴリズムの基本形です。` },
      ] },

    { emoji: "🔗", title: "ふしぎな「もつれ」", sub: "つながった2つの粒",
      goal: ["「もつれ」とは何か", "2つの量子ビットが連動する様子"],
      conclusion: "もつれた2つの量子ビットは、<b>どちらも単独ではランダム</b>なのに、<b>結果は必ず一致</b>する。",
      analogy: "ペアの靴を別々の箱に入れて送る。片方の箱を開けて右足なら、もう片方は左足。ただし量子では、開ける前は「どちらとも決まっていない」のがミソです。",
      gist: "もつれた量子ビットは、結果が必ず連動する。量子ビット同士の連携プレーの源。",
      steps: [
        { h: "2つのコインを「つなぐ」", w: "bell",
          p: `2つの量子ビットA・Bを、${D("H")}と${D("cnot")}という2つのゲートで「つなぐ」と、${D("ent")}という特別な状態になります。順番にボタンを押して組み立て、そのあと観測しましょう。`,
          what: "コインA・Bが量子ビットです。上の棒グラフは、AとBを同時に観測したとき「00・01・10・11」のどれが出るかの確率です（左の数字がA、右がB）。",
          look: ["「00」は「A=0、B=0」の意味", "観測のあと、AとBが同じ数字になるか"],
          todo: ["① AにHをかける", "② CNOTでAとBをつなぐ", "③ Aを観測する", "④ Bを観測する（Aと同じ？）", "「100組まとめて観測」で、何度やっても一致するか確かめる"],
          result: "AもBも、<b>単独ではランダム</b>（0か1か、やるまで分からない）。でも<b>2つの結果は必ず一致</b>しました。100組やっても、出たのは「00」と「11」だけ。「01」と「10」は一度も出ません。<br><br>Aを観測した瞬間、Bの結果も決まっていました。" },
        { h: "なぜこれが大事なの？",
          p: "アインシュタインはこれを「不気味な遠隔作用」と呼んで悩みました。ただし<b>これで通信はできません</b>。Aの結果は自分で選べない（ランダム）ので、メッセージを送れないからです。<br><br>量子コンピュータでは、この「もつれ」が<b>量子ビット同士が協力して計算する仕組み</b>になります。1個ずつバラバラに動かすのではなく、<b>全体でひとつの巨大な状態</b>として操作できるのが強みです。" },
      ] },

    { emoji: "🧪", title: "回路ラボ", sub: "自分で量子回路を組んでみよう",
      goal: ["量子コンピュータの「プログラム」の正体", "ここまでのゲートを自由に組み合わせる"],
      conclusion: "量子プログラム ＝ ゲートを順番に並べた<b>「量子回路」</b>。本物の量子コンピュータも、これを実行しているだけ。",
      analogy: "楽譜。音符（ゲート）を、左から順に演奏（実行）していきます。",
      gist: "量子プログラム＝ゲートの並び。本物の量子コンピュータも同じ仕組みで動く。",
      steps: [
        { h: "量子回路を組み立てよう", w: "lab",
          p: `3つの量子ビット（q0・q1・q2）の線の上に、ゲートを並べて${D("circuit")}を作ります。<b>左から右へ</b>順番に実行されます。`,
          what: "上のボタンから「H・X・Z・CNOT」のどれかを選び、回路のマスをタップして置きます。もう一度タップで外せます。下の棒グラフが、観測したとき「000〜111」のどれが出るかの確率です。",
          look: ["グラフの横軸は「q0 q1 q2」の観測結果（例：101 ＝ q0が1、q1が0、q2が1）", "CNOT：● が制御、⊕ がターゲット"],
          todo: ["「例:もつれ」を押して、000と110だけが出ることを確認", "「例:H→H」を押して、000に戻ることを確認", "「クリア」→「X」を選び、q0とq2に置いて「101」を100%にしよう"],
          result: "ゲートを並べるだけで、重ね合わせ・干渉・もつれが作れました。<b>本物の量子コンピュータが実行するのも、この「ゲートの並び」</b>です。違いは、量子ビットの数が多いことと、実際の物理的な部品で動いていることだけです。" },
        { h: "自由に遊んでみて！",
          p: "🎮 チャレンジ：<ul><li><b>「000」と「111」</b>だけが出る回路は？（ヒント：もつれを3個に）</li><li>H で全部の量子ビットを重ね合わせにすると、8通りはどんな確率に？</li><li>HをHで挟むと、確率はどうなる？</li></ul>どう組んでも、観測の結果は必ず確率どおりに出ます。" },
      ] },

    { emoji: "🔍", title: "量子で探す魔法", sub: "グローバー法：正解だけを増幅",
      goal: ["量子コンピュータが「速い」ことの具体例", "正解だけを増幅する仕組み"],
      conclusion: `${D("grover")}は、干渉で<b>正解の矢印だけを大きく</b>して探す。N個から探すのに、約<b>√N回</b>で済む。`,
      analogy: "100人の合唱で、正解の1人の声だけが大きくなるように、他の人の声を打ち消し合わせていくイメージ。",
      gist: "グローバー法は干渉で正解を増幅する。調べる回数が N回 → √N回 に。",
      steps: [
        { h: "まず、ふつうの探し方", w: "searchClassic",
          p: "8個の箱のうち1つに宝石💎が入っています。どの箱か分からないので、ふつうのコンピュータは<b>1個ずつ開けて</b>確かめるしかありません。",
          what: "箱をタップして開けます。宝石が出るまで続けます。",
          todo: ["宝石が見つかるまで、箱を開けよう"],
          result: "平均で約半分（8個なら4〜5個）は開ける必要があります。数が増えれば、その分だけ手間も増えます（N個なら平均N/2回）。" },
        { h: "量子の探し方：矢印を増幅！", w: "searchQuantum",
          p: "最初は、8個の箱すべてに<b>同じ長さの矢印</b>を持たせます（重ね合わせ）。ここから次の2つの操作を<b>くり返す</b>と、正解の箱の矢印だけが長く伸びます。<ol><li><b>① 目印をつける</b>：正解の箱の矢印だけを、プラスからマイナスにひっくり返す</li><li><b>② 増幅する</b>：全部の矢印の「平均の高さ」を軸に、全体を折り返す</li></ol>",
          what: "上のグラフ ＝ 8個の箱の矢印の長さ（＋は上、−は下）。下のグラフ ＝ 観測したとき、その箱が選ばれる確率。オレンジの棒が正解の箱です。",
          look: ["①を押すと、オレンジの棒が下向き（−）に。確率はまだ同じ", "②を押すと、オレンジの棒が大きく伸び、他は短くなる"],
          todo: ["① を押そう", "② を押そう：オレンジの棒が伸びる！", "もう一周（①②）して、確率が90%を超えるのを見よう", "「観測する」を押して、正解を引こう"],
          result: "2周で正解の確率が約94%になりました。ふつうは平均4〜5回かかるのに、<b>干渉で正解を強め、はずれを弱めた</b>ので、観測1回でほぼ当たります。<br><br>おもしろいこと：3周目をやると確率が<b>下がります</b>（行き過ぎ）。最適な回数があるのです。" },
        { h: "数が大きいほど、差は爆発", w: "searchScale",
          p: "探す相手が増えるほど、差は劇的に広がります。ふつうは<b>N回</b>、グローバー法は約<b>√N回</b>（正確には π/4 × √N）です。",
          what: "スライダーで探す数を増やして、必要な回数を比べます。",
          todo: ["100万個まで動かそう", "1兆個まで動かそう"],
          result: "100万個なら <b>約50万回 vs 約800回</b>。1兆個なら <b>約5000億回 vs 約80万回</b>。数が大きいほど差が開きます。<br>ただし「何でも一瞬」ではなく、√N回はかかります。それでも劇的な差です。" },
      ] },

    { emoji: "🌍", title: "何に使えるの？", sub: "夢と現実、正しい期待のしかた",
      goal: ["量子コンピュータは結局、何に役立つのか", "よくある誤解と、本当のところ"],
      conclusion: "万能の超高速パソコンではない。<b>特定の問題で、桁違いに速くなる可能性</b>がある。",
      analogy: "F1カー。サーキットでは最速だけど、買い物には向きません。",
      gist: "万能ではない。化学・最適化・暗号など、特定の問題で桁違いに速くなる可能性がある。",
      steps: [
        { h: "期待されている使い道",
          p: "<ul><li>🧬 <b>化学・新薬・新材料</b>：分子はもともと量子の世界のもの。量子コンピュータで自然にシミュレーションできる。</li><li>🚚 <b>最適化</b>：配送ルートや工場の段取りなど、組み合わせが爆発する問題。</li><li>🔐 <b>暗号</b>：大きな数の素因数分解（ショア法）が速くなり、今の暗号が破られる可能性。そのため<b>耐量子暗号</b>への移行が世界で進んでいます。</li></ul>" },
        { h: "よくある誤解・本当のところ",
          p: "<div class='myth'><b>❌「全部の答えを同時に出して、全部読める」</b>読めるのは観測した1つだけ。干渉で正解を強める工夫が必須です。</div><div class='myth'><b>❌「今のパソコンより、何でも速い」</b>動画・ゲーム・SNSは速くなりません。得意な問題だけです。</div><div class='myth'><b>❌「もうすぐスマホに入る」</b>多くの方式は極低温が必要で、ノイズでエラーが出やすい。エラー訂正が最大の課題です。</div><div class='myth ok'><b>⭕「特定の問題で、桁違いに速くなる可能性がある」</b>だから世界中で研究されています。</div>" },
      ] },

    { emoji: "🏆", title: "理解度チェック", sub: "全7問のクイズ",
      goal: ["ここまでの理解を確認する"], conclusion: "全問正解を目指そう！", analogy: "",
      gist: "ここまで来たあなたは、量子コンピュータの基本をつかんだ！",
      steps: [{ h: "クイズに挑戦！", w: "quiz", p: "ここまでの内容を、7問で確認しよう。間違えても解説が出るので大丈夫！" }] },
  ];

  const RANKS = [[0, "量子ビギナー"], [2, "量子見習い"], [5, "量子ハンター"], [8, "量子マスター"], [10, "量子博士 🎓"]];

  // =====================================================================
  //  画面制御
  // =====================================================================
  const store = {
    get() { try { return JSON.parse(localStorage.getItem("quantum.done.v2") || "[]"); } catch (_) { return []; } },
    set(v) { try { localStorage.setItem("quantum.done.v2", JSON.stringify(v)); } catch (_) { /* noop */ } },
  };
  let cur = -1, stepNo = 0, cleanup = null, hintEl = null, unlocked = true;

  function markDone() {
    if (cur < 0) return;
    const d = store.get();
    if (!d.includes(cur)) { d.push(cur); store.set(d); }
  }
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }
  function syncMute() {
    const t = sfx.on;
    $("#mute-btn").textContent = t ? "🔊 効果音 ON" : "🔇 効果音 OFF";
    $("#mute2").textContent = t ? "🔊" : "🔇";
  }
  function toggleMute() { sfx.toggle(); syncMute(); sfx.tap(); }

  function renderHome() {
    const d = store.get();
    const list = $("#chapter-list");
    list.innerHTML = "";
    CHAPTERS.forEach((c, i) => {
      list.append(h("li", { class: d.includes(i) ? "done" : "" },
        h("button", { onclick: () => { sfx.tap(); openChapter(i); } },
          h("span", { class: "ch-emoji" }, c.emoji),
          h("span", { class: "ch-meta" }, h("div", { class: "ch-no" }, `CHAPTER ${i + 1}`), h("div", { class: "ch-name" }, c.title), h("div", { class: "ch-sub" }, c.sub)),
          d.includes(i) ? h("span", { class: "ch-done" }, "✓") : null)));
    });
    $("#progress-fill").style.width = (d.length / CHAPTERS.length) * 100 + "%";
    $("#progress-text").textContent = `${d.length} / ${CHAPTERS.length}`;
    $("#rank").textContent = RANKS.filter((r) => d.length >= r[0]).pop()[1];
    syncMute();
    show("home");
    startHero();
  }

  function goHome(fromPop) {
    if (cleanup) { cleanup(); cleanup = null; }
    removeHint();
    $("#clear").hidden = true;
    $("#gloss").hidden = true;
    cur = -1;
    if (!fromPop && history.state && history.state.ch != null) history.back();
    renderHome();
  }

  function openChapter(i) {
    cancelAnimationFrame(heroRaf);
    cur = i; stepNo = 0;
    history.pushState({ ch: i }, "");
    show("chapter");
    renderStep();
  }

  function removeHint() { if (hintEl) { hintEl.remove(); hintEl = null; } }

  // 章のはじまり画面
  function introStep(ch, i) {
    const box = h("div", { class: "intro" },
      h("div", { class: "intro-emoji" }, ch.emoji),
      h("div", { class: "ch-no" }, `CHAPTER ${i + 1}`),
      h("h2", {}, ch.title),
      h("div", { class: "icard" }, h("div", { class: "ilabel" }, "🎯 この章でわかること"), h("ul", {}, ch.goal.map((g) => h("li", {}, g)))),
      h("div", { class: "icard key" }, h("div", { class: "ilabel" }, "💡 先に結論"), h("p", { html: ch.conclusion })));
    if (ch.analogy) box.append(h("div", { class: "icard" }, h("div", { class: "ilabel" }, "🪄 たとえるなら"), h("p", {}, ch.analogy)));
    return box;
  }

  function renderStep() {
    if (cleanup) { cleanup(); cleanup = null; }
    removeHint();
    const ch = CHAPTERS[cur];
    const total = ch.steps.length + 1;
    const el = $("#step");
    el.innerHTML = "";
    const next = $("#next-btn");
    $("#ch-title").textContent = `${cur + 1}. ${ch.title}`;
    const dots = $("#dots");
    dots.innerHTML = "";
    for (let k = 0; k < total; k++) dots.append(h("i", { class: k === stepNo ? "on" : k < stepNo ? "past" : "" }));
    $("#prev-btn").style.visibility = stepNo === 0 ? "hidden" : "visible";
    window.scrollTo(0, 0);
    unlocked = true; next.disabled = false;

    if (stepNo === 0) {
      el.append(introStep(ch, cur));
      next.textContent = "はじめる ▶";
      return;
    }
    const st = ch.steps[stepNo - 1];
    const last = stepNo === ch.steps.length;
    el.append(h("h2", {}, st.h), h("div", { class: "guide" }, h("div", { class: "orb" }), h("div", { class: "bubble" }, h("p", { html: st.p }))));

    const todo = st.todo || [];
    let resultEl = null, taskEls = [];
    const doneSet = new Set();
    unlocked = !todo.length;
    next.disabled = !!todo.length;

    if (st.what) {
      const wc = h("div", { class: "what" }, h("div", { class: "ilabel" }, "🔬 この実験は？"), h("p", { html: st.what }));
      if (st.look) wc.append(h("div", { class: "ilabel", style: "margin-top:8px" }, "👀 ここを見よう"), h("ul", {}, st.look.map((l) => h("li", { html: l }))));
      el.append(wc);
    }
    if (todo.length) {
      const tc = h("div", { class: "tasks" }, h("div", { class: "ilabel" }, "✅ やること（やるとチェックが入ります）"));
      todo.forEach((t) => { const li = h("div", { class: "task" }, h("i", {}), h("span", { html: t })); taskEls.push(li); tc.append(li); });
      el.append(tc);
    }
    function finish() {
      if (unlocked) return;
      unlocked = true; next.disabled = false; removeHint(); fx.win();
      if (resultEl) { resultEl.hidden = false; setTimeout(() => resultEl.scrollIntoView({ behavior: "smooth", block: "center" }), 80); }
    }
    function refreshHint() {
      if (unlocked) return;
      const k = todo.findIndex((_, j) => !doneSet.has(j));
      if (k < 0) return;
      if (!hintEl) {
        hintEl = h("div", { class: "hint" }, h("span", {}, ""), h("button", { onclick: () => { todo.forEach((_, j) => doneSet.add(j)); taskEls.forEach((t) => t.classList.add("on")); finish(); } }, "とばす"));
        $("#chapter").append(hintEl);
      }
      hintEl.firstChild.textContent = `👆 ${k + 1}. ${taskEls[k].textContent}`;
    }
    const ctx = {
      tick(j) {
        if (j >= todo.length || doneSet.has(j) || unlocked) return;
        doneSet.add(j); taskEls[j].classList.add("on"); sfx.tap();
        if (doneSet.size >= todo.length) finish(); else refreshHint();
      },
      unlock() {}, hint() {},
    };
    if (st.w) {
      const box = h("div", { class: "widget" });
      el.append(box);
      const r = W[st.w](box, ctx);
      if (typeof r === "function") cleanup = r;
    }
    if (st.result) {
      resultEl = h("div", { class: "result" }, h("div", { class: "ilabel" }, "🎉 わかったこと"), h("p", { html: st.result }));
      resultEl.hidden = todo.length > 0;
      el.append(resultEl);
    }
    if (todo.length) refreshHint();
    next.textContent = last ? (st.w === "quiz" ? "ホームへ" : "章をクリア 🎉") : "次へ";
  }

  function showClear() {
    const ch = CHAPTERS[cur];
    markDone();
    $("#clear-no").textContent = `CHAPTER ${cur + 1} CLEAR`;
    $("#clear-title").textContent = ch.title;
    $("#clear-gist").textContent = ch.gist;
    const hasNext = cur + 1 < CHAPTERS.length;
    const nb = $("#clear-next");
    nb.textContent = hasNext ? `次の章へ：${CHAPTERS[cur + 1].title}` : "ホームへ";
    nb.onclick = () => { $("#clear").hidden = true; if (hasNext) { const n = cur + 1; goHome(false); setTimeout(() => openChapter(n), 30); } else goHome(false); };
    $("#clear").hidden = false;
    confetti(); fx.win();
  }

  $("#next-btn").addEventListener("click", () => {
    const ch = CHAPTERS[cur];
    sfx.tap();
    if (stepNo < ch.steps.length) { stepNo++; renderStep(); return; }
    if (ch.steps[stepNo - 1].w === "quiz") { markDone(); goHome(false); return; }
    showClear();
  });
  $("#clear-home").addEventListener("click", () => goHome(false));
  $("#prev-btn").addEventListener("click", () => { if (stepNo > 0) { stepNo--; renderStep(); } });
  $("#back-btn").addEventListener("click", () => goHome(false));
  $("#mute-btn").addEventListener("click", toggleMute);
  $("#mute2").addEventListener("click", toggleMute);
  window.addEventListener("popstate", () => { if (cur >= 0) goHome(true); });

  // ---------- インストール & オフライン ----------
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e; $("#install-btn").hidden = false;
  });
  $("#install-btn").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $("#install-btn").hidden = true;
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* noop */ });
  }

  renderHome();
})();
