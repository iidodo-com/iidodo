"""build2.py → inject_values.py → (任意) make_xlsm.py で、統合ブックを作る。
使い方: python3 make2.py <管理簿.xlsx> <貸付予算差引簿.xls> <費用収益表.xls> <出力.xlsx>
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build2
import inject_values

if __name__ == '__main__':
    g, k, h, out = sys.argv[1:5]
    tmp = Path(tempfile.mkdtemp()) / 'stage.xlsx'
    meta = build2.main(g, k, h, str(tmp))
    n = inject_values.main(str(tmp), out)
    print(f'台帳 業務 {meta["n_gyomu"]} 行 / 貸付 {meta["n_kashi"]} 行、数式 {n} セルの計算結果を保存 → {out}')
