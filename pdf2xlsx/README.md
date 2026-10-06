# pdf2xlsx — 支出一覧PDF → Excel 転記ツール（第1段階）

同じ様式のPDF（表形式の明細）を読み取り、転記先Excelの「転記先」シートに追記します。
検証が1つでも外れたら**出力ファイルを作らず**終了コード1で止まります。ネットワーク通信は一切しません。
サンプルは全て架空データです。

## 準備・実行

```
pip install pdfplumber openpyxl
python pdf2xlsx.py samples/sample_input.pdf samples/sample_template.xlsx out.xlsx
```

- 入力PDF・テンプレートは読み取りのみ（出力先が入力と同じ場合は拒否）。
- 転記先に既存データがあればA列最終行の次から追記。J4にPDFの合計を入れ、照合欄の数式はそのまま。
- 画面には件数・合計・検証結果のみ表示（明細の中身は出さない）。
- 終了コード: 0=成功 / 1=検証NG / 2=想定外エラー・引数不正

## 検証（全6項目）

1 ページ小計 / 2 総合計 / 3 件数 / 4 伝票番号の重複 / 5 見出し行 / 6 列数・型（日付・金額・コード）

## テスト

```
pip install reportlab      # テスト用（壊したPDFの生成に使用。本体には不要）
python test_pdf2xlsx.py
```

期待出力 `samples/expected_output.xlsx` と A1:G41 の全セル（値・型・書式）を比較し、J2/J3/J6 の値確認、
行削除・金額改変・伝票番号重複・見出し変更・日付不正のPDFで正しく止まることを確認します。

## 設定（config.json）

見出し文字列、列のx座標境界（`column_x_boundaries`）、小計/件数/合計行の正規表現（`patterns`）、
元号換算、転記先シート名・列対応・書式・照合欄セルを設定。実物の様式に合わせるときはここを直します。

## 実行ファイル（Windows exe）の作り方

- 手元で作る: Python 3 を入れた Windows で `build_exe.bat` をダブルクリック → `dist\pdf2xlsx\pdf2xlsx.exe`
- GitHub で作る: Actions の「build-pdf2xlsx-exe」を実行（pdf2xlsx/ を push しても自動実行）→ Artifacts の `pdf2xlsx-windows`
- フォルダごと配布する。`config.json` は exe と同じ場所に置く（設定変更はこのファイルを編集するだけ）。
- 使い方(簡単): `pdf2xlsx.exe` をダブルクリック → 入力PDF・テンプレート・保存先を順に選ぶ → 結果がダイアログで表示される
- 使い方(コマンド): `pdf2xlsx.exe 入力.pdf テンプレート.xlsx 出力.xlsx`
