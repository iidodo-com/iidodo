# 日本株デイトレ リアルタイムチャート（閲覧・記録専用）

東証の日本株について、1分足・5分足のローソク足、VWAP、SMA/EMA、ボリンジャーバンド、出来高をブラウザにリアルタイム表示し、
指標の条件を満たした場面を **イベントとして記録** して後から検証できるアプリです。

> **注文・売買機能は一切ありません。** 発注に使えるAPI（注文系・口座系エンドポイント）の呼び出しコードも書いていません
> （`tests/test_e2e.py::test_no_order_endpoints_in_code` がソースを検査します）。
> 表示・集計は投資判断の助言ではなく、投資は自己責任です。

---

## 1. 構成とデータの流れ

```
config.yaml / .env
main.py                FastAPI（/ws, /api/*, /, /stats, CSV）
core/session.py        取引セッション判定（前場・昼休み・後場・休場日）
core/aggregator.py     ティック → 1分足/5分足（出来高差分・異常ティック除外）
core/indicators.py     VWAP / SMA / EMA / ボリンジャー
core/events.py         イベント検出 + 発生後1・3・5・10分の変化率を自動記入
core/store.py          SQLite（data/market.db）: ticks / bars / events / vwap_check
providers/base.py      抽象 DataProvider / Tick / Capabilities
providers/kabu.py      kabuステーションAPI（主実装）
providers/mock.py      ランダムウォーク（前場→昼休み→後場を再現）
providers/replay.py    記録済みティックの再生（1x/10x/60x）
providers/tachibana.py スタブ（NotImplementedError）
static/index.html      チャート画面（Vanilla JS + Lightweight Charts 4.2.3 固定）
static/stats.html      検証画面 /stats
```

```
Provider.stream → Tick検証・出来高差分 → Aggregator(1m,5m) ─┬→ 確定足をSQLiteへ
                                                          ├→ EventEngine → events表（+事後の変化率を自動記入）
                                                          └→ /ws（0.2秒ごとにまとめて配信。指標はサーバーで計算）
```
内部の時刻は UTC エポック秒、表示・設定は Asia/Tokyo です。

## 2. セットアップと起動

最短: Windows は `start.bat` をダブルクリック、Mac/Linux は `./start.sh`（初回は自動で環境構築）。詳細は `使い方.txt`。

```bash
cd daytrade_chart
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt                        # Python 3.11+
cp .env.example .env                                   # kabuを使う時だけ編集

python main.py                      # 既定は mock（http://127.0.0.1:8000 を開く）
python main.py --provider mock --speed 60
python main.py --provider replay --speed 10 --date 2026-10-01
python main.py --provider kabu      # .env に KABU_API_PASSWORD が必要
# または uvicorn main:app --port 8000（環境変数 PROVIDER / MOCK_SPEED / REPLAY_SPEED / REPLAY_DATE で切替）
```

- チャート: `http://127.0.0.1:8000/` / 検証画面: `/stats` / CSV: `/api/export/{events|ticks|bars|vwap_check}.csv`（`?source=&symbol=` で絞り込み）
- テスト: `python -m pytest -q`

## 3. `.env`（コードに直書きしない。`.env` と `data/` は `.gitignore` 済み）

| 変数 | 内容 |
|---|---|
| `KABU_API_PASSWORD` | kabuステーションで設定したAPIパスワード |
| `KABU_ENV` | `test`=検証用(ポート18081, **既定**) / `production`=本番(18080)。本番は明示した時だけ |
| `KABU_HOST` | 既定 `localhost` |
| `PROVIDER` `MOCK_SPEED` `REPLAY_SPEED` `REPLAY_DATE` `DB_PATH` | `config.yaml` の値を上書き（任意） |

ログ（`logs/app.log`、`logs/anomaly.log`、標準出力）にパスワード・トークンは出ません（登録した秘密値をマスクするフィルタ付き）。

## 4. 設定ファイル `config.yaml`

| キー | 説明 |
|---|---|
| `provider` | `mock` / `replay` / `kabu` / `tachibana` |
| `symbols` | `code`（英数字可。常に文字列扱い）と `name`。`mock_base_price` はモック用 |
| `sessions` | 前場・後場の開始/終了。**終了時刻は東証の最新公式情報で確認して変更可** |
| `calendar` | `use_jpholiday`、`year_end_closed`（12/31〜1/3）、`extra_holidays`（追加休場日）、`extra_open_days`（臨時営業日） |
| `time_buckets` | 検証画面の時間帯区分 |
| `indicators` | SMA/EMA/BBの既定、`bb_ddof`（0=母 / 1=標本）、`vwap_reset_afternoon`、`ma_cross_lunch`、`ma_carry_prev_day` |
| `split_guard` / `splits` | 分割・併合日（銘柄別）をまたぐ区間の指標計算を無効化（その日でリセット）。`false` で無効 |
| `tick` | 異常値判定（`max_price_deviation`）、配信VWAPとの比較間隔・警告閾値 |
| `events` | イベント用のEMA期間・BB設定、`min_sample`（標本が少ない閾値=30） |
| `mock` / `replay` / `kabu` | プロバイダ個別設定 |

## 5. 東証の前提と実装

- **取引時間**: 前場 9:00–11:30、後場 12:30–15:30（2024/11/5〜。JPXの発表で確認）。昼休みは足を作りません。区間は `[開始, 終了)`
  （11:30 ちょうど＝昼休み、12:30 ちょうど＝後場、15:30 ちょうど＝大引け後）。ただし **終了時刻ちょうどの約定**（大引けの板寄せ約定など）は
  その直前の足(15:29の足)に入れます。
- **寄付き・大引けのオークション**: 寄付き前は板（気配）の受付のみで約定がなく、9:00以降の約定が最初のティックです。大引けは 15:25–15:30 が
  約定を成立させない注文受付時間で、15:30 に板寄せ（クロージング・オークション）で終値が決まります。寄付き前・引け前に届く
  板更新は、現在値・売買高が変わらなければ足に影響しません（寄付き前のティックは足を作らず、累計出来高の基準だけ更新）。
  ※ kabuのPUSHが寄付き前・引け前に実際どんな値を配信するかは**未確認**です。
- **休場日**: 土日、祝日、年末年始（12/31〜1/3）。祝日は `jpholiday` を使いますが、**実測で 12/31・1/2・1/3 を含まない**ことを確認したため
  （1/1 は含む）、年末年始は自前ルール（`calendar.year_end_closed`）で補っています。臨時の休場・営業は `extra_holidays` / `extra_open_days` で上書きできます。
  ※ 東証の休業日を公式の休業日一覧と全年突き合わせる作業はしていません（`jpholiday` と年末年始ルールに依存）。
- **銘柄コード**: 英数字（285A, 200A, 6501）を文字列のまま扱います（数値変換・4桁前提の正規表現なし。テストあり）。
- **株式分割・併合**: 過去価格が不連続になります。**kabuには履歴APIがなく、本アプリが記録した足は未調整**なので、画面上部と本書に警告を出します
  （`warn_unadjusted_history`）。`splits` に分割日を入れると、その日をまたぐ区間のSMA/EMA/BBをリセットして計算しません（`split_guard`）。
  分割日の自動検知はしません。
- **PTS（夜間取引）は対象外**です。

## 6. 指標の仕様

- **VWAP** = 累積(典型価格×出来高) ÷ 累積出来高、典型価格 = (高値+安値+終値)/3。9:00（日の最初）でリセットし、昼休みを挟んで後場へ継続
  （`vwap_reset_afternoon: true` で後場開始でリセット）。出来高ゼロの間は欠損（ゼロ除算なし）。
  **精度の限界**: 足ベースのVWAPは約定ごとのVWAP（売買代金÷売買高）と一致しません（足内の約定の偏りが反映されない近似）。
  配信VWAPがあるプロバイダでは両者を `vwap_check` 表に記録し、乖離をログに出します（既定60秒ごと、0.5%超でWARNING）。
- **SMA/EMA**: 期間はUIから変更（既定 SMA20、EMA9・EMA21）。EMAは α=2/(n+1)、n本そろうまで表示しません。
  昼休みをまたぐ連続計算（`ma_cross_lunch`）と前日の足の引き継ぎ（`ma_carry_prev_day`）は設定で選択。
- **ボリンジャーバンド**: 期間20、±1σ・±2σ（UIで変更）。標準偏差は **母標準偏差(ddof=0)が既定**、`bb_ddof: 1` で標本標準偏差。
  使用中の方式は画面（BB欄の横）と `/stats` に表示されます。
- **前日終値比(%)** = (現在値/前日終値 − 1)×100、**VWAP乖離率(%)** = (現在値/VWAP − 1)×100。前日終値はPUSHの `PreviousClose`、なければ記録済みの前営業日の最終足から。
- 形成中の足は半透明、確定足は不透明。昼休み・時間外はチャートがグレー表示され、「チャート停止中」と出ます。
- 配色: 陽線=赤/陰線=青（既定）、陽線=赤/陰線=緑、海外式(陽=緑/陰=赤)を切替可。

## 7. 足は「近似値」です（重要）

kabuのPUSHは「値が更新される際に配信」されるスナップショットで、**全約定ではありません**。ティックの取りこぼしがあり得るため、
**自前で作った足（高値・安値・出来高の内訳）は受信したスナップショットから作った近似値**であり、証券会社のチャートとは完全には一致しません。
累計売買高から出来高を出しているので、取りこぼしがあっても出来高の合計は概ね保たれますが、足への割り当てはずれます。
接続が切れて欠けた区間は、履歴APIがないため補完できず、該当の足に **「欠」** の印を付けます。

ティックの扱い: 累計出来高の差分＝そのティックの出来高 / 差分が負（リセット・異常）なら出来高0で異常ログ・価格のみ更新 /
同一時刻・同一累計の重複は無視 / 価格0以下・時刻の逆行・値幅を大きく外れる値（`max_price_deviation`）は無視して `logs/anomaly.log` に記録 /
途中参加の最初のティックは出来高0（基準だけ設定）/ 日付が変わると累計の基準を0に戻す。

## 8. 記録と検証

SQLite `data/market.db` に、ティック（`ticks`）、確定足（`bars`）、イベント（`events`）、VWAP比較（`vwap_check`）を保存します。

| イベント | 判定 |
|---|---|
| `vwap_cross_up/down` | 価格(ティック)がVWAP（形成中の1分足を含む）を上抜け/下抜け |
| `ema_golden/dead` | EMA9とEMA21のクロス（**確定した1分足**の終値で判定） |
| `bb_lower_K / bb_upper_K` | **確定した1分足**の終値がBB −Kσを下回った/+Kσを上回った（内側→外側に出た最初の足） |

各イベントの **1・3・5・10分後** の価格変化率を自動で埋めます。「N分」は **取引時間内の経過分**（昼休みは数えない）。大引けを超える分・まだ経過していない分は空欄です。
`/stats` で種別・銘柄・時間帯・データ源ごとに、件数、各時点の平均変化率、プラス終了の割合を表示します。

- 変化率(%) = (N分後の価格 ÷ イベント時の価格 − 1) × 100。母数は「その時点の値が埋まった件数」。プラス終了＝変化率>0の割合。
- **スプレッド・手数料・約定のずれは含みません**。売買方向での符号反転もしていません。
- 母数が30件未満の区分は「標本が少ない」と表示します（`events.min_sample`）。同じ日・同じ銘柄のイベントは互いに独立ではないので、件数が多くても過信しないでください。
- VWAPの上下抜けは相場が往復すると頻発します（ノイズ除去の閾値は未実装）。

## 9. リプレイとモック

- **mock**: 仮想時計（既定）は日本時間 08:59:50 から `speed` 倍速で前場→昼休み→後場→大引け(11:30:00/15:30:00に締めの約定)を再現し、
  大引け後は次の営業日へ進んで繰り返します。市場が閉まっている時間でも開発できます。DBに記録済みの日の**次の営業日**から始めるので、
  過去の記録と混ざりません（そのため記録日付は未来日になり得ます）。`mock.clock: real` にすると実時間で取引時間内のみ配信します。
- **replay**: `ticks` 表の `replay.source`（既定 `mock`、kabuで記録したなら `kabu`）の指定日（既定は最新日）を `1x/10x/60x` で再生します。
  再生中のイベントは `source=replay` として記録され（同じ条件を過去データで再検証できます）、ティック・足は二重に書きません。
  モックや実運用で記録 → `python main.py --provider replay --speed 60` の順に使います。

## 10. kabuステーションAPI（`providers/kabu.py`）

使うのは `POST /token`・`PUT /register`・`PUT /unregister`・PUSH(WebSocket)だけです。

**公式仕様（`kabucom/kabusapi` の `kabu_STATION_API.yaml` v1.5 と PUSH配信ページ）で確認できた点**

- 検証用 `http://localhost:18081/kabusapi` / 本番 `:18080`。PUSH は `ws://localhost:{18081|18080}/kabusapi/websocket`。
- 認証: `POST /token` に `{"APIPassword": ...}` → `Token`。以降のRESTは `X-API-KEY` ヘッダ。トークンは「kabuステーション終了」「ログアウト」
  「別のトークンが新たに発行された時」に無効。早朝に強制ログアウトあり。401=認証エラー、403=APIキー不正等。
  → 本実装はトークンを使い回し（再発行すると他アプリのトークンが無効になるため）、登録時に401/403が返った時だけ再取得します。
- 銘柄登録 `PUT /register`（`Symbols:[{Symbol, Exchange}]`、東証=1）、解除 `PUT /unregister`。**登録上限は50銘柄**（REST登録分と合算）。
- PUSH項目（現在値 `CurrentPrice`、現在値時刻 `CurrentPriceTime`(ISO8601)、売買高 `TradingVolume`、売買代金 `TradingValue`、`VWAP`、`PreviousClose`、最良気配 等）。
  「値が更新される際に配信、昼休み・引け後は配信なし」。
- 動作環境: **Windows のみ**、kabuステーションの起動・ログインが前提、Professional/Premiumプランが必要（要件ページの記載）。
  本アプリもその Windows 上（または `KABU_HOST` で到達できる環境）で動かしてください。
- 履歴（ローソク足）APIはありません（歩み値APIはあるが未使用）。

**未確認（コードに `TODO(未確認)` あり）**

- WebSocket接続時に認証が要るか（公式ページに記載なし。付けずに接続する実装）。
- 売買高(`TradingVolume`)が日次リセットされる時刻。日付が変わった時に基準を0に戻す実装で対応。
- 英数字コード（285A等）を `Symbol` にそのまま指定できるか（仕様の例は数字のみ）。
- 売買高・売買代金の単位の明記（サンプル値から 株・円 と推定）。
- `CurrentPriceStatus` のどれを足に使ってよいか（現値/不連続歩み/板寄せ/終値/板寄せ約定を採用する推測）。
- PUSH接続中のトークン失効の検知方法、寄付き前・引け前のPUSH内容、Bid/Ask表記の向き（仕様に注記あり、本アプリは使っていない）。
- **実機接続テストは未実施**です（この開発環境にはkabuステーションがなく、検証用ポートに接続できませんでした）。
  フェイクサーバーで「自分が理解した仕様どおりに動くか」を確認した単体テストのみで、実際のkabuで動作を確認したわけではありません。
  最初は必ず `KABU_ENV=test` で試してください。

切断時は指数バックオフ（1秒〜60秒+ゆらぎ）で再接続し、復旧時に欠損区間を足に印として付けます。

## 11. kabu 以外のプロバイダを追加する手順

1. `providers/xxx.py` に `DataProvider` を継承したクラスを作る。`capabilities` に履歴取得の可否・登録上限・全約定が届くか等を宣言。
2. `async def stream(self, symbols)` を **async ジェネレータ**で実装し、`Tick(symbol, timestamp(UTC秒), price, cum_volume, cum_value=None, vendor_vwap=None[, prev_close])` を yield。
   `self.status`（`connecting/connected/reconnecting/disconnected`）を更新し、再接続後は `self.on_gap(開始ts, 終了ts)` を呼ぶ。
3. 履歴が取れるなら `fetch_history` を実装（`capabilities.history=True`、調整済みなら `history_adjusted=True`）。
4. `providers/__init__.py` の `create_provider` に名前を追加し、`config.yaml` の `provider:` で選ぶ。
5. `tests/` に、実サーバーなしで動くパーサ／フェイクサーバーのテストを追加。
   立花証券 e支店 API 用のスタブは `providers/tachibana.py`（`NotImplementedError`。仕様は未確認のため何も書いていません）。

## 12. 既知の制限

- 足はスナップショットから作った近似値（上記7）。kabuの実PUSHでの取りこぼし率は未測定。
- 株式分割・併合は自動検知せず、`splits` 設定が必要。履歴APIがないため過去の調整もできない。
- 休業日は `jpholiday` ＋年末年始ルール＋手動上書き。東証の臨時休場（システム障害等）は手動で `extra_holidays` に追加が必要。
- 値幅制限は価格帯で異なるため、異常値判定は緩い一律の乖離率(`max_price_deviation`)で近似している。
- 指標はサーバーで毎回、直近2500本から再計算（数百銘柄・多数クライアントには未最適化）。複数日の足はDBから前日分のみ復元。
- 検証の統計は単純集計のみ（有意性検定・コスト控除・日をまたぐ相関の補正なし）。
- 時刻はNTP等で合わせたPCのものを使い、`CurrentPriceTime`（取引所時刻）を足の基準にしている。
