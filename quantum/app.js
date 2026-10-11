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
  W.qubit = (box) => {
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
      note.innerHTML = "回転中…<b>0でもあり、1でもある</b>状態です。";
      refresh(); buzz(20);
    } }, "🌀 重ね合わせにする");
    const mBtn = h("button", { class: "btn", onclick: () => {
      if (!spinning) return;
      const r = Q.measureQubit(s, 0);
      clearInterval(timer); spinning = false;
      coin.classList.remove("spin"); coin.textContent = r; void coin.offsetWidth; coin.classList.add("pop");
      tally[r]++;
      const n = tally[0] + tally[1];
      chart.set([tally[0] / n, tally[1] / n], { text: [tally[0] + "回", tally[1] + "回"] });
      note.innerHTML = `観測した！ 結果は <b>${r}</b>。もう一度回して、何回か試してみよう（${n}回目）。`;
      refresh(); buzz(40);
    } }, "👁 観測する");
    function refresh() { hBtn.disabled = spinning; mBtn.disabled = !spinning; }
    refresh();
    box.append(h("div", { class: "wlabel" }, "量子ビット（キュービット）"), coin,
      h("div", { class: "row" }, hBtn, mBtn), note, chart);
    return () => clearInterval(timer);
  };

  // --- 2: 確率の矢印
  W.bloch = (box) => {
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
      buzz(30);
    } }, "👁 100回観測");

    box.append(h("div", { class: "wlabel" }, "矢印をドラッグ！ または下のバーを動かす"), cv, slide,
      h("div", { class: "row" }, preset("|0⟩", 0), preset("半々 45°", 45), preset("|1⟩", 90), preset("半々 315°", 315)),
      info, chart, h("div", { class: "row" }, measure), obs, obsChart);
    setTimeout(update, 0);
  };

  // --- 3: 指数の力
  W.exp = (box) => {
    const big = h("div", { class: "big-num" });
    const dots = h("div", { class: "dotgrid" });
    const label = h("div", { class: "val" });
    const note = h("p", { class: "note" });
    const marks = [
      [1, "1個では 2通り。コインの表と裏と同じ。"],
      [4, "4個で16通り。トランプの1スートより多い！"],
      [10, "10個で1024通り。"],
      [20, "20個で約100万通り。"],
      [33, "33個で約86億通り。<b>世界の人口（約80億）を超えた</b>！"],
      [50, "50個で約1000兆通り。<b>世界最高クラスのスパコン</b>でも、全部を普通に記録するのは限界に近づく。"],
      [80, "80個で約10²⁴通り。コップ1杯の水の分子の数に近い規模！"],
      [150, "150個で約10⁴⁵通り。もう想像できない数。"],
      [266, "266個で約10⁸⁰通り。<b>宇宙にある原子の総数</b>と同じくらい！"],
    ];
    function fmtPow(n) {
      if (n <= 50) return Math.pow(2, n).toLocaleString("ja-JP");
      const lg = n * Math.log10(2);
      const e = Math.floor(lg);
      return (Math.pow(10, lg - e)).toFixed(2) + " × 10^" + e;
    }
    function update(n) {
      label.textContent = n + " 個";
      big.innerHTML = fmtPow(n) + `<small>= 2 の ${n} 乗 通り</small>`;
      dots.innerHTML = "";
      if (n <= 6) for (let i = 0; i < 1 << n; i++) dots.append(h("i"));
      let msg = marks[0][1];
      for (const [k, m] of marks) if (n >= k) msg = m;
      note.innerHTML = msg;
    }
    const s = slider(1, 300, 3, 1, update);
    box.append(h("div", { class: "wlabel" }, "量子ビットの数を増やしてみよう"),
      h("div", { class: "slider-row" }, "1", s, "300", label), big, dots, note,
      h("p", { class: "cap" }, "n個の量子ビットは、2ⁿ個の「矢印（振幅）」を同時に持てます"));
    update(3);
  };

  // --- 4: 波の干渉
  W.waves = (box) => {
    const cv = h("canvas", { class: "w" });
    const hh = 220;
    cv.style.height = hh + "px";
    const dpr = window.devicePixelRatio || 1;
    const note = h("p", { class: "note" });
    let ph = 0;
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
    }
    const s = slider(0, 360, 0, 1, (v) => { ph = v; draw(); });
    box.append(h("div", { class: "wlabel" }, "波Bのズレを動かしてみよう"), cv, s, note);
    setTimeout(draw, 0);
  };

  // --- 4: Hゲート2回（干渉の実験）
  W.interf = (box) => {
    let s = Q.create(1);
    let hist = ["|0⟩"];
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
      win.textContent = p1 > 0.999 ? "🎉 ミッション成功！ 必ず「1」が出る状態にできた！" : "";
      obsEl.textContent = "";
    }
    const gate = (name, m, desc) => h("button", { class: "btn", onclick: () => {
      Q.apply1(s, 0, m); hist.push(name); update(); note.innerHTML = desc; buzz(15);
    } }, name);
    const reset = h("button", { class: "btn ghost", onclick: () => { s = Q.create(1); hist = ["|0⟩"]; update(); note.textContent = ""; } }, "リセット");
    const obs = h("button", { class: "btn primary small", onclick: () => {
      const c = Q.sample(s, 100);
      obsEl.innerHTML = `100回観測 → 0が <b>${c[0]}</b>回 / 1が <b>${c[1]}</b>回`; buzz(30);
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
    update();
  };

  // --- 5: もつれ
  W.bell = (box) => {
    let s, stage, aRes, bRes;
    const labels = ["00", "01", "10", "11"];
    const prob = bars(labels, { height: 90 });
    const coinA = h("div", { class: "coin q unknown" }, "?");
    const coinB = h("div", { class: "coin q unknown" }, "?");
    const note = h("p", { class: "note" });
    const stat = h("div", { class: "cap" });
    const statChart = bars(labels, { height: 70, fmt: (v) => v + "組" });
    statChart.hidden = true;
    const b1 = h("button", { class: "btn primary", onclick: () => { Q.apply1(s, 0, Q.H); stage = 1; render("まずAだけ重ね合わせに。まだBとはつながっていません。"); } }, "① Aに H");
    const b2 = h("button", { class: "btn primary", onclick: () => { Q.cnot(s, 0, 1); stage = 2; render("CNOTでAとBを<b>つなぎました</b>。確率を見て！ 00 と 11 だけ、01 と 10 は0%。"); buzz(30); } }, "② つなぐ(CNOT)");
    const bA = h("button", { class: "btn", onclick: () => {
      aRes = Q.measureQubit(s, 0); stage = 3; coinA.textContent = aRes; spinStop(coinA); render(`Aを観測 → <b>${aRes}</b>。さて、Bはまだ見ていないけど…？予想してから「Bを観測」を押してみて。`); buzz(40);
    } }, "③ Aを観測");
    const bB = h("button", { class: "btn", onclick: () => {
      bRes = Q.measureQubit(s, 1); stage = 4; coinB.textContent = bRes; spinStop(coinB); render(`Bは <b>${bRes}</b>！ Aと必ず同じ。ひとつ決まった瞬間、もうひとつも決まっていた。`); buzz(40);
    } }, "④ Bを観測");
    const bR = h("button", { class: "btn ghost", onclick: init }, "最初から");
    const bN = h("button", { class: "btn small", onclick: () => {
      const t = Q.create(2); Q.apply1(t, 0, Q.H); Q.cnot(t, 0, 1);
      const c = Q.sample(t, 100);
      statChart.hidden = false; statChart.set(c.map((x) => x / 100), { text: c.map((x) => x + "組") });
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
      render("ボタンを順番に押していこう。");
    }
    box.append(h("div", { class: "wlabel" }, "量子ビット A と B（観測したときの確率）"), prob,
      h("div", { class: "cols2", style: "margin-top:12px" }, h("div", {}, h("div", { class: "wlabel" }, "A"), coinA), h("div", {}, h("div", { class: "wlabel" }, "B"), coinB)),
      h("div", { class: "row" }, b1, b2, bA, bB), h("div", { class: "row" }, bR, bN), note, stat, statChart);
    init();
  };

  // --- 6: 回路ラボ
  W.lab = (box) => {
    const NQ = 3, NC = 6;
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
      obs.textContent = "";
    }
    function place(r, c) {
      if (tool === "erase") cols[c] = null;
      else if (cols[c] && cols[c].type === tool && cols[c].q === r) cols[c] = null;
      else cols[c] = { type: tool, q: r };
      buzz(10); render();
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
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "CNOT", q: 0 }]); note.innerHTML = "<b>もつれ</b>：000 と 110 だけが出る（q0とq1が連動）"; } }, "例:もつれ"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "H", q: 1 }, { type: "H", q: 2 }]); note.innerHTML = "<b>3個ぜんぶ重ね合わせ</b>：8通りが同じ確率に！"; } }, "例:全部H"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "CNOT", q: 0 }, { type: "CNOT", q: 1 }]); note.innerHTML = "<b>3個もつれ</b>：000 と 111 だけ。（GHZ状態）"; } }, "例:3個もつれ"),
      h("button", { class: "btn small ghost", onclick: () => { set([{ type: "H", q: 0 }, { type: "H", q: 0 }]); note.innerHTML = "H→H で<b>元に戻る</b>！（干渉）"; } }, "例:H→H"));
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
    render();
  };

  // --- 7: 古典的な探索（宝箱）
  W.searchClassic = (box) => {
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
          if (i === treasure) { done = true; b.classList.add("found"); b.textContent = "💎"; note.innerHTML = `見つけた！ <b>${tries}回</b>で発見。<br>運が悪いと8回、平均は約4.5回かかります。`; }
          else { b.classList.add("open"); b.textContent = "✕"; note.innerHTML = `ハズレ…（${tries}回目）`; }
        } }, i + 1);
        boxes.append(b);
      }
      note.textContent = "8個の箱のうち1つに宝石💎。順番に開けて探そう！";
    }
    box.append(h("div", { class: "wlabel" }, "ふつうのコンピュータの探し方：1つずつ開ける"), boxes, note,
      h("div", { class: "row" }, h("button", { class: "btn small", onclick: init }, "もう一度")));
    init();
  };

  // --- 7: グローバー探索
  W.searchQuantum = (box) => {
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
      const a = s.amp;
      if (phase === 0) {
        a[target] = -a[target];
        note.innerHTML = "<b>① 目印</b>：正解の箱の矢印だけを<b>マイナスに反転</b>。確率はまだ変わっていないのがミソ！";
        phase = 1;
      } else {
        const mean = a.reduce((x, y) => x + y, 0) / N;
        for (let i = 0; i < N; i++) a[i] = 2 * mean - a[i];
        rounds++; phase = 0;
        const p = a[target] ** 2;
        note.innerHTML = `<b>② 増幅</b>：平均を軸に折り返す。マイナスだった正解が<b>大きく伸びた</b>！ 今、正解を引く確率は <b>${pct(p)}</b>。` + (rounds === 2 ? "<br>2周でほぼ完成。（ここで観測するのがベスト！）" : rounds >= 3 ? "<br>やり過ぎると行き過ぎて、また下がります。" : "");
      }
      show(); label(); buzz(20);
    });
    const obsBtn = h("button", { class: "btn", onclick: () => {
      const t = Q.clone(s); const k = Q.measureAll(t);
      obs.innerHTML = k === target ? `👁 観測 → <b>${k + 1}番</b>！ 💎 大当たり！` : `👁 観測 → ${k + 1}番… ハズレ。もう少し増幅してから観測しよう。`;
      if (k === target) confetti();
      buzz(40);
    } }, "👁 観測する");
    for (let i = 0; i < N; i++) {
      pick.append(h("button", { class: "btn small ghost", onclick: () => { target = i; init(); } }, String(i + 1)));
    }
    box.append(h("div", { class: "wlabel" }, "宝石の箱を選ぶ（運営は知っている側）"), pick,
      h("div", { class: "wlabel", style: "margin-top:12px" }, "矢印の長さ（＋は上／−は下）"), ampChart,
      h("div", { class: "wlabel", style: "margin-top:10px" }, "観測したときに選ばれる確率"), probChart,
      h("div", { class: "row" }, stepBtn, obsBtn), note, obs,
      h("div", { class: "row" }, h("button", { class: "btn small ghost", onclick: init }, "最初から")));
    init();
  };

  // --- 7: 規模が大きいと…
  W.searchScale = (box) => {
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
    const s = slider(2, 12, 6, 0.1, update);
    box.append(h("div", { class: "wlabel" }, "探す相手の数（10の何乗か）"), h("div", { class: "slider-row" }, "100", s, "1兆", label), out);
    update(6);
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
  W.quiz = (box) => {
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
  //  章の内容
  // =====================================================================
  const CHAPTERS = [
    { emoji: "🪙", title: "ビットと量子ビット", sub: "回っているコインの正体",
      steps: [
        { h: "コンピュータの中身は「0と1」", p: "スマホもゲーム機も、中身はスイッチの「オフ＝0」と「オン＝1」の並びです。この1つぶんを<b>ビット</b>と呼びます。", w: "bit" },
        { h: "量子ビットは「回っているコイン」", p: "量子コンピュータの部品<b>量子ビット（キュービット）</b>は、0と1が<b>混ざった状態</b>になれます。テーブルの上で回っているコインのように、表でも裏でもある状態。<br>これを<span class='em'>重ね合わせ</span>といいます。回してから、観測（コインを止める）してみよう。", w: "qubit" },
        { h: "ここが大事！", p: "回っているコインは「決まっていないだけ」ではなく、<b>混ざった状態そのもの</b>が、ちゃんと存在する状態です。<br>そして<b>観測すると、必ず0か1のどちらかに決まり</b>、混ざった状態には戻れません。<br>何度も試すと、だいたい半々になりましたか？ これが量子の世界の「確率」です。" },
      ] },
    { emoji: "🧭", title: "状態は「矢印」で表せる", sub: "0と1の混ざり具合を見える化",
      steps: [
        { h: "混ざり具合を矢印にしてみよう", p: "横軸が<b>|0⟩</b>、縦軸が<b>|1⟩</b>。矢印をぐるぐる動かしてみて。<br>矢印の「影の長さ」を<b>2乗</b>した値が、観測したときにその結果が出る<span class='em'>確率</span>になります。", w: "bloch" },
        { h: "確率は「長さの2乗」", p: "たとえば45°のとき、影の長さは約0.71。2乗すると0.5＝50%。<br>ここで<b>不思議なこと</b>：315°（矢印を下向きに）にしても、確率は同じ50%。でも矢印の向きは違う、<b>別の状態</b>です。<br>この「向きの違い（＋と−）」が、次々章の主役<span class='em'>干渉</span>のタネになります。" },
      ] },
    { emoji: "🚀", title: "増えると爆発する", sub: "量子ビット n 個 = 2ⁿ の世界",
      steps: [
        { h: "量子ビットを増やすと…？", p: "ふつうのビット3個は、000〜111の8通りのうち「1つ」しか表せません。<br>でも量子ビット3個は、8通り<b>すべてに矢印を持てます</b>。n個なら <span class='em'>2のn乗</span>。スライダーを動かして、数の爆発を見てみよう。", w: "exp" },
        { h: "でも「全部の答え」は取り出せない", p: "ここ、よく誤解されます。矢印をたくさん持てても、観測すると<b>取り出せるのは1つだけ</b>。<br>だから量子コンピュータは「<span class='em'>正解の矢印だけを大きく、間違いの矢印を小さく</span>してから観測する」ように作ります。<br>それを可能にするのが、次の<b>干渉</b>です。" },
      ] },
    { emoji: "🌊", title: "波が打ち消し合う（干渉）", sub: "量子計算の心臓部",
      steps: [
        { h: "水の波と同じルール", p: "2つの波の山と山が重なると大きく、山と谷が重なると消えます。<br>量子の矢印（振幅）も同じ。<b>＋と−が出会うと、打ち消し合う</b>のです。", w: "waves" },
        { h: "実験：Hゲートを2回かけてみよう", p: "<b>Hゲート</b>は「0を、0と1の半々にする」操作。では、2回かけたら？<br>「半々の半々」で、やっぱりランダム…？ 実際にやって、100回観測してみよう。", w: "interf" },
        { h: "なにが起きたの？", p: "1回目のHで、矢印は (+0.71, +0.71)。<br>2回目のHのとき、<b>「1」へ向かう道が2本</b>あり、その矢印は <b>＋0.5</b> と <b>−0.5</b>。打ち消し合って<b>0</b>になります。<br>「0」へ向かう道は <b>＋0.5</b> と <b>＋0.5</b> で強め合い、<b>1（100%）</b>。<br><br>ランダムに見えたものが、必ず0に戻る。<span class='em'>確率ではなく「矢印」が計算されている</span>──これが、ふつうのコンピュータには真似できない量子計算の核心です。" },
      ] },
    { emoji: "🔗", title: "ふしぎな「もつれ」", sub: "離れていてもつながる2つの粒",
      steps: [
        { h: "2つのコインを「つなぐ」", p: "2つの量子ビットを、HゲートとCNOTゲートでつなぐと<span class='em'>もつれ</span>という状態に。<br>ボタンを順番に押して、2つのコインを観測してみよう。", w: "bell" },
        { h: "どちらも「まだ決まっていない」のに", p: "AもBも、単独では0か1かランダム。<b>でも2つの結果は必ず一致</b>します。<br>アインシュタインは「不気味な遠隔作用」と呼んで悩みました。<br><br>⚠️ ただし、<b>これで超光速通信はできません</b>。Aの結果は自分で選べない（ランダム）ので、会って比べて初めて一致がわかるからです。<br>量子コンピュータでは、このもつれが「量子ビット同士の連携プレー」の源になります。" },
      ] },
    { emoji: "🧪", title: "回路ラボ", sub: "自分で量子回路を組んでみよう",
      steps: [
        { h: "量子回路を組み立てよう", p: "量子コンピュータのプログラムは<b>量子回路</b>──ゲートを並べたものです。ゲートを選んで線をタップ。結果の確率がリアルタイムで変わります。<br>下の「例」ボタンで、これまでの実験を一発で再現できます。", w: "lab" },
        { h: "自由に遊んでみて！", p: "🎮 チャレンジ：<ul><li><b>「101」</b>だけを100%出す回路は？（ヒント：Xを使う）</li><li><b>「000」と「111」</b>だけが出る回路は？（もつれ！）</li><li>HをHで挟むと、確率はどうなる？</li></ul>実は、本物の量子コンピュータが実行するのも、この<b>ゲートの並び</b>です。数が桁違いに多いだけ。" },
      ] },
    { emoji: "🔍", title: "量子で探す魔法", sub: "グローバー法：正解だけを増幅",
      steps: [
        { h: "まずは、ふつうの探し方", p: "8個の箱の中の1つに宝石があるとき、ふつうのコンピュータは<b>1個ずつ開けて調べる</b>しかありません。平均で半分（約4〜5個）は開けることに。", w: "searchClassic" },
        { h: "量子の探し方：矢印を増幅！", p: "グローバー法は、2つの操作をくり返します。<ol><li><b>目印</b>：正解の矢印だけを<b>マイナス</b>に反転</li><li><b>増幅</b>：全体の平均を軸に折り返す → 正解だけが伸びる！</li></ol>ボタンを押して、正解の箱の棒がぐんぐん伸びるのを見てみよう。<b>干渉の力</b>で正解だけを大きくしています。", w: "searchQuantum" },
        { h: "数が大きいほど、差は爆発", p: "ふつうは調べる数に比例（N回）ですが、グローバー法は<span class='em'>√N回</span>程度。探す相手が増えるほどすごい差に。スライダーで見てみよう。", w: "searchScale" },
      ] },
    { emoji: "🌍", title: "何に使えるの？", sub: "夢と現実、正しい期待のしかた",
      steps: [
        { h: "期待されている使い道", p: "<ul><li>🧬 <b>化学・新薬・新材料</b>：分子はそもそも量子の世界。シミュレーションに向いています。</li><li>🚚 <b>最適化</b>：配送ルートや工場の段取りなど、組み合わせが爆発する問題。</li><li>🔐 <b>暗号</b>：大きな数の素因数分解（ショア法）が高速になり、今の暗号を破れる可能性。そのため「<b>耐量子暗号</b>」への移行が世界で進んでいます。</li></ul>" },
        { h: "よくある誤解・本当のところ", p: "<div class='myth'><b>❌「全部の答えを同時に出して、全部読める」</b>読めるのは観測した1つだけ。干渉で正解を強める工夫が必須です。</div><div class='myth'><b>❌「今のパソコンより、何でも速くなる」</b>動画・ゲーム・SNSは速くなりません。得意な問題だけ。</div><div class='myth'><b>❌「もうすぐスマホに入る」</b>多くの方式は絶対零度に近い極低温が必要。ノイズでエラーが起きやすく、エラー訂正の研究が最大の課題です。</div><div class='myth ok'><b>⭕「特定の問題で、桁違いに速くなる可能性がある」</b>だから世界中で研究が進んでいます。</div>" },
      ] },
    { emoji: "🏆", title: "理解度チェック", sub: "全7問のクイズ",
      steps: [
        { h: "クイズに挑戦！", p: "ここまでの内容を、7問で確認しよう。", w: "quiz" },
      ] },
  ];

  // =====================================================================
  //  画面制御
  // =====================================================================
  const store = {
    get() { try { return JSON.parse(localStorage.getItem("quantum.done.v1") || "[]"); } catch (_) { return []; } },
    set(v) { try { localStorage.setItem("quantum.done.v1", JSON.stringify(v)); } catch (_) { /* noop */ } },
  };
  let cur = -1, stepNo = 0, cleanup = null;

  function markDone() {
    if (cur < 0) return;
    const d = store.get();
    if (!d.includes(cur)) { d.push(cur); store.set(d); }
  }

  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
  }

  function renderHome() {
    const d = store.get();
    const list = $("#chapter-list");
    list.innerHTML = "";
    CHAPTERS.forEach((c, i) => {
      list.append(h("li", { class: d.includes(i) ? "done" : "" },
        h("button", { onclick: () => openChapter(i) },
          h("span", { class: "ch-emoji" }, c.emoji),
          h("span", { class: "ch-meta" }, h("div", { class: "ch-no" }, `CHAPTER ${i + 1}`), h("div", { class: "ch-name" }, c.title), h("div", { class: "ch-sub" }, c.sub)),
          d.includes(i) ? h("span", { class: "ch-done" }, "✓") : null)));
    });
    $("#progress-fill").style.width = (d.length / CHAPTERS.length) * 100 + "%";
    $("#progress-text").textContent = `${d.length} / ${CHAPTERS.length}`;
    show("home");
    startHero();
  }

  function goHome(fromPop) {
    if (cleanup) { cleanup(); cleanup = null; }
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

  function renderStep() {
    if (cleanup) { cleanup(); cleanup = null; }
    const ch = CHAPTERS[cur];
    const st = ch.steps[stepNo];
    $("#ch-title").textContent = `${cur + 1}. ${ch.title}`;
    const dots = $("#dots");
    dots.innerHTML = "";
    ch.steps.forEach((_, k) => dots.append(h("i", { class: k === stepNo ? "on" : k < stepNo ? "past" : "" })));
    const el = $("#step");
    el.innerHTML = "";
    el.append(h("h2", {}, st.h), h("p", { html: st.p }));
    if (st.w) {
      const box = h("div", { class: "widget" });
      el.append(box);
      const r = W[st.w](box);
      if (typeof r === "function") cleanup = r;
    }
    const last = stepNo === ch.steps.length - 1;
    $("#prev-btn").style.visibility = stepNo === 0 ? "hidden" : "visible";
    const next = $("#next-btn");
    next.textContent = last ? (st.w === "quiz" ? "ホームへ" : "完了 🎉") : "次へ";
    window.scrollTo(0, 0);
  }

  $("#next-btn").addEventListener("click", () => {
    const ch = CHAPTERS[cur];
    if (stepNo < ch.steps.length - 1) { stepNo++; renderStep(); return; }
    const first = !store.get().includes(cur);
    markDone();
    if (first && ch.steps[stepNo].w !== "quiz") confetti();
    goHome(false);
  });
  $("#prev-btn").addEventListener("click", () => { if (stepNo > 0) { stepNo--; renderStep(); } });
  $("#back-btn").addEventListener("click", () => goHome(false));
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
