"""共有フォルダ棚卸しツール（読み取り専用・オフライン）

使い方:
  python main.py                      （引数なし：フォルダ選択ダイアログで対象と出力先を選ぶ）
  python main.py --target <対象フォルダ> --output <出力フォルダ> [--config config.toml]
                 [--light] [--resume] [--keep-work]
  --target / --output の片方だけ省略すると、省略した方だけダイアログで選びます
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def build_parser() -> argparse.ArgumentParser:
    """コマンドライン引数の定義を作る"""
    p = argparse.ArgumentParser(description="共有フォルダの棚卸し（重複候補・命名逸脱・長期未更新）をExcelに出力します。対象フォルダは読み取りのみです。")
    p.add_argument("--target", help="棚卸し対象のフォルダ（UNCパス可）。省略するとダイアログで選択")
    p.add_argument("--output", help="Excelと一時ファイルの出力先フォルダ（対象の外）。省略するとダイアログで選択")
    p.add_argument("--config", default=str(HERE / "config.toml"), help="設定ファイル（既定: config.toml）")
    p.add_argument("--light", action="store_true", help="軽量モード：ハッシュを計算せず件数・サイズ・更新日だけ集計")
    p.add_argument("--resume", action="store_true", help="前回中断した実行を一時ファイルから再開")
    p.add_argument("--keep-work", action="store_true", help="終了後も一時SQLiteファイルを残す")
    return p


def main(argv=None) -> int:
    """エントリポイント。終了コード 0=成功、1=エラー、130=中断"""
    if sys.version_info < (3, 11):
        print("Python 3.11 以上が必要です（設定ファイルの読み込みに標準の tomllib を使うため）")
        return 1
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(errors="replace")
        except Exception:
            pass
    args = build_parser().parse_args(argv)
    from audit import dialog
    from audit.config import ConfigError, load_config
    from audit.runner import RunError, run_audit
    try:
        target, output = args.target, args.output
        if not target:
            target = dialog.choose_folder("棚卸し対象のフォルダを選択（読み取りのみ・変更しません）")
        if target and not output:
            output = dialog.choose_folder("結果の出力先フォルダを選択（対象フォルダの外）", initialdir=str(Path(target).parent))
        if not target or not output:
            print("フォルダが選択されなかったため、中止しました。")
            return 1
        print(f"対象: {target}\n出力先: {output}")
        cfg = load_config(args.config)
        res = run_audit(target, output, cfg, light=args.light,
                        resume=args.resume, keep_work=args.keep_work)
    except dialog.DialogUnavailable as e:
        print(f"エラー: ダイアログを開けません（{e}）。--target と --output を指定してください。")
        return 1
    except (ConfigError, RunError) as e:
        print(f"エラー: {e}")
        return 1
    except KeyboardInterrupt:
        print("\n中断しました。途中結果は出力フォルダの inventory_work.sqlite に保存済みです。--resume で再開できます。")
        return 130
    s = res.summary
    print(f"完了: {res.xlsx_path}")
    print(f"  総ファイル数 {s['total_files']:,} / 総容量 {s['total_bytes']:,} byte / "
          f"除外 {s['excluded_files']:,} / 読み取り不可 {s['unreadable']:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
