# PDF Studio — 何でもPDF化・結合・編集

Word / Excel / PowerPoint / PDF / 画像 / テキスト / HTML を **PDFにして、1つに結合し、編集** できるローカルツールです。
画面(ブラウザ)とコマンドの両方で使えます。通信は一切せず、画面は自分のPC(127.0.0.1)だけで動きます。

## 準備
```
pip install -r requirements.txt
```
Word/Excel/PowerPoint/HTML のPDF化には **LibreOffice**(無料, https://www.libreoffice.org/ )が必要です。
PDF・画像・テキストだけなら不要。ページのプレビューには poppler(`pdftoppm`) または `pip install pypdfium2` が必要です。

## 画面で使う
```
python app.py          # Windowsは run.bat をダブルクリック
```
- **① 変換・結合**: ファイルを複数ドロップ → ↑↓/ドラッグで順番を決め → 「1つのPDFに結合」(元のファイル名がしおりになります)。「1つずつPDFに変換」もできます。
- **② PDFを編集**: ページ一覧で選択して 回転/削除/並べ替え/複製/空白挿入/抽出、透かし、ページ番号、
  **プレビュー上に直接書き込み(✎文字: 既存の文字をクリックで書き換え、空白をクリックでその場に入力、Enterで確定)**、ドラッグで白塗り・黒塗り、文字の一括置換、分割(ZIP)、プロパティ、パスワード付与/解除、容量削減。
  何度でも「元に戻す/やり直し」できます。

## コマンドで使う
```
python app.py convert a.docx b.xlsx                 # それぞれ a.pdf, b.pdf
python app.py merge -o all.pdf a.docx b.xlsx c.pptx d.pdf
python app.py edit in.pdf out.pdf rotate pages=1-2 angle=90
python app.py edit in.pdf out.pdf watermark text=社外秘
python app.py edit in.pdf out.pdf replace_text find=旧 replace=新
python app.py edit in.pdf out.pdf encrypt new_password=secret
python app.py split in.pdf outdir "1-3;4-"
```
編集の種類: `rotate delete arrange insert_blank watermark page_numbers add_text rect replace_text metadata compress flatten encrypt decrypt`
ページ指定は `1-3,5,8-` / `odd` / `even` / `all`。

## 高速化のしくみ
- **描画**: ページの画像化は常駐の高速エンジン(pdfium)で行い、開いた文書も使い回します。画像はJPEG(PNGより数倍速く小さい)。
- **編集後の再描画なし**: 編集しなかったページはサムネイル・プレビュー・文字情報をそのまま再利用します(ブラウザにも覚えさせます)。回転・文字追加なら変わった1ページ分だけ作り直し、並べ替え・削除・複製は作り直しゼロです。
- **Office変換**: ファイルを入れた時点で裏でPDF化を開始。複数ファイルは並列。LibreOffice は設定をユーザーフォルダ(`~/.pdfstudio/lo`)に残して使い回し、起動時に下準備も済ませるので、2回目以降の起動は初回変換も速くなります。
- **多ページ編集**: 透かし・ページ番号などは全ページ分を1回でまとめて作成。英数字だけの文字は日本語フォントを読み込まずに処理します。
- **通信**: 接続の使い回し(keep-alive)と即時送信でWindowsでの待ちを削減。
- 画面下の**ステータスバー**に、実行中の処理と進み具合(アップロード/変換 n/m 完了)、経過時間、完了後の所要時間、開いているPDFのページ数と履歴、サーバー接続状態を表示します。ファイル一覧には「変換中…/準備完了/変換エラー」が出ます。

## 仕様上の注意
- **直接編集**は、元の文字の範囲を周囲の色で塗り、同じ位置・大きさ・色で新しい文字を重ねます(日本語は端末の日本語フォントで書き直すため、字体は元と変わります)。元の文字データはPDF内部に残るため、完全に消したい場合は「画像化して確定」を使ってください。画像のみのPDF(スキャン)は文字を拾えません。
- **既存文字の置換**は、元の文字を白で隠して上書きします。白背景・文字データのPDF向け。スキャン画像のPDFの文字は検索できません(OCRは `../ocr-tool` 参照)。
- **白塗り/黒塗り**は見た目だけ隠します。文字データを完全に消すには「画像化して確定」(`flatten`)を使ってください(その後は文字選択・検索ができなくなります)。
- Excelは用紙幅を超える表が複数ページに分かれます。見た目を揃えたい場合はExcel側で印刷範囲/拡大縮小を設定してからお使いください。
- パスワード付きPDFは、編集時にパスワードを求めます。パスワードを知らないPDFは開けません。
- 日本語の文字入れには OS の日本語フォント(游ゴシック/メイリオ/Noto CJK/IPA など)を使い、無ければ内蔵CIDフォントに切り替えます。

## テスト
```
pip install python-docx openpyxl python-pptx
python tests/test_core.py
```
