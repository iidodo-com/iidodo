# dev/（作業用スクリプト）

利用者に配る成果物ではなく、**式ライブラリを作り直すための作業用**です（Python 3 の標準ライブラリのみ）。

| ファイル | 内容 |
| --- | --- |
| `build_expr.py` | `expressions/*.md`、`expressions/VERIFY.md`、`expressions/README.md` を生成します。**式・ケース・注意書きを直すときは、このファイルを直してから再生成**してください。期待値は Python の別計算で、実機の結果ではありません。 |
| `mk_results.py` | `expressions/VERIFIED_RESULTS.md` を生成します。 |
| `result_raw.txt` | 実機（2026-10-07、Power Automate 英語表示）の Compose 出力の生データです（`mk_results.py` の入力）。 |

```text
python3 dev/build_expr.py      # expressions/ を再生成
python3 dev/mk_results.py      # VERIFIED_RESULTS.md を再生成
```

再生成して `git diff` が空なら、ファイルと生成スクリプトが一致しています。

## 注意
- `docs/manual_*.html`（HTML マニュアル）は、生成後に手で図などを足したため、**HTML ファイル自体が正**です。生成スクリプトは置いていません。
- 式を直したときは、`tests/run_tests.ps1 -UpdateGolden` で期待出力を更新し、**差分を目視で確認**してください。式を変えたら、実機（Compose）で検証し直してください。
