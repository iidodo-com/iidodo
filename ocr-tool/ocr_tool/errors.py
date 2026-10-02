"""ユーザー向けエラー。原因と対処をセットで持つ。"""


class OcrToolError(Exception):
    """原因(message)と対処(hint)が分かる日本語エラー。"""

    def __init__(self, message: str, hint: str = ""):
        super().__init__(message)
        self.message = message
        self.hint = hint

    def __str__(self) -> str:
        return f"{self.message}" + (f" 【対処】{self.hint}" if self.hint else "")


def explain_exception(exc: BaseException) -> tuple[str, str]:
    """想定外の例外を (原因, 対処) の日本語に変換する。"""
    if isinstance(exc, OcrToolError):
        return exc.message, exc.hint
    if isinstance(exc, MemoryError):
        return (
            "メモリ不足で処理できませんでした。",
            "config.yaml の pdf.render_dpi を下げる（例: 200）か、画像を縮小してください。",
        )
    if isinstance(exc, PermissionError):
        return (
            f"ファイルにアクセスできませんでした: {exc}",
            "他のアプリでファイルを開いていないか、フォルダの書き込み権限を確認してください。",
        )
    if isinstance(exc, FileNotFoundError):
        return (
            f"ファイルが見つかりません: {exc}",
            "パスの誤りや、処理中にファイルが移動・削除されていないか確認してください。",
        )
    if isinstance(exc, RuntimeError) and "timeout" in str(exc).lower():
        return (
            "Tesseractが制限時間内に終わりませんでした。",
            "config.yaml の ocr.timeout_sec を増やすか、pdf.render_dpi を下げてください。",
        )
    name = type(exc).__name__
    return (
        f"予期しないエラーが発生しました（{name}: {exc}）。",
        "同じファイルで繰り返す場合は、out/error.log の詳細（スタックトレース）を確認してください。",
    )
