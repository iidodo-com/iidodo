"""ダッシュボード(外部CDNなし・1ファイル完結のHTML)。output/dashboard_YYYYMMDD.html"""
import html
from datetime import datetime

import numpy as np
import pandas as pd

from . import config as C
from .datasets import _tradable
from .svgchart import CSS, JS, downsample, line_chart, scatter_chart

E = html.escape


def stats_for(s, kind):
    s = s.dropna()
    if len(s) < 2:
        return None
    cur, prev = s.iloc[-1], s.iloc[-2]
    win = s[s.index > s.index[-1] - pd.Timedelta(days=365)]
    pct = float((win <= cur).mean() * 100)
    return {"cur": float(cur), "date": s.index[-1], "prev": float(prev), "prev_date": s.index[-2], "diff": float(cur - prev),
            "pct": (cur / prev - 1) * 100 if prev else np.nan, "pctile": pct, "n1y": int(len(win)), "kind": kind}


def _fmtnum(v, d=2):
    return f"{v:,.{d}f}"


def periods(s):
    s = s.dropna()
    last = s.index.max()
    return [("過去1年", s[s.index > last - pd.Timedelta(days=365)]),
            ("過去3年", s[s.index > last - pd.Timedelta(days=365 * 3)]),
            ("全期間", s)]


def indicator_block(key, title, s, kind, unit, digits, footer_html, extra_note=""):
    st = stats_for(s, kind)
    charts = []
    for label, part in periods(s):
        part2, ds = downsample(part)
        note = "・週次/月次に間引き表示" if ds else ""
        charts.append(line_chart({title: part2}, f"{label}", unit, digits, extra_note=note))
    return (f'<section class="ind" id="{E(key)}"><h3>{E(title)} <span class="tag">{E(key)}</span></h3>{extra_note}'
            f'<div class="row3">{"".join(charts)}</div><div class="src">{footer_html}</div></section>'), st


def _delta_cell(st):
    if st is None:
        return '<td class="na">-</td>'
    if st["kind"] == "rate":
        return f'<td>{st["diff"]:+.2f}</td>'
    return f'<td>{st["diff"]:+,.2f}（{st["pct"]:+.2f}%）</td>'


def fred_footer(meta):
    if not meta:
        return "メタ情報なし"
    return (f'取得元: {E(str(meta.get("source", "")))} <a href="{E(str(meta.get("source_url", "")))}">{E(str(meta.get("source_url", "")))}</a> / '
            f'提供元の表題: {E(str(meta.get("provider_note")))} / 頻度: {E(str(meta.get("frequency")))} / 単位: {E(str(meta.get("units_fred")))} / '
            f'データ期間: {meta.get("first_date")}〜{meta.get("last_date")} / FRED側更新: {E(str(meta.get("fred_last_updated")))} / '
            f'取得日時(UTC): {E(str(meta.get("fetched_at_utc")))}<br>'
            f'欠損: 全期間{meta.get("n_missing_total")}件・直近1年{meta.get("n_missing_last_365d")}件(祝日等は値なし)。<b>前日値の持ち越しはしていません</b>(グラフは有効な観測点を直線で結ぶだけで、欠損日に値は作りません)。')


def px_footer(meta, ticker, role):
    if not meta:
        return "メタ情報なし(手動CSVのみ、または未取得)"
    ver = meta.get("verification")
    ver_txt = ver if isinstance(ver, str) else "; ".join(f'{v["from"]}〜{v["to"]}: {v["status"]}' for v in ver)
    spl = meta.get("splits_per_yfinance") or {}
    return (f'取得元: {E(str(meta.get("source")))}(yfinance {E(str(meta.get("yfinance_version")))}) / データ期間: {meta.get("first_date")}〜{meta.get("last_date")} / '
            f'取得日時(UTC): {E(str(meta.get("fetched_at_utc")))} / 調整: {E(str(meta.get("adjust_method")))}(auto_adjust=False)<br>'
            f'分割(yfinance上の日付): {E(str(spl)) if spl else "なし"} / 終値の証券会社画面との照合: {E(ver_txt)} / '
            f'未確定の足の除外: {E(", ".join(meta.get("excluded_partial_bars") or []) or "なし")}<br>'
            f'欠損・休場: 補完・前日値の持ち越しはしません。出来高0の行(個別株)は計算から除外し、下の一覧に出します。')


def build(data, today=None):
    cfg = data.cfg
    today = today or datetime.now()
    out_dir = C.output_dir(cfg)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = today.strftime("%Y%m%d")
    rows, blocks = [], {"fred": {}, "px": []}
    groups = {}
    for spec in cfg["fred"]["series"]:
        sid = spec["id"]
        if sid not in data.fred:
            continue
        s = data.fred[sid]["value"]
        digits = 2 if spec["kind"] == "rate" else 2
        html_b, st = indicator_block(sid, spec["name"], s, spec["kind"], spec["unit"], digits, fred_footer(data.meta.get(sid)))
        groups.setdefault(spec["group"], []).append(html_b)
        rows.append((spec["group"], sid, spec["name"], spec["unit"], st, data.meta.get(sid, {}), "FRED"))
    px_blocks = {}
    for t in cfg["yfinance"]["tickers"]:
        tk = t["ticker"]
        if tk not in data.px or t["role"] == "reference_etf":
            continue
        df = data.px[tk]
        s = df.loc[_tradable(df, t["role"]), "close"]
        label = {"index": "指数", "us_etf": "米国ETF", "jp_stock": "日本株", "jp_optional": "日本株(任意・主分析外)"}[t["role"]]
        if t["role"] == "jp_optional":
            ex = '<div class="note warn">主分析（バスケット）には含めません。上場が浅く、株式分割の影響があるため参考表示です。</div>'
        else:
            ex = ""
        html_b, st = indicator_block(tk, f'{t["name"]}', s, "price", "", 2, px_footer(data.meta.get(tk), tk, t["role"]), ex)
        px_blocks.setdefault(label, []).append(html_b)
        rows.append((label, tk, t["name"], "", st, data.meta.get(tk, {}), "yfinance"))
    # バスケット
    basket_html = ""
    if data.basket is not None:
        lvl = data.basket["level"][data.basket["ret"].notna()]
        members = [m for m in cfg["basket"]["members"] if m in data.px]
        note = (f'<div class="note">{E(cfg["basket"]["name"])}: {", ".join(E(m) for m in members)} の日次リターンの単純平均を連鎖した水準(開始=100)。'
                '複数営業日にまたがるリターン・出来高0の日は平均から除外(下の一覧)。個別銘柄は上の各グラフで別に見られます。'
                '<br><b>限界:</b> 銘柄は現時点の知識で選んだもので、後知恵(選択バイアス)が入っています。4銘柄は同じ製造装置セクターで相関が高く、実質は1つの要因に近い可能性があります。</div>')
        basket_html, st = indicator_block("BASKET", cfg["basket"]["name"], lvl, "price", "", 2,
                                          "算出: 各銘柄のClose(分割調整済み・配当なし)の日次リターンを営業日ごとに等ウェイト平均。取得元はyfinance。", note)
        rows.append(("日本株", "BASKET", cfg["basket"]["name"], "", st, {}, "算出"))
        px_blocks.setdefault("日本株", []).insert(0, basket_html)

    # ---- 日本株終値の照合表 ----
    recon = _recon_table(data)
    etf = _etf_section(data)
    flags_html, flags_csv = _flags(data, out_dir, stamp)

    table_rows = []
    for grp, key, name, unit, st, meta, src in rows:
        if st is None:
            table_rows.append(f'<tr><td class="l">{E(grp)}</td><td class="l"><a href="#{E(key)}">{E(name)}</a></td><td class="na" colspan="6">データ不足</td></tr>')
            continue
        d = 2
        miss1y = meta.get("n_missing_last_365d", "-") if src == "FRED" else "-"
        table_rows.append(
            f'<tr><td class="l">{E(grp)}</td><td class="l"><a href="#{E(key)}">{E(name)}</a></td>'
            f'<td>{_fmtnum(st["cur"], d)} {E(unit)}</td><td>{st["date"].date()}</td>{_delta_cell(st)}'
            f'<td>{st["pctile"]:.0f}%（n={st["n1y"]}）</td><td>{E(str(meta.get("fetched_at_utc", "-"))[:19])}</td><td>{miss1y}</td></tr>')
    miss_html = ""
    if data.missing:
        miss_html = ('<div class="note bad"><b>取得できなかった指標（以下を除いて作成しています）</b><ul>' +
                     "".join(f'<li>{E(m["key"])} {E(m["name"])}: {E(m["reason"])}</li>' for m in data.missing) + "</ul></div>")
    body = [f'<h1>半導体 × マクロ ダッシュボード</h1><div class="sub">作成: {today:%Y-%m-%d %H:%M}（この端末の時刻）。外部サイトへ接続しない1ファイルです。',
            ' ライト/ダークはOS設定に従います。</div>', miss_html,
            '<div class="note warn"><b>ICE BofA系の社債スプレッド</b>は、FREDでは約3年分に制限されています(ICE Data Indicesの注記)。社内利用のみ可・第三者への配布不可のため、'
            'このファイルを共有・公開しないでください。Moody\'s系(BAA10Y/AAA10Y)は<b>定義が異なる別系列</b>(長期社債利回り−10年国債)で、ICE系と同じグラフ・同じ線には混ぜていません。</div>',
            '<h2>サマリー</h2><div class="tw"><table><thead><tr><th class="l">区分</th><th class="l">指標</th><th>現在値</th><th>最終観測日</th><th>前日比</th>'
            '<th>過去1年の分位点(現在値以下の割合)</th><th>取得日時(UTC)</th><th>直近1年の欠損</th></tr></thead><tbody>' + "".join(table_rows) + '</tbody></table></div>',
            '<div class="sub">前日比: 金利・スプレッドは差(単位は列の単位)、価格系は差と変化率。分位点は最終観測日までの365日に含まれる有効な観測値のうち、現在値以下の割合(n=その件数)。</div>']
    for g in ["金利", "社債スプレッド(ICE)", "社債スプレッド(Moody's代替)", "為替", "リスク"]:
        if g in groups:
            body.append(f"<h2>{E(g)}</h2>" + "".join(groups[g]))
    for g in ["指数", "米国ETF", "日本株", "日本株(任意・主分析外)"]:
        if g in px_blocks:
            body.append(f"<h2>株価・指数: {E(g)}</h2>" + "".join(px_blocks[g]))
    body += [recon, etf, flags_html, _method(cfg)]
    page = (f'<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>半導体マクロ ダッシュボード {stamp}</title><style>{CSS}</style></head><body><div class="wrap">{"".join(body)}</div>'
            f'<div id="tip"></div><script>{JS}</script></body></html>')
    p = out_dir / f"dashboard_{stamp}.html"
    p.write_text(page, encoding="utf-8")
    return p, flags_csv


def _recon_table(data):
    cfg = data.cfg
    members = [m for m in cfg["basket"]["members"] if m in data.px]
    extra = [t["ticker"] for t in cfg["yfinance"]["tickers"] if t["role"] == "jp_optional" and t["ticker"] in data.px]
    cols = [cfg["basket"]["benchmark"]] + members + extra
    cols = [c for c in cols if c in data.px]
    if data.jp_cal is None:
        return ""
    days = list(data.jp_cal[-5:])
    if cfg["basket"]["benchmark"] in data.px:
        pass
    rows = []
    for d in days:
        cells = []
        for c in cols:
            df = data.px[c]
            v = df["close"].get(d, np.nan)
            src = df["src"].get(d, "") if "src" in df.columns else ""
            cells.append(f'<td>{"欠損" if pd.isna(v) else f"{v:,.1f}"}{"（手動）" if src == "manual" else ""}</td>')
        rows.append(f"<tr><td>{d.date()}</td>{''.join(cells)}</tr>")
    names = {t["ticker"]: t["name"] for t in cfg["yfinance"]["tickers"]}
    ver = cfg.get("verification") or []
    vtxt = "<br>".join(f'{", ".join(v["tickers"])}: {v["from"]}〜{v["to"]} {v["status"]}({v.get("by", "")})' for v in ver) or "照合記録なし → <b>すべて「未確認」</b>"
    return ('<h2>日本株終値の照合表（直近の確定5営業日）</h2><div class="note">証券会社画面の終値と見比べるための表です。yfinanceのCloseは<b>分割調整済み</b>で、'
            '分割日より前の日付は取引所の生の終値と一致しません(分割日以降の日付だけ比較してください)。当日の場中の値は含めていません。'
            '15:30の終値であるかは、照合した範囲のみ確認済みとし、それ以外は未確認です。<br>照合状況: ' + vtxt +
            '</div><div class="tw"><table><thead><tr><th class="l">日付</th>' + "".join(f'<th>{E(names.get(c, c))}<br>{E(c)}</th>' for c in cols) +
            '</tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>')


def _etf_section(data):
    cfg = data.cfg
    if data.basket is None:
        return ""
    etfs = [t for t in cfg["yfinance"]["tickers"] if t["role"] == "reference_etf" and t["ticker"] in data.px]
    if not etfs:
        return ""
    rows, charts = [], []
    b = data.basket["ret"]
    for t in etfs:
        df = data.px[t["ticker"]]
        ok = df["close"].notna() & ~(df["volume"] == 0)
        c = df.loc[ok, "close"].reindex(data.jp_cal)
        pos = pd.Series(np.arange(len(c)), index=c.index)
        r = (c / c.where(c.notna()).ffill().shift(1) - 1)
        span = (pos - pos.where(c.notna()).ffill().shift(1))
        r = r.where((span == 1) & c.notna())
        m = pd.concat([b.rename("b"), r.rename("e")], axis=1).dropna()
        if len(m) < 20:
            rows.append(f'<tr><td class="l">{E(t["name"])}({E(t["ticker"])})</td><td colspan="4" class="na">共通期間が短すぎます</td></tr>')
            continue
        rr = float(np.corrcoef(m["b"], m["e"])[0, 1])
        rows.append(f'<tr><td class="l">{E(t["name"])}（{E(t["ticker"])}）</td><td>{m.index.min().date()}〜{m.index.max().date()}</td><td>{len(m)}</td>'
                    f'<td>{rr:+.3f}</td><td>{(rr ** 2):.2f}</td></tr>')
        charts.append(scatter_chart(m["b"], m["e"], "バスケット日次リターン", t["name"], f'{t["ticker"]}（履歴約2年・検証対象外）'))
    return ('<h2>参考: バスケットは日経半導体株指数の動きをどの程度代表しているか</h2>'
            '<div class="note warn"><b>履歴約2年・検証対象外</b>。仮説の検証ではなく、4銘柄バスケットの日次リターンと日経半導体株指数連動ETF(各ETFの上場後の共通期間)の日次リターンの相関を見て、'
            'バスケットがどの程度この指数の動きを代表しているかの確認です。ETFのティッカーはyfinanceの検索結果で拾ったもので、連動指数の詳細は名称以上には確認していません。</div>'
            '<div class="tw"><table><thead><tr><th class="l">ETF</th><th>共通期間</th><th>日数</th><th>相関(ピアソン)</th><th>決定係数R²</th></tr></thead><tbody>' + "".join(rows) +
            f'</tbody></table></div><div class="row3">{"".join(charts)}</div>')


def _flags(data, out_dir, stamp):
    if not data.flags:
        return '<h2>データ品質フラグ</h2><div class="note">フラグはありません。</div>', None
    df = pd.DataFrame(data.flags)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["kind", "series", "date"])
    csvp = out_dir / f"flags_{stamp}.csv"
    df.to_csv(csvp, index=False, encoding="utf-8-sig")
    counts = df.groupby("kind").size().to_dict()
    label = {"zero_volume_excluded": "出来高0(非取引日の前値埋め疑い・除外)", "zero_volume_check": "出来高0だが他は通常取引(要確認・除外)",
             "large_move": "日次変動が大(補正なし)", "split": "分割日(yfinance上)", "partial_bar_excluded": "未確定の足を除外",
             "multi_day_return": "複数営業日にまたがるリターン(1日扱いしない)", "missing_vs_calendar": "営業日なのに行なし(補完しない)",
             "relative_excluded": "ベンチマーク相対の計算から除外", "manual_filled": "手動CSVで補完", "manual_conflict": "手動CSVとyfinanceが不一致",
             "basket_ret_unavailable": "バスケット日次リターンなし"}
    summ = "".join(f"<tr><td class='l'>{E(label.get(k, k))}</td><td>{v}</td></tr>" for k, v in sorted(counts.items()))
    priority = ["zero_volume_check", "missing_vs_calendar", "relative_excluded", "manual_conflict", "partial_bar_excluded", "manual_filled", "split", "multi_day_return"]
    show = df[df["kind"].isin(priority)]
    show = show.sort_values("date", ascending=False).head(150)
    rows = "".join(f"<tr><td class='l'>{E(label.get(r.kind, r.kind))}</td><td class='l'>{E(str(r.series))}</td><td>{r.date.date()}</td><td class='l'>{E(r.detail)}</td></tr>"
                   for r in show.itertuples())
    return ('<h2>データ品質フラグ一覧（黙って補正しません）</h2><div class="sub">全件は ' + E(csvp.name) + ' に出力。日次変動が大きい日・出来高0・分割日などは、補正せずフラグだけ付けています。</div>'
            f'<div class="tw"><table style="max-width:560px"><thead><tr><th class="l">種別</th><th>件数</th></tr></thead><tbody>{summ}</tbody></table></div>'
            f'<details open><summary>要確認・除外・補完の一覧(新しい順・最大150件)</summary><div class="tw"><table><thead><tr><th class="l">種別</th><th class="l">系列</th><th>日付</th><th class="l">内容</th></tr></thead><tbody>{rows}</tbody></table></div></details>'), csvp


def _method(cfg):
    return ('<h2>算出方法メモ</h2><div class="note">'
            '・欠損・休場日: 取得時は補完せず、前日値の持ち越しもしません。分析で米国の値を日本の営業日に載せる場合は、暦日が厳密に前の最新の米国値を使い、その対応を日付対応表に出力します。<br>'
            '・日次リターン(株): Close(分割調整済み・配当なし)の前営業日比。出来高0の日と、除外日をまたぐリターン(複数営業日ぶん)は1日リターンとして扱いません。配当込み(Adj Close)は感度分析として別に扱います。<br>'
            '・時差: 米国の終値は日本時間の翌朝5〜6時に確定します。未確定の足は、日本株は当日16:00(JST)、米国は米国日付の翌日08:00(JST)より前なら除外します(config.yamlで変更可)。<br>'
            '・yfinanceは非公式のデータ取得手段です。取得失敗・仕様変更・遡及改訂を前提に、取得した生データを取得日時つきで data/raw/ に保存しています。'
            '</div>')
