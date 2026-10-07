# サンプル収集チェックリスト

このキットは、**「コードのプレビュー」からコピーしたアクションのJSONだけ** をアクション構造の根拠にします。
サンプルにない書き方は推測で書かず、「要確認（サンプルなし）」と明記します。
そのため、下の一覧のサンプルを `flow-kit/samples/` に置いてください。**全部そろわなくても構いません**（不足分は README の「サンプル追加が必要なアクション一覧」に載せて、後から追加できます）。

## 0. 先に決めておくこと

- Power Automate の **表示言語を記録** してください（日本語表示／英語表示）。JSON には操作名の表示名が入らず、`operationId` などの内部名だけが入ります。構築手順書の「英語表示名と日本語表示名の併記」には、**画面で確認した名前** が必要です（→ 第4章の `_manifest.csv`）。
- 可能なら、画面の言語を切り替えて同じアクションの英語名・日本語名の両方を控えてください。

## 1. 必要なアクションの一覧

優先度：◎ = 最初にほしい、○ = あると良い。ファイル名の付け方は第3章を参照してください。
「バリエーション」の列は、**同じアクションでも設定で JSON が変わる** ため、わかる範囲で別ファイルにしてほしい種類です。

### 1-1. トリガー

| 優先 | 種類 | バリエーション | 保存先 |
| --- | --- | --- | --- |
| ◎ | 手動でトリガーするフロー | 入力なし／テキスト入力あり | `triggers/` |
| ◎ | 定期的に実行（繰り返し） | 毎日／毎週の曜日指定／**タイムゾーンを日本時間に設定したもの** | `triggers/` |
| ◎ | Forms：新しい応答が送信されるとき | － | `triggers/` |
| ◎ | SharePoint：項目が作成されたとき／項目が作成または変更されたとき | － | `triggers/` |
| ◎ | Outlook：新しいメールが届いたとき | 件名フィルター・フォルダー指定あり | `triggers/` |
| ○ | SharePoint：ファイルが作成されたとき | － | `triggers/` |
| ◎ | **トリガー条件（Trigger conditions）を設定したトリガー** | 任意のトリガーに条件式を1つ設定 | `triggers/` |

### 1-2. 取得・書き込み（コネクタのアクション）

| 優先 | コネクタ | アクション（役割） | バリエーション |
| --- | --- | --- | --- |
| ◎ | Outlook | メールを送信する | 本文が HTML／宛先・件名・本文が動的な値／重要度指定 |
| ◎ | Outlook | 返信・転送、メールの取得 | あれば |
| ◎ | Teams | チャットまたはチャネルでメッセージを投稿する | チャネル宛／ユーザーとのチャット宛（Flow bot） |
| ◎ | SharePoint | 項目の取得（複数） | **フィルタークエリあり**／**上位の件数・ページネーション設定あり・なし** |
| ◎ | SharePoint | 項目の作成／項目の更新 | 列の種類が違うもの（文字列・選択肢・日付・ユーザー） |
| ○ | SharePoint | ファイルの取得／ファイルの作成／ファイル コンテンツの取得 | － |
| ◎ | OneDrive for Business | ファイルの作成／ファイル コンテンツの取得 | － |
| ◎ | Excel Online (Business) | **表内に存在する行を一覧表示** | **ページネーション設定あり・なし**／フィルタークエリ・並べ替えあり／日付/時刻の形式を指定したもの |
| ◎ | Excel Online (Business) | 表に行を追加／行の更新 | － |
| ◎ | 承認（Approvals） | 承認を作成する／承認の作成と待機 | 種類（承認/拒否 の基本）／複数人承認 |
| ◎ | 承認（Approvals） | 承認の待機（作成と待機に分けた構成の場合） | あれば |
| ◎ | Forms | 応答の詳細を取得する | － |

### 1-3. 制御・データ操作（組み込み）

| 優先 | 種類 | バリエーション |
| --- | --- | --- |
| ◎ | 作成（Compose） | 式を入れたもの／固定値 |
| ◎ | 変数の初期化／変数の設定／変数をインクリメント／文字列変数に追加／配列変数に追加 | それぞれ1つずつ |
| ◎ | Apply to each（それぞれに適用） | **コンカレンシー制御なし（既定）／コンカレンシー制御あり（並列度の指定）** |
| ◎ | 条件（Condition） | AND/OR を使うもの／式で書いたもの |
| ◎ | スイッチ（Switch） | あれば |
| ◎ | **スコープ（Scope）** | 中にアクションを入れたもの |
| ◎ | **実行条件の構成（Configure run after）を変更したアクション** | 「失敗した」「スキップされた」「タイムアウトした」にチェックしたもの。**スコープの失敗時にだけ動く通知アクション**。これが最重要 |
| ○ | Do until（繰り返し） | あれば |
| ○ | 配列のフィルター処理／選択／JSON の解析／HTML テーブルの作成 | あれば |
| ○ | 終了（Terminate） | 失敗で終了／成功で終了 |
| ○ | 遅延（Delay）／指定時刻まで遅延 | あれば |

### 1-4. フロー全体（できれば）

| 優先 | 内容 |
| --- | --- |
| ◎ | **実際に動いている簡単なフロー1本の全体**（トリガーから最後のアクションまで、エラー処理を含むもの）。第2章の方法でフロー全体の定義を取り出して、`samples/flows/` に置く |
| ○ | 承認フローなど、承認アクションが入ったフロー全体 |
| ○ | Excel の一覧取得 → Apply to each → SharePoint 更新、のような典型フロー |

## 2. 「コードのプレビュー」からJSONを取り出す手順

> メニューの位置や名称は画面の更新で変わることがあります。見つからないときは、見つけた手順をメモして知らせてください（README に反映します）。

### 2-1. 1つのアクションのJSON（基本）

1. Power Automate でフローを開き、**編集** を選びます。
2. JSON を取り出したいアクションのカード右上の **「…」（その他のオプション）** をクリックします。
3. **「コードのプレビュー」** を選びます。
4. 表示された JSON を **すべて選択してコピー** し、メモ帳などに貼り付けます。
5. 第5章の伏字にする項目を置き換えます。
6. 第3章のファイル名で **UTF-8** で保存します。
7. `samples/actions/`（トリガーは `samples/triggers/`）に置きます。

### 2-2. 実行条件の構成・コンカレンシー・トリガー条件のサンプルを取るとき

- 「実行条件の構成」は、アクションの「…」→ 設定（実行条件の構成）で、前のアクションの結果（成功／失敗／スキップ／タイムアウト）にチェックを付けたあとに、2-1 の手順でコードのプレビューを取ります。**`runAfter` の中身が変わります。**
- Apply to each の並列実行は、「…」→「設定」でコンカレンシー制御をオンにして並列度を指定したあと、2-1 の手順で取ります（設定は `runtimeConfiguration` に出る想定です。実際の書き方はサンプルで確認します）。
- ページネーション・トリガー条件も、同様に「設定」で変更したあとに取ります。

### 2-3. フロー全体の定義

次のいずれか、取れる方法で取り出してください（どれで取れたかも記録してください）。

- 方法A：フロー全体の JSON が見られる画面があれば、その内容をコピーする。
- 方法B：フローの **エクスポート（パッケージ）** で zip を作り、中の `definition.json` を取り出す。
- 方法C：ソリューションに入れてエクスポートした場合は、展開したフォルダー内のワークフロー定義の JSON。

いずれも、サンプルに載せる前に **第5章の伏字** をしてください。取り出し方が分からない場合は、フロー全体は後回しにして、アクション単位のサンプルを先にそろえてください。

## 3. 保存時のファイル名の付け方

### 3-1. 置き場所

```text
flow-kit/samples/
  connectors.txt            使えるコネクタの一覧（第6章のひな形）
  _manifest.csv             サンプルの管理表（第4章）
  actions/                  アクションのJSON
  triggers/                 トリガーのJSON
  flows/                    フロー全体のJSON（definition.json）
```

### 3-2. 命名規則

`コネクタ略称__アクション内容__バリエーション.json`（すべて **半角英数字と `_`、区切りは `__`（アンダースコア2つ）**。日本語は使わない）

| 要素 | 書き方 | 例 |
| --- | --- | --- |
| コネクタ略称 | `outlook` `teams` `sharepoint` `onedrive` `excel` `forms` `approvals` `control`（条件・ループ・スコープ）`data`（作成・フィルター等）`variables` `schedule` `request` | `outlook` |
| アクション内容 | 英語の短い名前（スネークケース） | `send_email` |
| バリエーション | 設定の違い。基本形は `basic` | `basic` `pagination_on` `pagination_off` `concurrency_on` |

例：

```text
actions/outlook__send_email__basic.json
actions/outlook__send_email__html_body.json
actions/teams__post_message__channel.json
actions/sharepoint__get_items__filter_query.json
actions/excel__list_rows_in_table__pagination_off.json
actions/excel__list_rows_in_table__pagination_on.json
actions/approvals__create_and_wait__basic.json
actions/control__apply_to_each__concurrency_off.json
actions/control__apply_to_each__concurrency_on.json
actions/control__scope__basic.json
actions/outlook__send_email__run_after_failed.json     ← 実行条件を「失敗した」にしたもの
actions/data__compose__expression.json
triggers/schedule__recurrence__tokyo_tz.json
triggers/forms__new_response__basic.json
triggers/sharepoint__item_created__trigger_condition.json
flows/sample_flow_01__definition.json
```

- **1ファイル = 1アクション** が原則です。スコープは、中身のアクションを含む形で1ファイルにします。
- JSON は **画面からコピーしたまま** にしてください。整形・並べ替え・キー名の変更・コメントの追加はしないでください（値の伏字だけ可）。
- 保存形式は **UTF-8**（BOM なしでも付きでも可）。

## 4. 管理表 `samples/_manifest.csv`

JSON には画面上の表示名が入らないため、**ファイルごとに1行** 記録してください。ひな形は `samples/_manifest.template.csv` です（コピーして `_manifest.csv` にする）。

| 列 | 内容 | 例 |
| --- | --- | --- |
| file | ファイル名 | `outlook__send_email__basic.json` |
| connector_ja | コネクタ名（日本語表示） | `Office 365 Outlook` |
| connector_en | コネクタ名（英語表示） | `Office 365 Outlook` |
| action_ja | アクション名（日本語表示） | `メールの送信 (V2)` |
| action_en | アクション名（英語表示） | `Send an email (V2)` |
| ui_language | 取得時の画面言語 | `ja` |
| variant_note | 設定の違い（どの設定を変えたか） | `本文をHTMLにした` |
| captured_on | 取得日 | `2026-10-07` |
| masked | 伏字済みか（yes/no） | `yes` |
| memo | 気づいたこと | `「設定」で並列度を 4 にした` |

※ 上の例の表示名は **書き方の例** です。実際の名前は画面で確認したものを書いてください。

## 5. 伏字にすべき項目

**値だけを置き換え、キー名と形式は残します。** 形式を残さないと、構造の根拠として使えなくなります（GUID は GUID の形、URL は URL の形のまま置き換える）。

| 項目 | 見つけ方 | 置き換え後の例 |
| --- | --- | --- |
| メールアドレス | `@` を含む文字列（宛先・差出人・承認者） | `user@example.com` |
| 氏名・部署名・課名 | 本文・件名・承認の詳細・タイトル | `担当者名` `○○課` |
| SharePoint のサイトURL | `https://…sharepoint.com/sites/…` / `dataset` に入る値 | `https://contoso.sharepoint.com/sites/SITE` |
| SharePoint のリストID・ライブラリID・リスト名 | `table` に入る GUID／名前 | `00000000-0000-0000-0000-000000000000` / `LIST_NAME` |
| 接続名・接続参照（connection） | `connectionName`、`connectionReferenceName`、`shared_…` のあとにつく英数字 | コネクタの種類部分（例：`shared_sharepointonline`）は **残し**、後ろの GUID／識別子部分だけを `CONNECTION_ID` にする |
| ファイルパス・フォルダーパス | `/Shared Documents/…`、`/個人フォルダ/…` | `/FOLDER/PATH/file.xlsx` |
| ドライブID・ファイルID（OneDrive/Excel） | `b!…` で始まる長い文字列、`01…` で始まるID | `b!DRIVE_ID` / `FILE_ID` |
| Teams のチームID・チャネルID | `19:…@thread.tacv2`、GUID | `19:CHANNEL_ID@thread.tacv2` / `00000000-0000-0000-0000-000000000000` |
| Forms のフォームID | 長い英数字文字列 | `FORM_ID` |
| テナントID・ユーザーのオブジェクトID | GUID | `00000000-0000-0000-0000-000000000000` |
| 内部URL・ドメイン名・サーバー名・電話番号 | `.lg.jp` `.go.jp` などを含む文字列、庁内の名前 | `https://example.com/` |
| 本文・メッセージに書いた個人情報・事件名・案件番号 | 本文のテキスト | `本文（例）` |

置き換えてはいけないもの：

- `type`、`inputs`、`host`、`parameters`、`runAfter`、`operationId`、`runtimeConfiguration` などの **キー名と構造**
- アクション名（フローの中で付けた名前）— ただし個人名・案件名が入っているときは `Action_01` のように置き換え、**その名前を参照している式の中も同じ名前に置き換える**
- 式（`@{…}`、`@outputs(…)`）の関数名と書き方

### 伏字漏れの簡易チェック（Windows PowerShell 5.1）

`flow-kit` フォルダーで実行します。メール・サイトURL・GUIDらしき文字列が残っていないか、行を表示します（GUID が全部ゼロのものは置き換え済みです）。

```powershell
Get-ChildItem .\samples -Recurse -Filter *.json | Select-String -Encoding UTF8 -Pattern '@[A-Za-z0-9.-]+\.[a-z]{2,}|sharepoint\.com|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | Select-Object Filename, LineNumber, Line
```

※ このチェックは目安です。氏名・案件名などは検出できないため、目視でも確認してください。

## 6. `connectors.txt` のひな形

`samples/connectors.template.txt` をコピーして `samples/connectors.txt` にし、**記入してください**。ツール（build_guide / check_flow）は、ここに書かれたコネクタ以外は使えないものとして扱います。

書式：`#` で始まる行はコメント。1行に1コネクタ、`|` 区切りで次の4項目。

```text
# コネクタ名（画面の表記） | 英語名 | 区分 | 備考
# 区分は Standard / Premium / 組み込み のいずれか。分からなければ 不明 と書く。
# 使えないコネクタ（Premium など）は、この一覧に書かない。

Office 365 Outlook | Office 365 Outlook | （記入） |
Microsoft Teams | Microsoft Teams | （記入） |
SharePoint | SharePoint | （記入） |
OneDrive for Business | OneDrive for Business | （記入） |
Excel Online (Business) | Excel Online (Business) | （記入） |
Microsoft Forms | Microsoft Forms | （記入） |
承認 | Approvals | （記入） |
```

※ 区分の欄は **あえて空欄（記入）** にしてあります。区分は画面（コネクタの一覧の表示）で確認した内容を書いてください。コントロール（条件・ループ・スコープ）、データ操作（作成・フィルター等）、変数、スケジュールなどの組み込みの動作も、使うなら行を追加してください。

## 7. 提出前の最終チェック

- [ ] 1ファイル = 1アクション／トリガー（フロー全体は `flows/`）になっている
- [ ] 画面からコピーしたまま（整形・並べ替えをしていない）
- [ ] 第5章の伏字を済ませた（簡易チェックを実行した）
- [ ] ファイル名が第3章の規則（半角英数字と `_`）になっている
- [ ] `_manifest.csv` に全ファイルを記録した（表示名の英語・日本語を含む）
- [ ] `connectors.txt` を記入した
- [ ] 最優先（◎）のうち、**スコープ＋実行条件の構成（失敗時）**、**Excel の一覧取得（ページネーションあり・なし）**、**Apply to each（コンカレンシーあり・なし）**、**Outlook メール送信** が入っている
- [ ] 追加したら Git に反映した（コミット＆ push）
