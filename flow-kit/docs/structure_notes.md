# アクション構造の規則メモ（第1版）

- 作成日: 2026-10-08
- 根拠: `flow-kit/samples/` にある、「コードのプレビュー（Code view）」から取り出したサンプルJSON **だけ**
- 状態: **承認待ち**（承認をいただくまで、工程2〜4〔build_guide / explain_flow / check_flow〕には進みません）
- 読んだサンプル: 7ファイル（下の「1. サンプル一覧」）
- 凡例: **［確認済み］** = サンプルにその書き方がある。**［要確認（サンプルなし）］** = サンプルにないので、推測で書かない。

---

## 1. サンプル一覧

| ファイル | 種類 | 取り出した箱（画面の表示名・英語） | 主な内容 |
| --- | --- | --- | --- |
| `triggers/request__manual__basic.json` | トリガー | Manually trigger a flow | 手動トリガーの既定の形 |
| `actions/variables__initialize_variable__basic.json` | アクション | Initialize variable | 変数の初期化 |
| `actions/control__scope__run_after_failed.json` | アクション（スコープ） | Scope（中に Send an email (V2)） | 実行条件を `TimedOut`・`Failed` にしたスコープ |
| `actions/excel__list_rows_in_table__pagination_off.json` | アクション | List rows present in a table | Excel 一覧取得（ページネーションなし） |
| `actions/excel__list_rows_in_table__pagination_on.json` | アクション | 同上 | ページネーションあり（しきい値5000） |
| `actions/control__apply_to_each__concurrency_off.json` | アクション（ループ） | Apply to each（中に Compose） | コンカレンシーなし |
| `actions/control__apply_to_each__concurrency_on.json` | アクション（ループ） | 同上 | コンカレンシーあり（並列度4） |

- 取得したのは、いずれも **箱1つ分の JSON**（フロー全体ではない）です。**フロー全体の構造（`triggers`・`actions` の入れ物、接続の一覧など）は［要確認（サンプルなし）］**です。
- JSON のキー名（`type` など）は、サンプルに書かれていたものです。画面の表示名（Scope など）は、画面で見えた名前を [`_manifest.csv`](../samples/_manifest.csv) に記録しています。**日本語表示名はまだ取得できていません**（［要確認］）。

---

## 2. 箱（アクション）に共通する形

箱のJSONは、次の形で書かれます。

```json
{
  "type": "…",            ← 箱の種類
  "inputs": { … },        ← 設定値（種類により形が変わる）
  "runAfter": { … },      ← 前の箱との関係（無いことがある）
  "runtimeConfiguration": { … },   ← 並列実行・ページネーションなどの設定（無いことがある）
  "metadata": { … }       ← 補助情報（Excel の例にあった）
}
```

| キー | 内容 | 根拠 |
| --- | --- | --- |
| `type` | 箱の種類。**確認済みの種類**：`Request`（トリガー）、`InitializeVariable`、`Scope`、`OpenApiConnection`、`Foreach`、`Compose` | 全サンプル |
| `inputs` | 設定値。`type` ごとに形が異なる（第3章） | 全サンプル |
| `runAfter` | 前の箱との関係（第4章） | scope／foreach／initialize の各サンプル |
| `runtimeConfiguration` | **既定と違う設定をしたときだけ**追加される（第5章） | excel（pagination_on）／foreach（concurrency_on） |
| `metadata` | Excel の一覧取得にあった。ファイルIDとパスの対応、`tableId` | excel の2サンプル |

- **箱の名前はJSONの外側（キー）に付きます。** 取り出した箱1つ分のJSONには、その箱自身の名前は含まれません。スコープ・ループの**中の箱の名前**は、`actions` の中のキーとして出ます。**確認済み**
- **箱の名前の空白は `_` に変わります。** 例：「Send an email (V2)」→ `Send_an_email_(V2)`、「List rows present in a table」→ `List_rows_present_in_a_table`（括弧は残る）。**確認済み**
- **式の中で箱を参照するときも、同じ（`_` の）名前を使います。** 例：`outputs('List_rows_present_in_a_table')`。**確認済み**

---

## 3. 箱の種類ごとの `inputs` の形

### 3-1. トリガー：手動（`type: Request`）　［確認済み］
- `"type": "Request"`、`"kind": "Button"`
- `inputs.schema`：JSON スキーマ（`type: object`、`properties`、`required`）。既定では `location`（住所・座標）と `key-button-date`（日付）の項目が入っている。
- `runAfter` は**ない**（トリガーなので）。
- **トリガー条件（Trigger conditions）の書き方は［要確認（サンプルなし）］**。

### 3-2. 変数の初期化（`type: InitializeVariable`）　［確認済み］
```json
"inputs": { "variables": [ { "name": "counter", "type": "integer", "value": 0 } ] }
```
- 変数の種類は小文字で `integer`。**ほかの種類（文字列・配列など）の `type` の書き方は［要確認（サンプルなし）］**。
- **変数の設定・インクリメント・追加の箱の `type` 名は［要確認（サンプルなし）］**（推測で書きません）。

### 3-3. スコープ（`type: Scope`）　［確認済み］
- `"actions": { "<箱の名前>": { … } }`：中の箱をまとめて持つ。
- 中の箱の並び順は、`actions` の中の順番ではなく、**各箱の `runAfter` で決まります**（スコープの中の最初の箱は `runAfter` が**ない**）。

### 3-4. コネクタの箱（`type: OpenApiConnection`）　［確認済み］
```json
"inputs": {
  "parameters": { … },
  "host": {
    "apiId": "/providers/Microsoft.PowerApps/apis/shared_<コネクタ名>",
    "connection": "shared_<コネクタ名>",
    "operationId": "<操作の内部名>"
  }
}
```

| 項目 | Excel（一覧取得） | Outlook（メール送信） |
| --- | --- | --- |
| `host.apiId` の末尾 | `shared_excelonlinebusiness` | `shared_office365` |
| `host.connection` | `shared_excelonlinebusiness` | `shared_office365` |
| `host.operationId` | **`GetItems`**（画面の名前は List rows present in a table） | **`SendEmailV2`**（画面の名前は Send an email (V2)） |
| `parameters` のキー | `source` `drive` `file` `table` `extractSensitivityLabel` `fetchSensitivityLabelMetadata` | **`emailMessage/To`** `emailMessage/Subject` `emailMessage/Body` `emailMessage/Importance`（キーに `/` を含む） |

- 画面で設定していない項目（Excel の詳細項目 Filter Query など）は、**キーごと書かれません**。詳細項目を設定したときのJSONのキー名は［要確認（サンプルなし）］。
- Outlook の本文（`emailMessage/Body`）は **HTML の文字列**で保存されます（`<p class="editor-paragraph">…</p>`）。**確認済み**
- 真偽値は `true` / `false`（画面の Yes は `true`）。**確認済み**
- **SharePoint・Teams・OneDrive・承認・Forms の箱は、サンプルがないため［要確認（サンプルなし）］**。
- コネクタの箱の「接続名」は、サンプルでは **`"connection": "shared_…"`** という文字列でした（接続の一覧〔`connectionReferences`〕との関係は、フロー全体のサンプルがないため［要確認（サンプルなし）］）。

### 3-5. Apply to each（`type: Foreach`）　［確認済み］
```json
{
  "type": "Foreach",
  "foreach": "@outputs('List_rows_present_in_a_table')?['body/value']",
  "actions": { … },
  "runAfter": { … }
}
```
- 繰り返す対象は `"foreach"` に、**`@` から始まる式**で書かれる。
- 繰り返しの中の箱は `actions` に入る。

### 3-6. 作成（Compose）（`type: Compose`）　［確認済み］
```json
"test": { "type": "Compose", "inputs": "test" }
```
- `inputs` が、そのまま値（文字列）になる。

---

## 4. `runAfter`（前の箱との関係）の規則

```json
"runAfter": { "<前の箱の名前>": [ "<状態>", … ] }
```

| 確認できた書き方 | 意味 | 根拠 |
| --- | --- | --- |
| `{ "List_rows_present_in_a_table": ["Succeeded"] }` | 前の箱が成功したら動く（既定） | foreach |
| `{ "Try": ["TimedOut", "Failed"] }` | Try が**タイムアウト or 失敗**したときだけ動く（画面で「Has timed out」「Has failed」にチェック） | scope |
| `{}`（空のオブジェクト） | トリガーの直後の箱（前の箱が「トリガー」） | initialize_variable |
| キー自体がない | スコープ・ループの**中の最初の箱** | scope 内の Send_an_email、excel（Try の中の最初の箱） |

- 状態の名前（確認済み）：**`Succeeded`、`Failed`、`TimedOut`**
- **`Skipped`（画面の Is skipped）の JSON での書き方は［要確認（サンプルなし）］**です。`"Skipped"` と書く想定ですが、サンプルで確認していないため、断定しません。
- 複数の箱を `runAfter` に並べたときの意味（すべて満たす必要があるか）は、**サンプルがないため［要確認（サンプルなし）］**です。このメモでは、1つの箱だけを並べた書き方（上の表）だけを扱います。
- **エラー処理の見分け方（check_flow で使う）**：`Scope` で、`runAfter` の状態に `Failed` または `TimedOut` を含むものがあれば「失敗時の処理あり」と判定できる。**確認済みの根拠**は `control__scope__run_after_failed.json`。

---

## 5. `runtimeConfiguration`（実行時の設定）

| 設定 | 画面での操作 | JSON での書き方 | 根拠 |
| --- | --- | --- | --- |
| ページネーション（Excel 一覧取得） | Settings の **Pagination** をオン、しきい値 5000 | `"runtimeConfiguration": { "paginationPolicy": { "minimumItemCount": 5000 } }` | excel（pagination_on） |
| 並列実行（Apply to each） | Settings の **Concurrency control** をオン、並列度 4 | `"runtimeConfiguration": { "concurrency": { "repetitions": 4 } }` | foreach（concurrency_on） |

- **オフ（既定）のときは、`runtimeConfiguration` ごとありません。** 両方のサンプルで、オフとオンの JSON の違いは `runtimeConfiguration` だけでした。
- **check_flow への使い方（確認済みの根拠から）**
  - 「ページネーション未設定」：Excel の `operationId: GetItems` の箱に `runtimeConfiguration.paginationPolicy` がない。
  - 「並列実行」：`Foreach` に `runtimeConfiguration.concurrency.repetitions` があり、2 以上。
- ページネーションを**オフにした**とき既定で何件で打ち切られるかは、サンプルにありません（［要確認（サンプルなし）］）。

---

## 6. 式（`@` で始まる文字列）の書き方

- 確認できたのは、`Foreach` の `"foreach": "@outputs('List_rows_present_in_a_table')?['body/value']"` だけです。
  - 式は**文字列の先頭に `@`** を付けて書く。
  - 前の箱の結果は `outputs('<箱の名前>')?['body/value']` の形で参照できる（`?['body/value']` は、スラッシュ入りの1つのキー）。
- **文字列の途中に式を埋め込む書き方（`@{…}`）や、`parameters` の中で式を使う書き方は［要確認（サンプルなし）］**。
- `utcNow()` や `convertTimeZone` を使った箱のサンプルはありません。check_flow で「UTC のまま使っている」を検出するときは、**JSON 全体から式の文字列を探す**方式にします（箱の種類に依存しない）。

---

## 7. 各ツールが使える情報・使えない情報

| ツール | 判定・出力に使える（確認済み） | まだ使えない（サンプルなし） |
| --- | --- | --- |
| **build_guide** | 手動トリガー、変数の初期化、スコープ、Excel 一覧取得、Apply to each、Compose、Outlook メール送信、実行条件（失敗時）、ページネーション、並列実行 | **SharePoint・Teams・OneDrive・承認・Forms の箱**、条件（Condition）、スイッチ、Do until、変数の設定・インクリメント、定期実行トリガー、トリガー条件 |
| **explain_flow** | 上の箱の読み取り（種類・参照・実行条件）。入力は「箱1つ分」のJSONまたはスコープ・ループを含む部分 | **フロー全体の定義（`definition.json`）の構造**（`triggers`・`actions`・`connectionReferences` の位置） |
| **check_flow** | ①失敗時の処理の有無（Scope＋`Failed`/`TimedOut`）　②Excel 一覧取得のページネーション未設定　③並列実行の検出　④式の文字列中の `utcNow()` 検出　⑤`parameters` の値の固定メールアドレス・URL・パス検出 | ⑥トリガー条件の有無（**書き方のサンプルなし**）　⑦「ループ内の変数更新」（**変数の設定・インクリメントの `type` 名のサンプルなし**） |

---

## 8. まだ必要なサンプル（優先順）

| 優先 | サンプル | 必要な理由 |
| --- | --- | --- |
| ◎ | **フロー全体の定義**（取り出せる方法が分かった時点で） | explain_flow の入力形式、check_flow が全体を走査する根拠 |
| ◎ | 変数の**設定**／**インクリメント**（ループの中） | check_flow ⑦（並列実行と変数更新の組み合わせ） |
| ◎ | **トリガー条件を設定したトリガー** | check_flow ⑥ |
| ◎ | 定期的に実行（日本時間のタイムゾーン設定） | build_guide のトリガー説明 |
| ○ | SharePoint／Teams／承認／Forms／OneDrive の箱 | build_guide・explain_flow の対象コネクタ |
| ○ | 条件（Condition）、`Skipped` を含む `runAfter` | build_guide・explain_flow |
| ○ | Excel の詳細項目（Filter Query、DateTime Format 等）を設定した版 | 詳細項目の JSON キー名 |
| ○ | 日本語表示でのコネクタ・箱の名前（日英併記用） | build_guide の「日英表示名の併記」 |

---

## 9. 承認をお願いしたい点

1. **この規則メモの内容（第2〜6章）で、サンプルの読み取り方に間違いがないか。**
2. **サンプルにない書き方は、推測で書かず「要確認（サンプルなし）」と明記する**運用でよいか（第7章の「まだ使えない」ものは、各ツールの出力にそのように表示します）。
3. **次に進める範囲**：現在のサンプルで作れる範囲（第7章の「使える」もの）で、工程2（build_guide）を先に作り始めてよいか、それともサンプルをもう少しそろえてからにするか。
