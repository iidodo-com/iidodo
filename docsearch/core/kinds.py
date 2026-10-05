"""issues テーブルに記録する「種別」の名前を一か所にまとめる。"""

KIND_LEGACY = "対象外(旧形式)"
KIND_SIZE = "対象外(サイズ)"
KIND_LINK = "対象外(リンク)"
KIND_SCAN = "走査エラー"
KIND_PASSWORD = "パスワード付き"
KIND_AES = "読込不可（AES暗号化）"
KIND_CORRUPT = "破損"
KIND_ERROR = "読込エラー"
KIND_NOTEXT = "テキスト抽出不可"
KIND_FORMULA = "数式キャッシュなし"
KIND_CELLCAP = "セル上限"

# 一覧の表示順
KIND_ORDER = [
    KIND_LEGACY, KIND_SIZE, KIND_LINK, KIND_SCAN, KIND_PASSWORD, KIND_AES,
    KIND_CORRUPT, KIND_ERROR, KIND_NOTEXT, KIND_FORMULA, KIND_CELLCAP,
]

# 取り込みの状態（files.status）
STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_EXCLUDED = "excluded"
