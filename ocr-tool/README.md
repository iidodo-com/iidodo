# 日本語OCRツール（無料・完全ローカル）

スキャンした紙の文書（PDF / JPG / PNG など）から日本語の文字を読み取り、**テキスト**と**検索可能PDF**にします。
Tesseract + OpenCV を使い、有料API・有料ソフトは使いません。**画像や文書は外部に送信されません。**

- 一括処理：フォルダ内の画像・PDFをまとめて処理（PDFは1ページずつ）
- 前処理：グレースケール化・傾き補正・ノイズ除去・照明ムラ補正・二値化（個別にON/OFF）
- 出力：ページ別txt、全ページ結合txt、検索可能PDF
- 信頼度：行ごと（任意で単語ごと）の信頼度を取得し、低い箇所を `review.csv` に一覧化
- 失敗してもやめない：失敗は `error.log` に記録して次のファイルへ
- 縦書き（`jpn_vert`）対応：`config.yaml` で切り替え

## フォルダ構成

```
ocr-tool/
├─ setup.bat / run.bat / run_vertical.bat / compare.bat   ダブルクリック用
├─ reconcile.bat / reconcile.py   帳票突合（項目別読み取り＋突合元CSVと照合）
├─ templates/              帳票テンプレート（広島市の請求書・領収証書）と突合元CSVの見本
├─ main.py                 実行入口
├─ compare.py              前処理あり/なしの精度比較
├─ config.yaml             設定（言語・入出力・前処理ON/OFFなど）
├─ requirements.txt
├─ LICENSES.md             ライセンス一覧
├─ ocr_tool/               本体（config / loader / preprocess / engine / review / pipeline ...）
├─ tools/make_synthetic_samples.py   合成サンプル画像の生成
├─ samples/                動作確認用の画像を置く場所
├─ tests/                  テスト
├─ in/  out/               既定の入力・出力フォルダ
```

## かんたん手順（バッチファイル・PowerShell不要）

> Windows上での動作は未確認です（作成環境がLinuxのため）。うまくいかない場合は、下の「セットアップ」の手動手順を試してください。

1. **Tesseract をインストール**（下の「3. Tesseract本体」。日本語と縦書きにチェック）。標準的な場所（`%LOCALAPPDATA%\Tesseract-OCR` など）なら、`config.yaml` の編集は不要で自動検出されます。
2. **`setup.bat` をダブルクリック**（初回だけ。仮想環境の作成とライブラリのインストール、Tesseractの確認をします）。
3. 読み取りたい画像・PDFを **`in` フォルダに入れる**。
4. **`run.bat` をダブルクリック** → 結果は `out` フォルダに出ます。

| ファイル | 役割 |
|---|---|
| `setup.bat` | 初回セットアップ |
| `run.bat` | 横書きを読み取り（`in` → `out`）。**フォルダを `run.bat` にドラッグ＆ドロップ**すると、そのフォルダの中身を読み取り、`そのフォルダ\out_ocr` に出力 |
| `run_vertical.bat` | 縦書き用（`in` → `out_vertical`） |
| `compare.bat` | `samples` フォルダで前処理あり/なしの精度比較 |
| `reconcile.bat` | 帳票突合（下の「帳票突合」参照） |

---

## セットアップ（Windows 11 / Python 3.11以上 / 管理者権限なしを想定）

> この手順のうち **Windows上での操作は、この環境（Linux）では動作未確認** です。Linuxでは同等の構成で動作を確認しています。

### 1. Python

Python 3.11以上が入っていなければ、python.org のインストーラで **「Install Just for Me（自分のみ）」** を選ぶと、管理者権限なしで入ります
（「Add python.exe to PATH」にチェック）。

### 2. このツールのライブラリ

PowerShell で `ocr-tool` フォルダに移動して実行します。

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt   # テストもするなら requirements-dev.txt
```

`Activate.ps1` が「スクリプトの実行が無効」と言われたら、`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` を実行するか、
代わりに `.venv\Scripts\activate.bat`（コマンドプロンプト）を使ってください。

### 3. Tesseract本体（日本語データ込み）

1. [UB Mannheim版 Tesseract インストーラ](https://github.com/UB-Mannheim/tesseract/wiki) から、64bit版の `tesseract-ocr-w64-setup-*.exe` をダウンロードします。
2. 実行して、**「Install for me only（自分のみ）」** を選びます。インストール先は `C:\Users\<あなた>\AppData\Local\Tesseract-OCR` のような**書き込み権限のある場所**にします
   （`C:\Program Files` は管理者権限が必要）。管理者権限を求められる場合は、上記のように場所を変えてください。
3. 「Additional language data（追加の言語データ）」で **Japanese** と **Japanese (vertical)** にチェックします（インストーラが自動でダウンロードします）。
4. PATHの設定は不要です。`config.yaml` の `ocr.tesseract_cmd` に、インストール先の `tesseract.exe` のフルパスを書きます。

   ```yaml
   ocr:
     tesseract_cmd: C:/Users/あなた/AppData/Local/Tesseract-OCR/tesseract.exe
   ```

#### 日本語データを手動で入れる場合（精度を上げたいとき）

インストーラ付属の日本語データより、**`tessdata_best`**（高精度・やや低速）のほうが精度が高いことがあります。

1. https://github.com/tesseract-ocr/tessdata_best から `jpn.traineddata`（縦書きを使うなら `jpn_vert.traineddata` も）をダウンロードします。
2. Tesseractのインストール先の `tessdata` フォルダに置きます（同名ファイルは上書き）。
   管理者権限がなくて置けない場合は、書き込み可能な適当なフォルダ（例 `C:\Users\あなた\tessdata`）に置き、`config.yaml` の `ocr.tessdata_dir` にそのフォルダを指定します。
3. 速度重視なら https://github.com/tesseract-ocr/tessdata_fast の同名ファイルでも構いません。

> 注意：`jpn.traineddata` は **tessdata_best（Apache-2.0）** の公式配布物を使ってください。

### 4. 動作確認

```powershell
python -c "import pytesseract; print(pytesseract.get_languages())"   # jpn, jpn_vert が出ればOK
```
（`tesseract_cmd` を使っている場合は、`python main.py` を実行したときの最初のチェックで確認されます。足りないものがあれば日本語で対処法が表示されます。）

## 使い方

```powershell
# 基本（in フォルダの画像・PDFを読み取り、out に出力）
python main.py --input ./in --output ./out

# 縦書き
python main.py --input ./in --output ./out --lang jpn_vert

# 前処理なしで実行
python main.py --input ./in --output ./out --no-preprocess

# 信頼度のしきい値を変える / 単語単位の低信頼度も出す / 検索可能PDFを作らない
python main.py --input ./in --output ./out --threshold 85 --word-level --no-pdf
```

コマンドライン引数は `config.yaml` の値より優先されます。サブフォルダも処理するときは `--recursive`。

### 出力

```
out/
├─ review.csv                      人が確認すべき箇所の一覧（UTF-8 BOM付き。Excelで開けます）
├─ error.log                       失敗の記録（原因・対処・スタックトレース）
└─ <ファイル名>_<拡張子>/          例: notice_pdf/, scan_png/
   ├─ page_001.txt, page_002.txt   ページごとのテキスト
   ├─ all.txt                      全ページ結合テキスト
   └─ searchable.pdf               検索可能PDF（元の画像＋透明テキスト）
```

`review.csv` の列：ファイル / ページ / 行番号 / 種別（行・単語・ページ）/ 文字列 / 信頼度 / 行内最小信頼度 / 理由 / x / y / 幅 / 高さ（ページ画像上の位置）。
文字が全く検出されなかったページも「文字が検出されませんでした」として載ります。

終了コード：全て成功=0、失敗あり=1、設定やTesseractの問題=2。

### 前処理あり・なしの比較

```powershell
python compare.py --input ./samples            # 前処理の組み合わせ9通りを比較
python compare.py --input ./samples --quick    # 「なし」と「設定どおり」だけ比較
python compare.py --input ./samples --lang jpn_vert   # 縦書きサンプルを比べるとき
```

- 画像 `foo.png` と同じ場所に正解テキスト `foo.gt.txt` を置くと、**文字誤り率（CER、小さいほど良い）** を計算します。
  空白・改行は無視して比べます。
- 正解がないファイルは、平均信頼度・認識文字数・要確認行数だけが出ます。**信頼度は高くても誤りがあり得る**ため、正解率の代わりにはなりません（下記「既知の限界」）。
- 結果は `out_compare/compare.csv` に保存されます。

### 合成サンプルの作り方

```powershell
python tools/make_synthetic_samples.py          # samples/synthetic/ に画像と正解テキストを作る
```
日本語フォントが見つからない場合は `--font C:/Windows/Fonts/meiryo.ttc` のように指定します。

### テスト

```powershell
python -m pytest -q tests
```

## 帳票突合（請求書など、様式が決まった書類）

ページ全体を読む方式（`run.bat`）だと、枠線や表の罫線が文字に混ざり、請求書のような帳票では精度が出ません。
帳票には **「項目の位置が決まっている」** ので、`reconcile.py` は項目ごとに範囲を切り出して読み、**突合元CSVと照合**します。

### 使い方（かんたん）

1. `in` フォルダに帳票（PDF・画像）を入れる。
2. 突合元のデータを **`reference.csv`** という名前で `ocr-tool` フォルダに置く（なければ読み取りだけ行います）。
   列の見出しは `templates\reference_sample.csv` を参考に、帳票に合わせます（Excelで「CSV UTF-8」または「CSV」で保存）。
3. **`reconcile.bat` をダブルクリック** → `out_form\report.html` が開きます。

```powershell
python reconcile.py --template templates/hiroshima_invoice.yaml --input ./in --reference ./reference.csv --output ./out_form
```

### 出力と判定

| ファイル | 内容 |
|---|---|
| `out_form\report.html` | **確認用レポート**。判定ごとに色分けし、要確認の項目は元の書類から切り出した画像を並べて表示（1ファイル完結・外部通信なし） |
| `out_form\match_result.csv` | 項目ごとの 読取値／突合元の値／判定／理由／信頼度 |
| `out_form\form_results.csv` | 書類ごとの読み取り結果一覧 |

| 判定 | 意味 |
|---|---|
| 一致 | 突合元と一致 |
| 不一致 | 突合元と違う（誤読か、書類の誤記かは画像で確認） |
| 要確認 | 読み取りが不安定、または似ているが違う（1文字の誤読の疑いなど） |
| 要目視 | **手書き欄**。Tesseractは手書きを信頼して読めないため、必ず目視（読み取り値が突合元と合うかは参考表示） |
| 読取OK | 突合元がない（`reference.csv` なし）ときに、読み取れて問題が見つからなかった項目。突合は未実施 |
| 未読取 | 読み取れなかった |

書類単位の判定は、項目のうち一番重いものになります。突合元の行は、キー項目（広島市様式では伝票番号）で探します。
キーが1〜2文字違うだけの行があれば候補として使い、「要確認」にします。

主な仕組み：
- **外枠の位置を基準**に項目の範囲を決めるため、スキャンの位置ずれ・拡大縮小に追従します（傾きも補正）。
- 同じ項目を **複数の読み方**（画像の加工違い、切り出し余白違い、数字は日本語+英語モデル）で読み、多数決＋突合元との一致で判定します。Tesseractは同じ画像でもわずかな違いで `レ→シ` のように読みが変わるためです。
- **整合性チェック**：`請求金額 = 差引額 + 源泉所得税額` が成り立つかを、突合元がなくても確認します。
- 金額（`¥` `\` `円` `,` の揺れ）、和暦の日付、全角/半角・半角カナは正規化して比べます。

### 精度を上げたいとき（おすすめ）：2つ目の言語データ

アプリ付属の日本語データは精度が低めのことがあります。**`tessdata_best`**（高精度）を追加し、**両方で読んで比べる**と安定します（処理時間は約2倍）。

1. `ocr-tool` の中に `tessdata_best` フォルダを作る。
2. 次の3ファイルをブラウザでダウンロードして、そのフォルダに入れる:
   - https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/jpn.traineddata （約14MB）
   - https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/jpn_vert.traineddata （縦書きを使うとき）
   - https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/eng.traineddata
3. `config.yaml` を開き、`second_tessdata_dir:` の行の **`null` の部分だけ** を `./tessdata_best` に書き換える（項目名は変えない）。

   ```yaml
   # 変更前
     second_tessdata_dir: null
   # 変更後
     second_tessdata_dir: ./tessdata_best
   ```

   行頭の半角スペース2つ（インデント）は残してください。`./tessdata_best:` のように項目名を書き換えると、
   「config.yaml に未知の項目があります」というエラーになります。
4. ダウンロードしたファイルの大きさを確認する: `jpn.traineddata` は約14MB。数百バイトなら、ダウンロードに失敗しています（取り直してください）。

### 別の様式（帳票）に対応するには

様式ごとに「テンプレート」(`templates\*.yaml`) を1つ作ります。`templates\hiroshima_invoice.yaml` が見本です。

1. 項目ごとに `id`、`label`、`type`（`text` / `digits` / `amount` / `date`）、`box`（[左, 上, 右, 下]。**外枠の幅を1000とした相対座標**）を書く。
   手書き欄は `handwritten: true`、形式のチェックは `pattern:`（正規表現）。
2. `python tools/show_zones.py --template templates/新様式.yaml --image サンプル.pdf --output zones.png` で、項目の範囲を画像に重ねて確認し、`box` を調整する（緑=印刷、赤=手書き）。
3. `match:` に、突合元CSVの列との対応（`column`）と比べ方（`rule`）を書く。

> 外枠（罫線の大きな四角）が検出できない書式は、このテンプレート方式に向きません。

### この方式の精度（広島市「請求書・領収証書」1枚での実測）

**実際の請求書1枚（18項目）だけでの結果です。枚数が少ないので、傾向として見てください。**
個人情報が含まれるため、この書類自体はリポジトリに含めていません（動作確認は手元のコピーで実施）。

| 方式 | 結果 |
|---|---|
| 従来（ページ全体を読む） | 金額が `\11.000 貴` のように崩れ、銀行名「三井信友銀行」、支店「更町壇店」、預金種別「交通預金」、氏名「テディーガイア」など、印刷16項目のうち6項目が誤読 |
| 項目別（既定。付属の日本語データ） | 印刷16項目のうち **14項目が突合元と一致**、2項目が「要確認」（件名の1文字誤読、半角カナの口座名義人）。誤った「不一致」は0 |
| 項目別＋`tessdata_best`を2つ目に指定 | 印刷16項目のうち **15項目が一致**、1項目が「要確認」（半角カナの口座名義人） |
| 突合元に誤りを4項目仕込んだテスト（金額2項目・銀行名・口座番号） | **4項目すべてを「不一致」または「要確認」で検出**（見逃し0） |

手書き（令和 年 月 日、件名の「8月分」）は、桁ごとに分けて読んでも `8→3`、`25→195` のように誤読したため、自動判定せず「要目視」にしています。

### 帳票突合の既知の限界

1. **手書きは読めません。**「要目視」にして切り出し画像を出すだけです。手書きの自動読み取りが必要なら、手書き対応の別のOCR（日本語手書きに強い無料モデル等）を追加する必要があります（未検証・未実装）。
2. **半角カナの口座名義人**（ドット文字風の小さい字）は読めません（上の実測）。口座番号など他の項目で突合してください。
3. **1枚の帳票でしか検証していません。** 別の様式・別のスキャナ品質では、`box` の調整や設定の見直しが必要になる可能性があります。
4. 外枠の線が途切れた・薄い書類、枠が2つ以上に分かれた書式では、外枠の検出に失敗することがあります（失敗は `error.log` に記録されます）。
5. 「一致」は、読み取りが突合元と一致したという意味です。突合元の側が間違っていれば、同じ誤りは検出できません。金額・口座番号などの重要項目は、最終的に人の確認を前提にしてください。
6. 処理時間は1枚あたり約7秒（付属データのみ。この環境での実測。2つ目のモデルを使うと約17秒）。

---

## 設定（config.yaml）の要点

| 項目 | 意味 |
|---|---|
| `input_dir` / `output_dir` / `recursive` | 入出力フォルダ、サブフォルダも対象にするか |
| `ocr.language` | `jpn`（横書き）/ `jpn_vert`（縦書き）/ `jpn+eng` |
| `ocr.psm` | `auto`（横書き=3、縦書き=5）。縦書きは **5** が大幅に良好でした（下記） |
| `ocr.tesseract_cmd` / `ocr.tessdata_dir` | PATHを通せない場合のTesseractの場所、日本語データのフォルダ |
| `preprocess.enabled` | `false` で前処理を全部省略 |
| `preprocess.grayscale / deskew / denoise / flatten / binarize` | 各ステップのON/OFFと方式 |
| `review.threshold` / `review.word_level` | 要確認とする信頼度、単語単位の出力 |
| `output.searchable_pdf` など | 出力の種類 |

YAMLでは `off` / `no` が false に化けますが、`denoise: off` のように書いても「なし」として扱います。

## 精度の検証結果（合成画像での検証）

**実際の文書ではなく、フォントで描いた文字に劣化を加えた合成画像での結果です。実画像での検証は、サンプルが置かれるまで「未確認」です。**
環境：Linux、Tesseract 5.3.4、aptの `tesseract-ocr-jpn`（4.1.0）。`tessdata_best` での測定は未確認です。
A4・300dpi相当。数値は文字誤り率（CER、小さいほど良い）。「前処理あり」は既定の `config.yaml`（グレースケール＋傾き補正＋nlmeansノイズ除去＋照明ムラ補正）。

| サンプル | 内容 | 前処理なし | 前処理あり |
|---|---|---|---|
| notice_clean.png | きれいな通知文 | 0.069 | 0.069 |
| notice_scan.jpg | 傾き2.5°・影・ノイズ | 1.000（0文字） | 0.058 |
| notice_poor.jpg | 強いノイズ・ぼけ・影 | 0.984 | 0.074 |
| notice_lowres.png | 100dpi相当・傾き4° | 0.365 | 0.116 |
| form_table.png | 罫線のある表 | 0.055 | 0.055 |
| notice_2pages.pdf | 2ページのスキャンPDF | 0.761 | 0.061 |
| vertical.png（`jpn_vert`, psm 5） | 縦書き | 0.014 | 0.014 |

- **効いたのは「照明ムラ補正」と「傾き補正」**です。影があるだけでTesseractが文字をほとんど読めなくなるケースが、補正で読めました。
- **二値化(otsu)は、低解像度と表で悪化**したため既定OFFにしています（Tesseract自身が内部で二値化します）。
- **medianノイズ除去は縦書きで悪化**（0.014→0.159）。細い線を傷めるため、既定は **nlmeans**にしています。
- 縦書きで psm を 3 にすると CER が 0.29 まで悪化したため、`jpn_vert` のときは `auto` で psm 5 になります。

## 既知の限界（上の合成サンプルでの実測に基づく）

1. **信頼度は過信されがちで、要確認リストだけでは誤りを拾いきれません。**
   前処理ありで読んだ上記5枚（横書き）では、誤りを含む行が17行ありました。しきい値70では**1行も検出できず**、80でも0行、90で7行（約4割。要確認は13行）でした。
   数字の「〇」「―」の読み違い（例: `〇四―一二三五` → `〇四一一ニニ五一`）は高い信頼度のまま出ます。
   重要な数字（金額・番号・日付）は、信頼度に関わらず目視で確認してください。しきい値は `review.threshold` で上げられます（まず85〜90を試す価値があります）。
2. **手書きは対象外に近いです。** Tesseractは印刷文字向けで、手書きの精度は大きく落ちます。
   ※ 手書きの実サンプルでは**未検証**です（合成できないため）。手書きメモを含む文書では、印刷部分のみ期待してください。
3. **表組み**：罫線のある表は読めましたが（CER 0.055）、読み取り順が崩れることがあり、セルの対応関係は保持されません。
4. **低解像度**：100dpi相当では前処理ありでも CER 0.116（300dpiの0.069より悪い）。スキャンは **300dpi以上**を推奨します。
5. **検索可能PDFの文字間に空白が入ります**：Tesseractが出す透明テキストは単語（日本語では句や文節）単位で空白が入るため、PDFビューアで連続した日本語を検索すると見つからない場合があります
   （`pypdf` で抽出して確認。実際のPDFビューアの検索は未確認）。`all.txt` / `page_*.txt` では不要な空白を取り除いています。
6. **傾き補正は±15°まで**。それ以上の傾きや上下逆の向きは補正しません。
7. **横書きと縦書きが混在**するページは、言語を切り替えて2回実行する必要があります（自動判定なし）。
8. **文字単位の信頼度は未対応**です。Tesseractの標準出力は単語単位で、日本語では1単語が数文字になります。
9. 速度：A4・300dpiで1ページあたり約1〜6秒（ノイズ除去 nlmeans を含む。この環境での実測）。

## トラブルシュート

| 表示 | 対処 |
|---|---|
| `Tesseract本体が見つかりません` | 上の手順3のとおり導入し、`ocr.tesseract_cmd` にフルパスを書く |
| `言語データが見つかりません: jpn.traineddata` | `tessdata` フォルダに置く。または `ocr.tessdata_dir` を指定 |
| `PDFを開けませんでした` | 壊れている／パスワード付き。別のビューアで開けるか確認 |
| 文字がほとんど出ない | `error.log` と `review.csv` を確認。`--no-preprocess` と比べる、`pdf.render_dpi` を上げる、縦書きなら `--lang jpn_vert` |
| 日本語のファイル名・パスで失敗する | 通常は問題ありません。それでも失敗する場合は `error.log` の内容を確認 |
