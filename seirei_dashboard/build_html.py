#!/usr/bin/env python3
"""data/dataset.json から単一HTML（out/dashboard.html）を生成する。取得スクリプトとは独立。

  python build_html.py [--dataset data/dataset.json] [--out out/dashboard.html]
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

TEMPLATE = r"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>政令指定都市 比較ダッシュボード</title>
<style>
:root {
  color-scheme: light;
  --bg: #f4f3ef; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #7b7a74;
  --grid: #e3e2dc; --bar: #c2c1b9; --accent: #2a78d6; --accent-soft: #e6f0fb;
  --warn-bg: #fff4dd; --warn-ink: #6b4a00; --warn-line: #e5b24a; --miss: #8a1f1f;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --bg: #121211; --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #99988f;
    --grid: #2d2d2b; --bar: #5b5a55; --accent: #3987e5; --accent-soft: #14263d;
    --warn-bg: #2d2410; --warn-ink: #f1d08a; --warn-line: #8a6a22; --miss: #ff9b9b;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #121211; --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #99988f;
  --grid: #2d2d2b; --bar: #5b5a55; --accent: #3987e5; --accent-soft: #14263d;
  --warn-bg: #2d2410; --warn-ink: #f1d08a; --warn-line: #8a6a22; --miss: #ff9b9b;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.6 -apple-system, "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", Meiryo, sans-serif; }
header, main, footer { max-width: 1240px; margin: 0 auto; padding: 0 16px; }
header { padding-top: 24px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 18px 0 6px; color: var(--ink2); }
.sub { color: var(--ink2); font-size: 13px; margin: 0; }
.notice { background: var(--warn-bg); color: var(--warn-ink); border-left: 4px solid var(--warn-line);
  padding: 8px 12px; margin: 14px 0; font-size: 13px; border-radius: 4px; }
.layout { display: grid; grid-template-columns: 300px 1fr; gap: 16px; align-items: start; margin-top: 8px; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
.card { background: var(--surface); border: 1px solid var(--grid); border-radius: 8px; padding: 14px 16px; }
nav .grp { font-size: 12px; font-weight: 700; color: var(--ink2); margin: 12px 0 4px; letter-spacing: .02em; }
nav .grp:first-child { margin-top: 0; }
nav button { display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 6px;
  padding: 6px 8px; color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; line-height: 1.4; }
nav button:hover { background: var(--grid); }
nav button[aria-current="true"] { background: var(--accent-soft); outline: 2px solid var(--accent); outline-offset: -2px; }
nav button .basis { display: block; color: var(--muted); font-size: 11px; }
nav .nf { font-size: 12px; color: var(--muted); padding: 4px 8px; }
nav .nf b { color: var(--miss); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }
.chip { font-size: 12px; border: 1px solid var(--grid); border-radius: 999px; padding: 1px 10px; color: var(--ink2); }
.chip.derived { border-color: var(--accent); color: var(--accent); }
.toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; font-size: 13px; color: var(--ink2); }
.toolbar button { font: inherit; font-size: 13px; padding: 3px 12px; border: 1px solid var(--grid);
  background: var(--surface); color: var(--ink); border-radius: 6px; cursor: pointer; }
.toolbar button[aria-pressed="true"] { border-color: var(--accent); outline: 1px solid var(--accent); }
.summary { font-size: 14px; margin: 4px 0 10px; }
.summary b { color: var(--accent); }
/* 棒グラフ */
.bars { position: relative; }
.row { display: grid; grid-template-columns: 2.2em 6.5em 1fr 8.5em; gap: 8px; align-items: center;
  padding: 2px 4px; border-radius: 4px; font-size: 13px; }
.row.hl { background: var(--accent-soft); font-weight: 700; }
.row:hover { background: var(--grid); }
.row .rk { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.row .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .track { position: relative; height: 16px; }
.row .track::before { content: ""; position: absolute; left: var(--zero); top: -3px; bottom: -3px; width: 1px; background: var(--muted); }
.row .bar { position: absolute; top: 2px; height: 12px; background: var(--bar); border-radius: 0 4px 4px 0; }
.row.hl .bar { background: var(--accent); }
.row .bar.neg { border-radius: 4px 0 0 4px; }
.row .val { text-align: right; font-variant-numeric: tabular-nums; }
.row.na .val { color: var(--miss); }
.row.na .track { color: var(--muted); font-size: 12px; line-height: 16px; }
#tip { position: fixed; z-index: 10; pointer-events: none; background: var(--ink); color: var(--bg);
  padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.5; max-width: 320px; display: none; }
/* 表 */
.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { padding: 5px 8px; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: top; }
th { color: var(--ink2); font-weight: 600; white-space: nowrap; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
tr.hl td { background: var(--accent-soft); font-weight: 700; }
td.miss { color: var(--miss); }
.formula { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px;
  background: var(--bg); padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.small { font-size: 12px; color: var(--ink2); }
footer { padding-bottom: 40px; }
footer h2 { margin-top: 24px; }
footer td, footer th { font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
a { color: var(--accent); }
details summary { cursor: pointer; color: var(--ink2); }
</style>
</head>
<body>
<header>
  <h1>政令指定都市 比較ダッシュボード</h1>
  <p class="sub">公的統計（e-Stat・総務省）の公開データのみを使用。広島市を強調表示。取得日時: <span id="fetchedAt"></span></p>
  <div class="notice">統計ごとに調査時点が異なります（職員数：令和6年4月1日／住民基本台帳人口：令和6年1月1日・令和7年1月1日／国勢調査：令和2年10月1日／財政：令和5年度決算）。
    指標ごとに調査時点を表示し、時点の異なるデータを割り算する派生指標では、分子・分母それぞれの時点を明記しています。取得できなかった値は「未取得」と表示し、補完・推測はしていません。</div>
</header>
<main>
  <div class="layout">
    <nav class="card" id="catalog" aria-label="指標の選択"></nav>
    <section class="card" id="panel" aria-live="polite"></section>
  </div>
</main>
<footer>
  <h2>出典・取得記録</h2>
  <div class="card tablewrap"><table id="srcTable"></table></div>
  <h2>未取得の指標</h2>
  <div class="card" id="nfBox"></div>
  <p class="small">取得スクリプト（fetch_data.py）→ 整形（build_data.py）→ 本HTML生成（build_html.py）の順に再生成できます。取得記録は data/manifest.json、整形後データは data/dataset.json にも保存されています。</p>
</footer>
<div id="tip" role="tooltip"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
"use strict";
const D = JSON.parse(document.getElementById('data').textContent);
const city = Object.fromEntries(D.cities.map(c => [c.code, c]));
const ind = Object.fromEntries(D.indicators.map(i => [i.id, i]));
const src = Object.fromEntries(D.sources.map(s => [s.id, s]));
const state = { id: D.indicators.find(i => i.id === 'staff_total_per10k') ? 'staff_total_per10k' : D.indicators[0].id, order: 'desc' };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (v, d) => v == null ? '—' : Number(v).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtU = (v, i) => fmt(v, i.decimals) + (i.unit ? ' ' + i.unit : '');

document.getElementById('fetchedAt').textContent = D.generated_from_fetch_at;

function renderCatalog() {
  let html = '', last = null;
  for (const i of D.indicators) {
    if (i.group !== last) { html += `<div class="grp">${esc(i.group)}</div>`; last = i.group; }
    const miss = Object.values(i.values).filter(v => v.status === 'missing').length;
    html += `<button data-id="${i.id}" aria-current="${i.id === state.id}">${esc(i.label)}${i.kind === 'derived' ? ' ＊算出' : ''}
      <span class="basis">${esc(i.basis)}${miss ? ` ／ <b style="color:var(--miss)">未取得 ${miss}市</b>` : ''}</span></button>`;
  }
  html += `<div class="grp">未取得（今回の取得対象外）</div>` + D.not_fetched.map(n =>
    `<div class="nf"><b>未取得</b> ${esc(n.label)}</div>`).join('');
  const el = document.getElementById('catalog');
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.onclick = () => { state.id = b.dataset.id; renderCatalog(); renderPanel(); });
}

function ranked(i) {
  const ok = D.cities.filter(c => i.values[c.code].status === 'ok').map(c => ({ c, v: i.values[c.code] }));
  ok.sort((a, b) => state.order === 'desc' ? b.v.value - a.v.value : a.v.value - b.v.value);
  let rank = 0;
  ok.forEach((r, k) => { if (k === 0 || r.v.value !== ok[k - 1].v.value) rank = k + 1; r.rank = rank; });
  const na = D.cities.filter(c => i.values[c.code].status !== 'ok').map(c => ({ c, v: i.values[c.code], rank: null }));
  return { ok, na };
}

function tipText(r, i) {
  const v = r.v;
  let t = `<b>${esc(r.c.name)}</b>（${esc(r.c.pref)}）<br>${v.status === 'ok' ? fmtU(v.value, i) : naText(v)}`;
  if (v.status === 'ok' && i.kind === 'derived') t += `<br>${fmt(v.numerator, 0)} ÷ ${fmt(v.denominator, 0)} × ${i.multiplier.toLocaleString('ja-JP')}`;
  return t;
}
const naText = v => v.status === 'dash' ? `資料上「${esc(v.raw_text)}」（値なし）` : '未取得';

function renderPanel() {
  const i = ind[state.id], { ok, na } = ranked(i);
  const vals = ok.map(r => r.v.value);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = (hi - lo) || 1;
  const pos = v => ((v - lo) / span) * 100;
  const hl = ok.find(r => r.c.code === D.highlight);
  const hlNa = na.find(r => r.c.code === D.highlight);
  const srcs = i.sources.map(s => src[s]);

  let h = `<h2>${esc(i.label)}</h2>
    <div class="chips"><span class="chip">${esc(i.basis)}</span>
      <span class="chip">単位: ${esc(i.unit || 'なし')}</span>
      ${i.kind === 'derived' ? '<span class="chip derived">算出値</span>' : '<span class="chip">元データ</span>'}
      ${srcs.map(s => `<span class="chip">${esc(s.survey_label || s.survey_date)}</span>`).join('')}</div>`;
  if (hl) h += `<p class="summary">広島市: <b>${fmtU(hl.v.value, i)}</b>（${ok.length}市中 <b>${hl.rank}位</b>、${state.order === 'desc' ? '大きい順' : '小さい順'}）</p>`;
  else if (hlNa) h += `<p class="summary">広島市: <b style="color:var(--miss)">${naText(hlNa.v)}</b></p>`;
  h += `<div class="toolbar">並び順:
      <button data-o="desc" aria-pressed="${state.order === 'desc'}">大きい順</button>
      <button data-o="asc" aria-pressed="${state.order === 'asc'}">小さい順</button></div>`;

  h += `<div class="bars" role="list" aria-label="${esc(i.label)} 棒グラフ">`;
  for (const r of ok) {
    const v = r.v.value, a = pos(Math.min(0, v)), b = pos(Math.max(0, v));
    h += `<div class="row${r.c.code === D.highlight ? ' hl' : ''}" role="listitem" data-code="${r.c.code}"
        aria-label="${esc(r.c.name)} ${r.rank}位 ${fmtU(v, i)}">
      <span class="rk">${r.rank}</span><span class="nm">${esc(r.c.name)}</span>
      <span class="track" style="--zero:${pos(0)}%"><span class="bar${v < 0 ? ' neg' : ''}" style="left:${a}%;width:${Math.max(b - a, 0.4)}%"></span></span>
      <span class="val">${fmt(v, i.decimals)}</span></div>`;
  }
  for (const r of na) {
    h += `<div class="row na${r.c.code === D.highlight ? ' hl' : ''}" role="listitem" data-code="${r.c.code}">
      <span class="rk">–</span><span class="nm">${esc(r.c.name)}</span>
      <span class="track">${r.v.status === 'dash' ? '資料上「' + esc(r.v.raw_text) + '」（値なし・順位対象外）' : '未取得'}</span>
      <span class="val">${r.v.status === 'dash' ? '－' : '未取得'}</span></div>`;
  }
  h += `</div>`;

  // 順位表
  const derived = i.kind === 'derived';
  h += `<h3>順位表</h3><div class="tablewrap"><table><thead><tr><th class="n">順位</th><th>都市</th><th>都道府県</th>
    <th class="n">${esc(i.label)}（${esc(i.unit || '')}）</th>
    ${derived ? `<th class="n">分子：${esc(i.numerator_label)}</th><th class="n">分母：${esc(i.denominator_label)}</th>` : ''}</tr></thead><tbody>`;
  for (const r of [...ok, ...na]) {
    const v = r.v, cls = r.c.code === D.highlight ? 'hl' : '';
    h += `<tr class="${cls}"><td class="n">${r.rank ?? '–'}</td><td>${esc(r.c.name)}</td><td>${esc(r.c.pref)}</td>`;
    if (v.status === 'ok') h += `<td class="n">${fmt(v.value, i.decimals)}</td>` + (derived ? `<td class="n">${fmt(v.numerator, 0)}</td><td class="n">${fmt(v.denominator, 0)}</td>` : '');
    else h += `<td class="n miss">${v.status === 'dash' ? '－（資料上値なし）' : '未取得'}</td>` + (derived ? '<td></td><td></td>' : '');
    h += `</tr>`;
  }
  h += `</tbody></table></div>`;

  // 計算式
  h += `<h3>計算式・元の値</h3>`;
  if (derived) {
    h += `<div class="formula">${esc(i.formula)}</div>`;
    const hv = i.values[D.highlight];
    if (hv.status === 'ok') h += `<div class="formula">広島市: ${fmt(hv.numerator, 0)} ÷ ${fmt(hv.denominator, 0)} × ${i.multiplier.toLocaleString('ja-JP')} = ${fmt(hv.value, i.decimals)} ${esc(i.unit)}</div>`;
    h += `<p class="small">使用した元の指標: ` + i.inputs.map(id => `<a href="#" data-jump="${id}">${esc(ind[id].label)}</a>（${esc(ind[id].basis)}）`).join(' ／ ') + `</p>`;
    h += `<div class="notice">調査時点: ${esc(i.basis)}</div>`;
  } else {
    h += `<p class="small">資料の数値をそのまま表示しています（算出なし）。</p>`;
  }
  if (i.note) h += `<p class="small">注記: ${esc(i.note)}</p>`;
  h += `<p class="small">出典: ` + srcs.map(s => `<a href="${esc(s.page_url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(' ／ ') + `（詳細は画面下部）</p>`;

  const p = document.getElementById('panel');
  p.innerHTML = h;
  p.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { state.order = b.dataset.o; renderPanel(); });
  p.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => { e.preventDefault(); state.id = a.dataset.jump; renderCatalog(); renderPanel(); });
  const tip = document.getElementById('tip'), all = [...ok, ...na];
  p.querySelectorAll('.row').forEach(row => {
    const r = all.find(x => x.c.code === row.dataset.code);
    row.addEventListener('mousemove', e => { tip.innerHTML = tipText(r, i); tip.style.display = 'block';
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 330) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });
    row.addEventListener('mouseleave', () => tip.style.display = 'none');
  });
}

function renderSources() {
  let h = `<thead><tr><th>統計名</th><th>統計表ID・ファイル</th><th>URL</th><th>調査時点</th><th>更新時期</th><th>取得日時</th><th>SHA-256</th><th>状態</th></tr></thead><tbody>`;
  for (const s of D.sources) {
    h += `<tr><td>${esc(s.name)}<br><span class="small">${esc(s.publisher)}</span></td><td>${esc(s.stat_id)}</td>
      <td><a href="${esc(s.page_url)}" target="_blank" rel="noopener">公表ページ</a><br><a href="${esc(s.estat_url)}" target="_blank" rel="noopener">e-Stat</a>
        <details><summary>取得ファイル(${s.files.length})</summary>${s.files.map(f => `<div class="mono"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a></div>`).join('')}</details></td>
      <td>${esc(s.survey_label || '')}<br><span class="small">${esc(s.survey_date)}</span></td>
      <td>${s.updated ? esc(s.updated) : '<span style="color:var(--miss)">未取得</span>'}</td>
      <td>${esc(s.retrieved_at || '未取得')}</td>
      <td class="mono">${s.files.map(f => f.sha256 ? esc(f.sha256.slice(0, 12)) + '…' : '未取得').filter((x, k, a) => a.indexOf(x) === k).slice(0, 1).join('')}${s.files.length > 1 ? `<br><span class="small">ほか${s.files.length - 1}件（dataset/manifestに全件）</span>` : ''}</td>
      <td>${s.status === 'ok' ? '取得済' : `<span style="color:var(--miss)">未取得</span><br><span class="small">${esc(s.reason || '')}</span>`}</td></tr>`;
  }
  document.getElementById('srcTable').innerHTML = h + '</tbody>';
  document.getElementById('nfBox').innerHTML = '<ul>' + D.not_fetched.map(n => `<li><b style="color:var(--miss)">未取得</b> ${esc(n.label)} — ${esc(n.reason)}</li>`).join('') + '</ul>';
}

renderCatalog(); renderPanel(); renderSources();
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(ROOT / "data" / "dataset.json"))
    ap.add_argument("--out", default=str(ROOT / "out" / "dashboard.html"))
    a = ap.parse_args()
    d = json.loads(Path(a.dataset).read_text(encoding="utf-8"))
    d.pop("integrity", None)  # 検算用データは画面に埋め込まない
    blob = json.dumps(d, ensure_ascii=False).replace("</", "<\\/")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(TEMPLATE.replace("__DATA__", blob), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
