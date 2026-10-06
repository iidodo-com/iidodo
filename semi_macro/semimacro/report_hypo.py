"""仮説検証レポート(output/hypothesis_YYYYMMDD.html)。外部CDNなし・1ファイル。"""
import html
from datetime import datetime

import numpy as np
import pandas as pd

from . import config as C
from .mapping import date_map_table
from .svgchart import CSS

E = html.escape
VCLS = {"支持する": "v-s", "支持しない": "v-n", "判断できない": "v-u"}


def _vclass(v):
    for k, c in VCLS.items():
        if v and v.startswith(k):
            return c
    return ""


def _shade(r):
    if r is None or np.isnan(r):
        return ""
    a = min(abs(r) / 0.3, 1) * 0.55
    col = "42,120,214" if r < 0 else "235,104,52"      # 負=青(仮説の方向)、正=橙
    return f' style="background:rgba({col},{a:.2f})"'


def _lag_table(cells, with_inference):
    out = []
    lags = sorted(cells["lag"].unique())
    for (k, h), g in cells.groupby(["k", "h"]):
        g = g.sort_values("lag")
        head = "".join(f"<th>{int(l)}</th>" for l in lags)
        def row(label, vals, fmt="{:+.2f}", shade=True):
            tds = "".join(f'<td{_shade(v) if shade else ""}>{"-" if (v is None or (isinstance(v, float) and np.isnan(v))) else fmt.format(v)}</td>' for v in vals)
            return f'<tr><td class="l">{label}</td>{tds}</tr>'
        elig = g["n_eff_total"].iloc[0]
        rows = [row("相関r(重なる窓)", g["r"]), row("相関r(重ならない窓の平均)", g["r_no_mean"])]
        for i in range(len(g["split_r"].iloc[0])):
            rows.append(row(f"期間{i + 1}のr", [sr[i] for sr in g["split_r"]]))
        if with_inference:
            rows.append(row("95%CI下限(ブロックBS)", g["ci_lo"], shade=False))
            rows.append(row("95%CI上限", g["ci_hi"], shade=False))
            rows.append(row("調整後p(最大統計量)", g["p_adj"], "{:.3f}", shade=False))
        out.append(f'<h4>スプレッド{int(k)}営業日変化 × その後{int(h)}営業日リターン　'
                   f'<span class="tag">重ならない窓の標本数 約{elig:.0f}（各分割期間 約{g["n_eff_split_min"].iloc[0]:.0f}以上）</span></h4>'
                   f'<div class="tw"><table style="font-size:.72rem"><thead><tr><th class="l">ラグ(営業日)→</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>')
    return "".join(out)


def build(results, T, data, today=None, synthetic=False):
    cfg = data.cfg if data is not None else None
    h = cfg["hypothesis"]
    today = today or datetime.now()
    stamp = today.strftime("%Y%m%d")
    out_dir = C.output_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    crit, st = h["verdict"], h["stats"]
    L = h["lags"]
    parts = ['<h1>仮説検証：社債スプレッドの縮小は、半導体株の反発に先行するか</h1>']
    if synthetic:
        parts.append('<div class="note bad"><b>これは合成データによるデモです。実データの結果ではありません。</b></div>')
    parts.append('<div class="note bad"><b>読む前に</b><ul>'
                 '<li>これは<b>相関</b>の分析です。<b>因果を意味しません</b>。スプレッドの変化と株価は、共通の要因(景気・リスク選好・金利)で同時に動く可能性があります。</li>'
                 f'<li><b>多重比較</b>: {L["min"]}〜{L["max"]}日のラグ × 窓の組を同時に試すため、偶然に高く出る相関が混じります。最も相関が高いラグだけを取り上げて結論にしません。'
                 '調整後p値は「全セルの最大|r|」の分布(ブロック置換)から計算しています。</li>'
                 '<li><b>サンプルの限界</b>: ICE BofA系OASはFREDで約3年分しかありません。5/20営業日の窓は重なると自己相関が強く、実効的な標本数は大きく減ります。</li>'
                 '<li>判定基準は結果を見る前に固定したもの(下の表)です。基準を満たさなければ「判断できない」とし、無理に結論を出しません。</li></ul></div>')
    parts.append('<h2>判定基準（事前に固定）</h2><div class="tw"><table style="max-width:760px"><tbody>'
                 f'<tr><td class="l">仮説の方向</td><td class="l">スプレッドの縮小(変化&lt;0)の後に半導体株が上昇 ⇒ 相関が<b>負</b></td></tr>'
                 f'<tr><td class="l">検定に使う窓の組の条件</td><td class="l">重ならない窓での標本数: 全期間 {crit["min_effective_n_total"]} 以上、各分割期間 {crit["min_effective_n_per_split"]} 以上。満たさない組は検定力不足として判定に使わない</td></tr>'
                 f'<tr><td class="l">支持する(すべて)</td><td class="l">① 調整後p≦{crit["alpha"]}(最大統計量) ② 相関が負で、ブロックブートストラップ95%CIの上限が0未満 ③ 負の相関が連続{crit["min_consecutive_lags"]}ラグ以上の一群に含まれる ④ 全ての分割期間で符号が負(分割で結果が変われば支持しない)</td></tr>'
                 f'<tr><td class="l">支持しない(いずれか)</td><td class="l">仮説と逆方向(正)で調整後p≦{crit["alpha"]} / 適格な全セル・全ラグで95%CI下限が −{crit["equivalence_r"]} より上</td></tr>'
                 '<tr><td class="l">判断できない</td><td class="l">上のいずれにも当てはまらない、または適格な窓の組がない</td></tr>'
                 f'<tr><td class="l">統計手法</td><td class="l">循環ブロックブートストラップ(ブロック長{st["block_length"]}営業日・{st["n_bootstrap"]}回)、最大統計量のブロック置換検定({st["n_permutations"]}回、乱数種{st["seed"]})。iidブートストラップ・Holm法は不採用(窓の重なりと隣接ラグの従属で前提が崩れるため)</td></tr>'
                 '</tbody></table></div>')
    for fam in ("ICE", "Moodys"):
        fam_title = "ICE BofA系OAS（FRED・約3年）" if fam == "ICE" else "Moody's代替（BAA10Y/AAA10Y。ICE系OASとは定義が違う別系列。この結果をICE系OASを含む社債スプレッド一般の結論にしない）"
        parts.append(f'<h2>{E(fam_title)}</h2>')
        for sp in h["spread_series"]:
            if sp["family"] != fam:
                continue
            sid = sp["id"]
            parts.append(f'<h3>{E(sp["label"])}（{E(sid)}）</h3>')
            if (sid, None) in results:
                parts.append('<div class="note bad">この系列は取得できなかったため、検証できません。</div>')
                continue
            for tname in h["targets"]["verdict"]:
                r = results.get((sid, tname))
                if r is None or r.get("missing"):
                    parts.append(f'<div class="note bad">{E(tname)}: ターゲットのデータが無く検証できません。</div>')
                    continue
                q95 = f'最大統計量の95%点 {r["null_max_q95"]:.3f}。' if r["null_max_q95"] is not None else ""
                parts.append(f'<div class="verdict"><b>対象: {E(tname)}</b>（{E(r["target_desc"])}）<br>'
                             f'判定: <span class="{_vclass(r["verdict"])}" style="font-size:1.2rem">{E(r["verdict"])}</span><br>'
                             + "<br>".join(E(x) for x in r["reasons"]) +
                             f'<br><span class="sub">使用期間 {r["first"]}〜{r["last"]}、行数 {r["n_rows"]}(営業日)。適格な窓の組(変化日,先行日): {r["eligible_kh"] or "なし"}。{q95}</span></div>')
                if r["kind"] == "US" and r["carried_us_days"] is not None:
                    parts.append(f'<div class="sub">米国暦で合わせる際、スプレッドに当日値が無く直前値を使った日数: {r["carried_us_days"]}</div>')
                parts.append("<details><summary>ラグ別の相関・信頼区間・p値(全ラグを表示)</summary>" + _lag_table(r["cells"], True) + "</details>")
                d = r["diag"]
                parts.append('<details><summary>同時反応の診断(先行テストではありません)</summary><div class="tw"><table style="max-width:560px"><thead><tr><th>スプレッド変化の窓</th><th>同じ窓のターゲット変化との相関</th><th>95%CI</th><th>n</th></tr></thead><tbody>' +
                             "".join(f'<tr><td>{int(x.k)}日</td><td>{x.r:+.3f}</td><td>{x.ci_lo:+.2f}〜{x.ci_hi:+.2f}</td><td>{int(x.n)}</td></tr>' for x in d.itertuples()) +
                             '</tbody></table></div><div class="sub">日本株は、規則Aで載せた米国水準の変化と、同じ営業日窓(j−k→j)の日本側変化の相関。「反応日(j−1→j)」を含む同時の動きの確認です。</div></details>')
            parts.append('<details><summary>記述のみ(判定なし)：感度分析・個別銘柄</summary>' + "".join(
                f'<h4>{E(tname)}（{E(results[(sid, tname)]["target_desc"])}）</h4>' + _lag_table(results[(sid, tname)]["cells"], False)
                for tname in h["targets"]["descriptive"] if (sid, tname) in results and not results[(sid, tname)].get("missing")) +
                '<div class="sub">個別銘柄はバスケット平均で隠れる違いを見るための記述です。信頼区間・p値・判定は出しません。</div></details>')
    parts.append('<h2>算出方法</h2><div class="note">'
                 '・スプレッドの変化 x(t) = 水準(t) − 水準(t−k)（k=営業日。差、単位%ポイント）。日本株は日本の営業日カレンダー上で計算し、水準は規則A(暦日が厳密に前の最新の米国営業日の値)で載せたもの。米国ターゲットは米国暦・同日の値。<br>'
                 '・リターン y(t+lag) = close(t+lag+h)/close(t+lag) − 1（規則B。lag=0は反応日を含まない）。closeは分割調整済み・配当なしが基本(SOXXの配当込みは感度分析)。<br>'
                 '・日本のバスケット: 4銘柄の日次リターンの等ウェイト平均を連鎖。複数営業日にまたがる日次リターンと出来高0の日は除外。<br>'
                 '・重ならない窓: stride = max(k,h) で標本化し、開始位置を変えた全標本の相関の平均(最小・最大は表の元データCSV)。<br>'
                 '・期間分割: 時間順に2等分。分割で符号が変われば、その旨を判定理由に出します。<br>'
                 '・使った日付の対応(日本日付→米国日付)は date_map_YYYYMMDD.csv に出力しています。<br>'
                 '・<b>限界</b>: バスケットの銘柄選びには後知恵(選択バイアス)があります。ICE系OASは約3年・1サイクル分で、レジームの違いを検証できません。'
                 '「縮小の一服(拡大の一服)」という変化の変化は、今回は検定していません。複数の系列・対象を同時に見ているため、系列横断での偶然の混入も残ります。</div>')
    page = (f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>仮説検証 {stamp}</title><style>{CSS}h4{{margin:14px 0 4px;font-size:.9rem}}</style></head><body><div class="wrap">{"".join(parts)}</div></body></html>')
    p = out_dir / f"hypothesis_{stamp}{'_DEMO' if synthetic else ''}.html"
    p.write_text(page, encoding="utf-8")
    # 全セルのCSV
    frames = []
    for (sid, tname), r in results.items():
        if r.get("missing") or "cells" not in r:
            continue
        c = r["cells"].copy()
        c.insert(0, "target", tname)
        c.insert(0, "spread", sid)
        c["split_r"] = c["split_r"].apply(lambda v: "|".join(f"{x:.4f}" for x in v))
        c["split_n"] = c["split_n"].apply(lambda v: "|".join(str(x) for x in v))
        frames.append(c)
    if frames:
        pd.concat(frames).to_csv(out_dir / f"hypothesis_cells_{stamp}{'_DEMO' if synthetic else ''}.csv", index=False, encoding="utf-8-sig")
    return p
