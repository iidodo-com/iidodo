# 半導体 × マクロ 検証ツール

米国の金利・社債スプレッド・為替・VIXと、半導体関連の株価・指数を取得し、**ローカルで開ける1ファイルのHTML**にまとめます。
仮説「社債スプレッドの縮小（または拡大の一服）が、半導体株の反発に先行する」を、**成り立たない場合も成り立たないと分かる形**で検証します。

- 相関は因果を意味しません。結果は「支持する／支持しない／判断できない」のいずれかを、数値と基準とともに出します。
- **判定基準は結果を見る前に固定する**ため、`config.yaml` の `hypothesis.criteria_confirmed` が `true` になるまで、実データでの検定は実行されません。

## 動作条件
- Windows / Python 3.10 以上
- `pip install -r requirements.txt`（requests, pandas, numpy, scipy, matplotlib, yfinance, PyYAML）
  - **yfinance**: 株価・指数の取得に必要（非公式）。**PyYAML**: `config.yaml` の読み込みに必要。
  - 統計は scipy と numpy だけで自前実装（statsmodels は不要）。ダッシュボードのグラフは外部ライブラリ不要の自前SVGです。

## APIキー（FRED）
キーは**コードにもREADMEにも書かず**、次のどちらかで設定します（チャットやGitHubにも貼らないでください）。
1. 環境変数: コマンドプロンプトで `setx FRED_API_KEY "取得したキー"` → **コマンドプロンプトを開き直す**
2. プロジェクト直下に `.env` を作り、`FRED_API_KEY=取得したキー` と1行書く（`.env` は `.gitignore` 済み）

キーの取得（無料）: https://fred.stlouisfed.org/docs/api/api_key.html
未設定でも動きます（FRED系列は「取得できなかった指標」として明記され、株価側でダッシュボードを作ります）。

## 使い方
```
python -m semimacro check_env      # まずこれ。環境・取得・日本株の照合表・欠損をこのPCで診断（--intraday で5分足も比較）
python -m semimacro fetch          # 取得・更新（差分のみ）
python -m semimacro dashboard      # output\dashboard_YYYYMMDD.html
python -m semimacro hypothesis     # output\hypothesis_YYYYMMDD.html（criteria_confirmed: true のとき）
python -m semimacro hypothesis --synthetic   # 合成データの画面デモ（実データの結果ではない）
python -m semimacro all            # fetch + dashboard + hypothesis
python -m semimacro test           # 自動テスト
```
設定（指標・期間・ラグの範囲・ブロック長・判定基準・未確定の足の判定時刻）は `config.yaml` だけで変更できます。

## データの置き場所（`data/` は git に入りません）
| 場所 | 内容 |
|---|---|
| `data/series/` | 系列ごとのCSV。欠損は空欄のまま（前日値の持ち越しはしない） |
| `data/meta/` | 系列ごとのメタ情報（取得元・取得日時・調整方法・最終観測日・欠損数・照合状況） |
| `data/raw/<系列>/<取得日時>.*` | **取得したままの生データ**（FREDはJSON、yfinanceはCSV）。分割・配当で履歴が書き換わっても結果を再現できる |
| `data/manual/` | 手動CSV（保険） |

`output/` には、ダッシュボード、仮説検証、`flags_*.csv`（品質フラグ全件）、`date_map_*.csv`（日本日付→使った米国日付の対応表）、`hypothesis_cells_*.csv`（全セルの数値）が出ます。

**ICE BofA系のデータは再配布不可（社内利用のみ）**です。`data/` と `output/` をGitHub等に上げたり、他人に渡したりしないでください。

### 差分取得
- FRED: 最終日から `overlap_days` 日遡って取り直し、改訂があれば件数をメタ情報に記録。
- yfinance: 直近を重ねて取得し、保存値と終値・調整後終値が食い違えば（分割・配当による遡及改訂）**全期間を取り直し**ます。

## 日本株の終値の照合
`check_env` が出す「日本株の終値照合表」を、証券会社画面の終値と見比べてください。
- yfinanceの `Close` は**分割調整済み**です。取引所の生の終値ではないので、分割日より前の日付は画面と一致しません（分割日以降の日付で比較）。
- 15:30の終値になっているかは、日足だけでは確認できません。照合した範囲のみ確認済みとし、それ以外は「未確認」と表示します。
- 一致したら `config.yaml` の `verification` に追記します（例は同ファイル内）。**不一致があれば**、その銘柄・日付は yfinance を正とせず、手動CSVで補正してください。

## 手動CSV（`data/manual/<ティッカー>.csv`、`^` は除く: `^N225` → `N225.csv`）
| 列 | 必須 | 内容 |
|---|---|---|
| `date` | ○ | 現地の取引日 `YYYY-MM-DD`（`YYYY/MM/DD` も可） |
| `close_adj` | ○ | 終値（調整後） |
| `adjusted` | ○ | `none`（調整なし）/ `split`（分割調整）/ `split+div`（分割+配当調整） |
| `close_raw` | | 生の終値 |
| `source`, `note` | | 例: `SBI画面` |

`templates/manual_template.csv` をコピーして使います。yfinanceに無い日だけを補い、yfinanceと0.5%超ずれる日は警告してyfinanceを優先します。UTF-8またはShift_JISで保存してください。

## 日米の日付合わせ（規則A・B）
- **規則A（日本株）**: 日本の取引日 j に対応させる米国の値は、**暦日が j より厳密に前**の最新の米国営業日の値。同日の米国値は使いません。使った米国日付は `date_map_*.csv` に出ます。
- **規則B（先行テスト）**: 先行リターン = `close(t+lag+h)/close(t+lag) − 1`。lag=0 でも反応日（j−1→j）は含みません。同時反応は診断として別表示です。
- FRED系列の日付 d の値は「d日の米国終値を反映した値」として扱い、米国ターゲット（^SOXなど）は米国の暦・同日で合わせます。

## データ品質フラグ（黙って補正しません）
出来高0（個別株・ETFのみ。指数は対象外）、分割日、日次±12%超の変動、未確定の足、複数営業日にまたがるリターン、営業日なのに行がない日などを、補正せずに一覧に出します。
- 出来高0の行は計算から除外します。他のバスケット銘柄と日経平均が通常取引の日に1銘柄だけ0なら「要確認」（前値埋めとは断定しない）。
- 除外の結果、複数営業日にまたがるリターンは1日リターンとして扱わず、日数を記録します。
- 日経平均が欠損の日は前日値で埋めず、ベンチマーク相対の計算から除外して一覧に出します。
- 未確定の足: 日本株は当日16:00（JST）より前、米国は米国日付の翌日08:00（JST）より前なら除外（`config.yaml` で変更可）。

## 定期実行（Windowsタスクスケジューラの例）
米国の終値は日本時間の朝5〜6時に確定、日本株は15:30に引けるため、平日の朝と夕方の2回が目安です。
```
schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 08:15 /TN "SemiMacro_AM" ^
  /TR "cmd /c cd /d C:\path\to\semi_macro && python -m semimacro fetch && python -m semimacro dashboard >> run.log 2>&1"
schtasks /Create /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 16:30 /TN "SemiMacro_PM" ^
  /TR "cmd /c cd /d C:\path\to\semi_macro && python -m semimacro fetch && python -m semimacro dashboard >> run.log 2>&1"
```
- `C:\path\to\semi_macro` は実際の場所に、`python` はフルパスにすると確実です。
- `setx` で設定したキーは、同じユーザーで実行されるタスクから読めます。読めない場合は `.env` を使ってください。
- 頻繁に回しすぎるとYahoo側のレート制限（HTTP 429）に当たります。1日2回程度にしてください。

## エラー時の動き
ネットワークエラー・APIキー未設定・キー無効・レート制限・系列の廃止/ID誤りは、日本語で原因と対処を表示します。一部が取得できなくても、取得できた指標でダッシュボードを作り、欠けた指標を冒頭に明記します。

## 既知の限界
- **ICE BofA系OASは、FREDでは約3年分**（2023-10-06〜。FRED注記: 2026年4月以降は3年分のみ）。ここから20営業日窓の検定は、重ならない窓の標本数が足りず検定力不足になります。長期の代替として BAA10Y / AAA10Y（Moody's長期社債利回り−10年国債）を併用しますが、**定義が異なる別系列**で、ICE系OASと混ぜず、結果も別々に書きます。ICE系OASを含む社債スプレッド一般の結論にはなりません。
- HYのOASを長期で取れる無料の公的ソースは、確認できていません。
- yfinanceは非公式で、取得失敗・仕様変更・遡及改訂が起こりえます。Closeは取引所の生の終値ではありません。
- 日本の半導体指数・ETF（200A/221A/213A）は履歴約2年のため検証には使わず、バスケットが日経半導体株指数をどの程度代表するかの**参考表示のみ**です。ティッカーはyfinance検索で拾ったもので、連動指数の詳細は名称以上には確認していません。
- バスケット（8035, 6857, 6146, 6920）は現時点の知識で選んでおり、**後知恵（選択バイアス）**があります。4銘柄は相関が高く、実質は1つの要因に近い可能性があります。キオクシア(285A)は主分析から外し任意表示です。
- 「縮小の一服（拡大の一服）」という“変化の変化”は、今回は検定していません（スプレッドの k 営業日変化のみ）。
- 複数の系列・対象を同時に見るため、系列横断での偶然の混入は残ります（各判定は系列×対象ごとの最大統計量補正）。

## テスト
`python -m semimacro test`（または `python -m unittest discover -s tests`）。手計算で既知の値と一致する小さなダミーデータのテストを含みます（相関、k日変化・リターン、重ならない窓、ブロックのインデックス、最大統計量のp値、日付合わせ規則）。
