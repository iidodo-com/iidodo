"""Tesseract呼び出し（pytesseract）。テキスト・行/単語ごとの信頼度・検索可能PDFを得る。"""
from __future__ import annotations

import contextlib
import os
import re
import shutil
from pathlib import Path
from dataclasses import dataclass, field

import cv2
import numpy as np
import pytesseract
from PIL import Image
from pytesseract import Output

from .config import is_vertical
from .errors import OcrToolError

# 日本語（かな・漢字・全角記号・全角英数）。この間の空白は誤認識由来なので除く
_CJK = "　-〿぀-ヿ㐀-䶿一-鿿＀-￯"
_CJK_GAP = re.compile(rf"(?<=[{_CJK}])[ \t]+(?=[{_CJK}])")


@dataclass
class Word:
    text: str
    conf: float
    box: tuple[int, int, int, int]  # x, y, 幅, 高さ


@dataclass
class Line:
    line_no: int
    text: str
    conf: float        # 文字数で重み付けした単語信頼度の平均 (0-100)
    min_conf: float    # 行内の最小の単語信頼度
    box: tuple[int, int, int, int]
    words: list[Word] = field(default_factory=list)
    new_paragraph: bool = False


@dataclass
class PageOCR:
    lines: list[Line]

    @property
    def text(self) -> str:
        """行を連結したページ全文。段落が変わる箇所に空行を入れる。"""
        parts: list[str] = []
        for i, ln in enumerate(self.lines):
            if i and ln.new_paragraph:
                parts.append("")
            parts.append(ln.text)
        return "\n".join(parts)

    @property
    def mean_conf(self) -> float | None:
        """ページ平均信頼度（文字数重み）。文字が無ければ None。"""
        total = sum(len(ln.text) for ln in self.lines)
        if not total:
            return None
        return sum(ln.conf * len(ln.text) for ln in self.lines) / total


def clean_cjk_spaces(text: str) -> str:
    """日本語文字どうしの間に入った不要な空白を除く（英単語間の空白は残す）。"""
    return _CJK_GAP.sub("", text)


def find_tesseract_windows() -> str | None:
    """PATHに無いとき、管理者権限なしで入れた場合の既定の場所などからtesseract.exeを探す。"""
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Tesseract-OCR" / "tesseract.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe",
        Path(os.environ.get("USERPROFILE", "")) / "Tesseract-OCR" / "tesseract.exe",
        Path(os.environ.get("ProgramFiles", "")) / "Tesseract-OCR" / "tesseract.exe",
        Path(os.environ.get("ProgramFiles(x86)", "")) / "Tesseract-OCR" / "tesseract.exe",
    ]
    return next((str(c) for c in candidates if c.name and c.is_file()), None)


def setup_tesseract(cfg: dict) -> str:
    """Tesseractの場所・言語データを設定し、使えるか検査する。バージョン文字列を返す。"""
    ocr = cfg["ocr"]
    if ocr["tesseract_cmd"]:
        pytesseract.pytesseract.tesseract_cmd = str(ocr["tesseract_cmd"])
    elif os.name == "nt" and shutil.which("tesseract") is None:
        found = find_tesseract_windows()  # 見つかればconfigに書かなくても使える
        if found:
            pytesseract.pytesseract.tesseract_cmd = found
    if ocr["tessdata_dir"]:
        os.environ["TESSDATA_PREFIX"] = str(ocr["tessdata_dir"])
    try:
        version = str(pytesseract.get_tesseract_version())
    except pytesseract.TesseractNotFoundError as e:
        raise OcrToolError(
            "Tesseract本体が見つかりません。",
            "README.md の手順でTesseractを導入し、PATHに通すか、config.yaml の ocr.tesseract_cmd に "
            "tesseract.exe のフルパスを書いてください。",
        ) from e
    try:
        available = set(pytesseract.get_languages(config=""))
    except Exception as e:  # noqa: BLE001
        raise OcrToolError(
            f"Tesseractの言語一覧を取得できませんでした（{e}）。",
            "ocr.tessdata_dir のフォルダが正しいか確認してください。",
        ) from e
    missing = [l for l in ocr["language"].split("+") if l not in available]
    if missing:
        raise OcrToolError(
            f"言語データが見つかりません: {', '.join(missing)}.traineddata",
            "README.md の手順で jpn.traineddata（縦書きは jpn_vert.traineddata も）を tessdata フォルダに置いてください。"
            f"（現在認識できる言語: {', '.join(sorted(available)) or 'なし'}）",
        )
    second = ocr.get("second_tessdata_dir")
    if second:
        missing2 = [l for l in ocr["language"].split("+") if not (Path(second) / f"{l}.traineddata").is_file()]
        if not Path(second).is_dir() or missing2:
            raise OcrToolError(
                f"2つ目の言語データが見つかりません: {second}（{', '.join(missing2) or 'フォルダ'}）",
                "config.yaml の ocr.second_tessdata_dir のフォルダが存在し、中に jpn.traineddata（と eng.traineddata）が"
                "入っているか確認してください。使わないなら null に戻してください。")
    return version


_LANGS_CACHE: set[str] | None = None


def available_languages() -> set[str]:
    """インストール済みのTesseract言語データ（結果はキャッシュ）。"""
    global _LANGS_CACHE
    if _LANGS_CACHE is None:
        try:
            _LANGS_CACHE = set(pytesseract.get_languages(config=""))
        except Exception:  # noqa: BLE001
            _LANGS_CACHE = set()
    return _LANGS_CACHE


def _resolve_psm(cfg: dict) -> int:
    psm = cfg["ocr"]["psm"]
    if psm == "auto":
        return 5 if is_vertical(cfg) else 3
    return int(psm)


def _to_pil(img: np.ndarray) -> Image.Image:
    """OpenCV(BGR)画像をPillow(RGB)へ。"""
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    return Image.fromarray(img)


def _tess_config(cfg: dict, dpi: int) -> str:
    return f"--psm {_resolve_psm(cfg)} --dpi {int(dpi)}"


def recognize(img: np.ndarray, cfg: dict, dpi: int) -> PageOCR:
    """1ページをOCRし、行・単語ごとの信頼度つきの結果を返す。"""
    ocr = cfg["ocr"]
    return recognize_with(img, ocr["language"], _resolve_psm(cfg), dpi, ocr["timeout_sec"], ocr["remove_cjk_spaces"])


@contextlib.contextmanager
def _tessdata_env(tessdata_dir: str | None):
    """呼び出しの間だけ TESSDATA_PREFIX を差し替える。
    （--tessdata-dir オプションは、Windowsで引用符がそのままTesseractに渡って失敗するため使わない。
    環境変数なら、パスに空白や日本語が含まれても動く）"""
    if not tessdata_dir:
        yield
        return
    old = os.environ.get("TESSDATA_PREFIX")
    os.environ["TESSDATA_PREFIX"] = str(Path(tessdata_dir).resolve())
    try:
        yield
    finally:
        if old is None:
            os.environ.pop("TESSDATA_PREFIX", None)
        else:
            os.environ["TESSDATA_PREFIX"] = old


def recognize_with(img: np.ndarray, lang: str, psm: int, dpi: int, timeout: int = 300,
                   remove_cjk_spaces: bool = True, whitelist: str | None = None,
                   tessdata_dir: str | None = None) -> PageOCR:
    """言語・psm・文字種制限・言語データの場所を直接指定してOCRする（帳票の項目ごとの読み取り用）。"""
    config = f"--psm {psm} --dpi {int(dpi)}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    with _tessdata_env(tessdata_dir):
        data = pytesseract.image_to_data(_to_pil(img), lang=lang, config=config,
                                         output_type=Output.DICT, timeout=timeout)
    return parse_tsv_data(data, remove_cjk_spaces)


def parse_tsv_data(data: dict, remove_cjk_spaces: bool = True) -> PageOCR:
    """image_to_data の結果（dict）を、行ごとにまとめた PageOCR に変換する。"""
    groups: dict[tuple, list[Word]] = {}
    order: list[tuple] = []
    for i, level in enumerate(data["level"]):
        text = str(data["text"][i])
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            continue
        if level != 5 or conf < 0 or not text.strip():
            continue
        key = (data["page_num"][i], data["block_num"][i], data["par_num"][i], data["line_num"][i])
        if key not in groups:
            groups[key] = []
            order.append(key)
        box = (int(data["left"][i]), int(data["top"][i]), int(data["width"][i]), int(data["height"][i]))
        groups[key].append(Word(text.strip(), conf, box))

    lines: list[Line] = []
    prev_par = None
    for n, key in enumerate(order, start=1):
        words = groups[key]
        text = " ".join(w.text for w in words)
        if remove_cjk_spaces:
            text = clean_cjk_spaces(text)
        weights = [max(len("".join(w.text.split())), 1) for w in words]
        conf = sum(w.conf * wt for w, wt in zip(words, weights)) / sum(weights)
        x0 = min(w.box[0] for w in words)
        y0 = min(w.box[1] for w in words)
        x1 = max(w.box[0] + w.box[2] for w in words)
        y1 = max(w.box[1] + w.box[3] for w in words)
        par = key[:3]
        lines.append(Line(n, text, conf, min(w.conf for w in words), (x0, y0, x1 - x0, y1 - y0),
                          words, new_paragraph=prev_par is not None and par != prev_par))
        prev_par = par
    return PageOCR(lines)


def make_searchable_pdf(img: np.ndarray, cfg: dict, dpi: int) -> bytes:
    """画像1枚から、透明テキスト付きの1ページPDF（バイト列）を作る。"""
    ocr = cfg["ocr"]
    return pytesseract.image_to_pdf_or_hocr(
        _to_pil(img), lang=ocr["language"], config=_tess_config(cfg, dpi),
        extension="pdf", timeout=ocr["timeout_sec"],
    )
