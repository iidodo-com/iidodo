# 使用ソフトウェアのライセンス一覧

すべて無料のオープンソースです。有料API・有料ソフトは使っていません。
画像・文書データは外部へ送信されません（ネットワーク通信が発生するのは、最初のセットアップでソフト本体や言語データをダウンロードするときだけです）。

| 名称 | 用途 | バージョン（動作確認時） | ライセンス |
|---|---|---|---|
| Tesseract OCR | OCRエンジン本体 | 5.3.4（Linux） | Apache License 2.0 |
| tessdata_best / tessdata_fast（jpn, jpn_vert） | 日本語の学習済みデータ | Linux検証はaptパッケージ `tesseract-ocr-jpn` 4.1.0 | Apache License 2.0 |
| pytesseract | PythonからTesseractを呼ぶ | 0.3.13 | Apache License 2.0 |
| opencv-python-headless | 画像の前処理（OpenCV） | 5.0.0.93 | Apache License 2.0（ホイールには、FFmpeg等のLGPL部品が同梱されることがあります） |
| pypdfium2 | PDFを画像化（PDFiumのバインディング） | 5.13.0 | BSD-3-Clause または Apache-2.0（同梱のPDFiumも BSD-3-Clause / Apache-2.0） |
| pypdf | ページごとの検索可能PDFを1つに結合 | 6.19.0 | BSD-3-Clause |
| PyYAML | config.yaml の読み込み | 6.0.1 | MIT |
| NumPy | 画像配列の処理 | 2.4.6 | BSD-3-Clause（同梱部品に 0BSD / MIT / Zlib / CC0 など） |
| Pillow | 画像の読み込み（日本語パス対応・EXIF向き） | 12.3.0 | MIT-CMU（HPND系の寛容なライセンス） |
| pytest | テスト用（実行には不要） | 9.1.1 | MIT |

## 補足
- **PyMuPDF は使っていません。** PyMuPDF は AGPL-3.0 で、配布・サービス提供の際に制約が出るため、BSD/Apache系の pypdfium2 + pypdf にしました。
- Windows用のTesseractインストーラ（UB Mannheim版）は、Tesseract本体（Apache-2.0）のビルドに、Leptonica（BSD-2-Clause）などの依存ライブラリを同梱したものです。同梱物の詳細は、インストール先の `doc` フォルダやインストーラの配布ページで確認してください（未確認）。
- ライセンス表記はPyPI/パッケージ配布元のメタデータに基づきます。再配布する場合は、各プロジェクトの公式のライセンス文を必ず確認してください。
