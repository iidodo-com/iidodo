"""外部依存なしの折れ線・散布図SVG。色はCSS変数(ライト/ダーク切替)。ホバーのツールチップはページ共通JSが data-* から描く。"""
import html
import json
import math

import numpy as np
import pandas as pd

SERIES_VARS = ["var(--s1)", "var(--s2)", "var(--s3)"]


def _nice_ticks(lo, hi, n=5):
    if not np.isfinite(lo) or not np.isfinite(hi):
        return [0, 1]
    if hi == lo:
        hi = lo + 1
    span = hi - lo
    step = 10 ** math.floor(math.log10(span / n))
    for m in (1, 2, 2.5, 5, 10):
        if span / (step * m) <= n:
            step *= m
            break
    start = math.ceil(lo / step) * step
    ticks = []
    v = start
    while v <= hi + 1e-12:
        ticks.append(round(v, 10))
        v += step
    return ticks or [lo, hi]


def _fmt(v, digits):
    return f"{v:,.{digits}f}"


def downsample(s, max_points=900):
    """点が多い系列は週次(各週の最後の実観測)に、それでも多ければ月次に間引く。日付は実際の観測日のまま(付け替えない)。"""
    s = s.dropna()
    if len(s) <= max_points:
        return s, False
    w = s.groupby(s.index.to_period("W")).tail(1)
    if len(w) > max_points:
        w = s.groupby(s.index.to_period("M")).tail(1)
    return w, True


def line_chart(series, title, unit="", digits=2, width=420, height=220, extra_note=""):
    """series: {name: pd.Series(日付index)}。1〜3本。2本以上は凡例を付ける。戻り値はHTML(<figure>)。"""
    series = {k: v.dropna() for k, v in series.items() if v is not None and len(v.dropna())}
    if not series:
        return f'<figure class="chart empty"><figcaption>{html.escape(title)}</figcaption><div class="nodata">データなし</div></figure>'
    ml, mr, mt, mb = 52, 14, 12, 26
    W, Hh = width, height
    pw, ph = W - ml - mr, Hh - mt - mb
    allv = pd.concat(series.values())
    xmin = min(s.index.min() for s in series.values())
    xmax = max(s.index.max() for s in series.values())
    ymin, ymax = float(allv.min()), float(allv.max())
    pad = (ymax - ymin) * 0.06 or abs(ymax) * 0.02 or 1
    ymin, ymax = ymin - pad, ymax + pad
    t0, t1 = xmin.value, xmax.value
    if t1 == t0:
        t1 = t0 + 1

    def X(ts):
        return ml + (ts.value - t0) / (t1 - t0) * pw

    def Y(v):
        return mt + (1 - (v - ymin) / (ymax - ymin)) * ph

    parts = [f'<svg viewBox="0 0 {W} {Hh}" role="img" aria-label="{html.escape(title)}" class="plot">']
    for tv in _nice_ticks(ymin, ymax, 4):
        y = Y(tv)
        parts.append(f'<line class="grid" x1="{ml}" x2="{W - mr}" y1="{y:.1f}" y2="{y:.1f}"/>')
        parts.append(f'<text class="tick" x="{ml - 6}" y="{y + 3.5:.1f}" text-anchor="end">{_fmt(tv, digits if ymax - ymin < 50 else 0)}</text>')
    # X軸ラベル: 年(長期)または年月
    years = (xmax - xmin).days / 365.25
    if years >= 2.5:
        yrs = range(xmin.year + 1, xmax.year + 1)
        stride = max(1, int(math.ceil(len(list(yrs)) / 5)))
        labs = [(pd.Timestamp(f"{y}-01-01"), str(y)) for y in list(yrs)[::stride]]
    else:
        n = 4
        labs = [(xmin + (xmax - xmin) * i / n, (xmin + (xmax - xmin) * i / n).strftime("%Y-%m")) for i in range(n + 1)]
    for ts, lab in labs:
        if xmin <= ts <= xmax:
            x = X(ts)
            anchor = "end" if x > W - mr - 22 else "middle"
            parts.append(f'<text class="tick" x="{x:.1f}" y="{Hh - 8}" text-anchor="{anchor}">{lab}</text>')
    data = {}
    for i, (name, s) in enumerate(series.items()):
        col = SERIES_VARS[i % 3]
        pts = " ".join(f"{X(ts):.1f},{Y(v):.1f}" for ts, v in s.items())
        parts.append(f'<polyline class="line" points="{pts}" style="stroke:{col}"/>')
        lt, lv = s.index[-1], s.iloc[-1]
        parts.append(f'<circle cx="{X(lt):.1f}" cy="{Y(lv):.1f}" r="3.5" class="dot" style="fill:{col}"/>')
        data[name] = {"x": [int(ts.value // 10 ** 6) for ts in s.index], "y": [round(float(v), 6) for v in s.values]}
    geo = {"ml": ml, "pw": pw, "mt": mt, "ph": ph, "t0": t0 // 10 ** 6, "t1": t1 // 10 ** 6, "ymin": ymin, "ymax": ymax,
           "digits": digits, "unit": unit, "W": W, "H": Hh}
    parts.append('<g class="hv" style="display:none"><line class="cross" y1="%d" y2="%d"/></g>' % (mt, mt + ph))
    parts.append(f'<rect class="hit" x="{ml}" y="{mt}" width="{pw}" height="{ph}" fill="transparent"/>')
    parts.append("</svg>")
    legend = ""
    if len(series) >= 2:
        legend = '<div class="legend">' + "".join(
            f'<span><i style="background:{SERIES_VARS[i % 3]}"></i>{html.escape(n)}</span>' for i, n in enumerate(series)) + "</div>"
    rng = f"{xmin.date()}〜{xmax.date()}"
    npts = sum(len(s) for s in series.values()) if len(series) == 1 else max(len(s) for s in series.values())
    cap = f'<figcaption><b>{html.escape(title)}</b><span class="rng">{rng}（{npts}点）{html.escape(extra_note)}</span></figcaption>'
    payload = html.escape(json.dumps({"geo": geo, "data": data}, ensure_ascii=False, separators=(",", ":")), quote=True)
    return f'<figure class="chart" data-chart="{payload}">{cap}{legend}{"".join(parts)}</figure>'


def scatter_chart(x, y, xlabel, ylabel, title, width=420, height=300):
    m = pd.concat([x, y], axis=1).dropna()
    if len(m) < 5:
        return f'<figure class="chart empty"><figcaption>{html.escape(title)}</figcaption><div class="nodata">データ不足</div></figure>'
    ml, mr, mt, mb = 52, 14, 12, 34
    pw, ph = width - ml - mr, height - mt - mb
    xs, ys = m.iloc[:, 0].values * 100, m.iloc[:, 1].values * 100
    lim = max(np.abs(xs).max(), np.abs(ys).max()) * 1.05
    X = lambda v: ml + (v + lim) / (2 * lim) * pw
    Y = lambda v: mt + (1 - (v + lim) / (2 * lim)) * ph
    p = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}" class="plot">']
    for tv in _nice_ticks(-lim, lim, 4):
        p.append(f'<line class="grid" x1="{ml}" x2="{width - mr}" y1="{Y(tv):.1f}" y2="{Y(tv):.1f}"/>')
        p.append(f'<text class="tick" x="{ml - 6}" y="{Y(tv) + 3.5:.1f}" text-anchor="end">{tv:g}</text>')
        p.append(f'<text class="tick" x="{X(tv):.1f}" y="{height - 18}" text-anchor="middle">{tv:g}</text>')
    p.append(f'<line class="grid" x1="{ml}" x2="{width - mr}" y1="{mt + ph / 2}" y2="{mt + ph / 2}" style="stroke:var(--axis)"/>')
    for a, b in zip(xs, ys):
        p.append(f'<circle cx="{X(a):.1f}" cy="{Y(b):.1f}" r="2.6" class="sc"/>')
    p.append(f'<text class="tick" x="{ml + pw / 2}" y="{height - 4}" text-anchor="middle">{html.escape(xlabel)}（%）</text>')
    p.append("</svg>")
    return f'<figure class="chart"><figcaption><b>{html.escape(title)}</b><span class="rng">{m.index.min().date()}〜{m.index.max().date()}（{len(m)}点）</span></figcaption>{"".join(p)}</figure>'


CSS = """
:root{--bg:#fcfcfb;--panel:#ffffff;--ink:#0b0b0b;--ink2:#52514e;--muted:#7b7a75;--grid:#e6e5e0;--axis:#b9b8b0;--line:#dedcd5;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--warn:#a05a00;--bad:#b3261e;--ok:#0b6b3a;--chip:#f1f0ec}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1a1a19;--panel:#222221;--ink:#ffffff;--ink2:#c3c2b7;--muted:#9a998f;--grid:#33332f;--axis:#55544e;--line:#3a3a36;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--warn:#e0a24a;--bad:#ff8a80;--ok:#6fd39b;--chip:#2c2c2a}}
:root[data-theme="dark"]{--bg:#1a1a19;--panel:#222221;--ink:#ffffff;--ink2:#c3c2b7;--muted:#9a998f;--grid:#33332f;--axis:#55544e;--line:#3a3a36;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--warn:#e0a24a;--bad:#ff8a80;--ok:#6fd39b;--chip:#2c2c2a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Yu Gothic UI","Meiryo","Hiragino Sans","Noto Sans CJK JP",system-ui,sans-serif;line-height:1.55}
.wrap{max-width:1320px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.2rem;margin:34px 0 10px;padding-top:10px;border-top:1px solid var(--line)}h3{font-size:1rem;margin:22px 0 6px}
.sub{color:var(--ink2);font-size:.9rem}.note{background:var(--chip);border-left:4px solid var(--axis);padding:8px 12px;margin:10px 0;font-size:.9rem;color:var(--ink2)}
.warn{border-left-color:var(--warn)}.bad{border-left-color:var(--bad)}
table{border-collapse:collapse;width:100%;font-size:.88rem;background:var(--panel)}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:right;vertical-align:top}
th{color:var(--ink2);font-weight:600;background:var(--chip)}th:first-child,td:first-child,td.l,th.l{text-align:left}
.tw{overflow-x:auto}
.ind{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px 12px;margin:14px 0}
.ind h3{margin:0 0 6px}
.row3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
figure.chart{margin:0;position:relative}figcaption{font-size:.85rem;display:flex;flex-direction:column}figcaption .rng{color:var(--muted);font-size:.78rem}
svg.plot{width:100%;height:auto;display:block}.grid{stroke:var(--grid);stroke-width:1}.tick{fill:var(--muted);font-size:10px}
.line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}.dot{stroke:var(--panel);stroke-width:2}
.sc{fill:var(--s1);fill-opacity:.55}.cross{stroke:var(--axis);stroke-width:1}
.legend{display:flex;gap:12px;font-size:.78rem;color:var(--ink2);margin:2px 0}.legend i{display:inline-block;width:12px;height:3px;margin-right:4px;vertical-align:middle}
.nodata{color:var(--muted);padding:40px 0;text-align:center}
.src{font-size:.78rem;color:var(--muted);margin-top:6px}
#tip{position:fixed;pointer-events:none;background:var(--panel);color:var(--ink);border:1px solid var(--axis);border-radius:4px;padding:4px 8px;font-size:.78rem;display:none;z-index:9;white-space:nowrap}
.tag{display:inline-block;padding:0 6px;border-radius:3px;font-size:.75rem;background:var(--chip);color:var(--ink2)}
.v-s{color:var(--ok);font-weight:700}.v-n{color:var(--bad);font-weight:700}.v-u{color:var(--warn);font-weight:700}
.pos{color:var(--ink)}.na{color:var(--muted)}
.verdict{border:1px solid var(--line);background:var(--panel);border-radius:6px;padding:10px 14px;margin:10px 0}
details{margin:6px 0}summary{cursor:pointer;color:var(--ink2)}
"""

JS = """
(function(){var tip=document.getElementById('tip');
document.querySelectorAll('figure.chart[data-chart]').forEach(function(f){
 var P=JSON.parse(f.getAttribute('data-chart')),g=P.geo,svg=f.querySelector('svg'),hv=svg.querySelector('.hv'),cl=hv.querySelector('line'),hit=svg.querySelector('.hit');
 var names=Object.keys(P.data);
 hit.addEventListener('mousemove',function(e){var r=svg.getBoundingClientRect(),sx=g.W/r.width,px=(e.clientX-r.left)*sx;
  var t=g.t0+(px-g.ml)/g.pw*(g.t1-g.t0),best=null,bd=1e30,k0=names[0],xs=P.data[k0].x;
  var lo=0,hi=xs.length-1;while(lo<hi){var m=(lo+hi)>>1;if(xs[m]<t)lo=m+1;else hi=m;}
  var i=lo;if(i>0&&Math.abs(xs[i-1]-t)<Math.abs(xs[i]-t))i--;
  var d=new Date(xs[i]),ds=d.toISOString().slice(0,10),lines=[ds];
  names.forEach(function(n){var X=P.data[n].x,Y=P.data[n].y,j=0,bb=1e30;for(var q=0;q<X.length;q++){var dd=Math.abs(X[q]-xs[i]);if(dd<bb){bb=dd;j=q;}}
   if(bb<864e5*10)lines.push((names.length>1?n+': ':'')+Y[j].toLocaleString('ja-JP',{maximumFractionDigits:g.digits})+(g.unit?' '+g.unit:''));});
  var cx=g.ml+(xs[i]-g.t0)/(g.t1-g.t0)*g.pw;cl.setAttribute('x1',cx);cl.setAttribute('x2',cx);hv.style.display='';
  tip.innerHTML=lines.join('<br>');tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';});
 hit.addEventListener('mouseleave',function(){hv.style.display='none';tip.style.display='none';});});})();
"""
