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
pip install -r requirements.txt
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
