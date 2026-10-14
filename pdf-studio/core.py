"""PDF Studio core: 何でもPDF化 / 結合 / 編集。

外部への通信は一切しません。Office変換には LibreOffice (soffice) を使います。
"""
from __future__ import annotations

import atexit
import io
import math
import os
import queue
import threading
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

OFFICE_EXTS = {
    ".doc", ".docx", ".docm", ".dot", ".dotx", ".odt", ".rtf",
    ".xls", ".xlsx", ".xlsm", ".xlsb", ".ods",
    ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".odp",
    ".html", ".htm", ".xml",
}
TEXT_EXTS = {".txt", ".csv", ".tsv", ".md", ".log", ".json", ".ini", ".yaml", ".yml"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"}
SUPPORTED_EXTS = {".pdf"} | OFFICE_EXTS | TEXT_EXTS | IMAGE_EXTS

A4 = (595.2756, 841.8898)


class PdfStudioError(Exception):
    """利用者に見せてよいエラー。"""


# --------------------------------------------------------------- フォント
_FONT_CANDIDATES = [
    ("C:/Windows/Fonts/YuGothM.ttc", 0), ("C:/Windows/Fonts/meiryo.ttc", 0),
    ("C:/Windows/Fonts/msgothic.ttc", 0),
    ("/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", None),
    ("/usr/share/fonts/truetype/fonts-japanese-gothic.ttf", None),
    ("/usr/share/fonts/truetype/takao-gothic/TakaoGothic.ttf", None),
]
_font_name: str | None = None


def cjk_font() -> str:
    """日本語が出せるフォント名を返す(埋め込める TTF を優先、無ければ CID フォント)。"""
    global _font_name
    if _font_name:
        return _font_name
    for path, idx in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                kw = {"subfontIndex": idx} if idx is not None else {}
                pdfmetrics.registerFont(TTFont("PS-CJK", path, **kw))
                _font_name = "PS-CJK"
                return _font_name
            except Exception:
                continue
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    _font_name = "HeiseiKakuGo-W5"
    return _font_name


def font_for(text: str) -> str:
    """英数字だけなら内蔵フォント(読み込み不要で速い)、日本語を含めば日本語フォント。"""
    return "Helvetica" if str(text).isascii() else cjk_font()


# --------------------------------------------------------------- ページ指定
def parse_pages(spec, total: int) -> list[int]:
    """'1-3,5,8-' / 'odd' / 'even' / 'all' / [1,2] を 0 始まりの添字リストにする。"""
    if spec is None or spec == "" or spec == "all":
        return list(range(total))
    if isinstance(spec, (list, tuple)):
        out = [int(p) - 1 for p in spec]
    else:
        s = str(spec).strip().lower().replace(" ", "").replace("、", ",").replace("ー", "-")
        if s == "odd":
            return list(range(0, total, 2))
        if s == "even":
            return list(range(1, total, 2))
        out = []
        for part in filter(None, s.split(",")):
            m = re.fullmatch(r"(\d*)-(\d*)", part)
            if m:
                a = int(m.group(1)) if m.group(1) else 1
                b = int(m.group(2)) if m.group(2) else total
                if a > b:
                    raise PdfStudioError(f"ページ指定が逆順です: {part}")
                out.extend(range(a - 1, b))
            elif part.isdigit():
                out.append(int(part) - 1)
            else:
                raise PdfStudioError(f"ページ指定を読めません: {part}")
    for i in out:
        if i < 0 or i >= total:
            raise PdfStudioError(f"ページ {i + 1} はありません(全 {total} ページ)")
    return out


# --------------------------------------------------------------- PDF化
def find_soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    for p in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ):
        if os.path.exists(p):
            return p
    return None


_PROFILE_SLOTS = max(2, min(4, (os.cpu_count() or 2)))
_profiles: "queue.Queue[Path]" = queue.Queue()
_profile_root: Path | None = None
_profile_lock = threading.Lock()


def _acquire_profile() -> Path:
    """LibreOffice のプロファイルを使い回す。

    ユーザーフォルダに残すので、2回目以降の起動では初期化(数秒〜十数秒)が不要になる。
    1スロットは同時に1件だけ使う。
    """
    global _profile_root
    with _profile_lock:
        if _profile_root is None:
            root = Path.home() / ".pdfstudio" / "lo"
            try:
                root.mkdir(parents=True, exist_ok=True)
            except OSError:
                root = Path(tempfile.mkdtemp(prefix="pdfstudio_lo_"))
                atexit.register(shutil.rmtree, root, True)
            _profile_root = root
            for i in range(_PROFILE_SLOTS):
                _profiles.put(root / f"p{i}")
    return _profiles.get()


def warm_up() -> None:
    """起動直後に裏で呼ぶ: フォント読み込み・主要ライブラリ・LibreOffice の初回起動を先に済ませる。"""
    try:
        cjk_font()
        import pdfplumber  # noqa: F401
        try:
            import pypdfium2  # noqa: F401
        except ImportError:
            pass
        if find_soffice():
            with tempfile.TemporaryDirectory() as td:
                t = Path(td, "w.txt")
                t.write_text("warm", encoding="utf-8")
                _office_to_pdf(t, Path(td, "w.pdf"))
    except Exception:
        pass


def _office_to_pdf(src: Path, dst: Path) -> None:
    soffice = find_soffice()
    if not soffice:
        raise PdfStudioError(
            "Word/Excel/PowerPoint のPDF化には LibreOffice(無料)が必要です。"
            "https://www.libreoffice.org/ からインストールしてください。")
    profile = _acquire_profile()
    try:
        with tempfile.TemporaryDirectory() as td:
            out = Path(td, "out")
            out.mkdir()
            # 日本語名・同名で失敗しないよう、英数字名にコピーして変換
            work = Path(td, "in" + src.suffix.lower())
            shutil.copyfile(src, work)
            cmd = [soffice, f"-env:UserInstallation={profile.resolve().as_uri()}",
                   "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf",
                   "--outdir", str(out), str(work)]
            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=300)
            except subprocess.TimeoutExpired:
                raise PdfStudioError(f"変換がタイムアウトしました: {src.name}")
            except subprocess.CalledProcessError as e:
                raise PdfStudioError(f"変換に失敗しました: {src.name} ({e.stderr.decode(errors='replace')[:200]})")
            made = out / (work.stem + ".pdf")
            if not made.exists():
                raise PdfStudioError(f"変換結果が作成されませんでした(壊れたファイル?): {src.name}")
            shutil.move(str(made), dst)
    finally:
        _profiles.put(profile)


def _text_to_pdf(src: Path, dst: Path) -> None:
    raw = src.read_bytes()
    for enc in ("utf-8-sig", "cp932", "utf-16"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    font, size, lead = cjk_font(), 10, 14
    margin = 48
    width = A4[0] - margin * 2
    lines: list[str] = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.expandtabs(4)
        cur = ""
        for ch in line:
            if pdfmetrics.stringWidth(cur + ch, font, size) > width:
                lines.append(cur)
                cur = ch
            else:
                cur += ch
        lines.append(cur)
    c = rl_canvas.Canvas(str(dst), pagesize=A4)
    y = A4[1] - margin
    c.setFont(font, size)
    for ln in lines:
        if y < margin:
            c.showPage()
            c.setFont(font, size)
            y = A4[1] - margin
        c.drawString(margin, y, ln)
        y -= lead
    c.save()


def _image_to_pdf(src: Path, dst: Path) -> None:
    from PIL import Image, ImageOps, ImageSequence
    from reportlab.lib.utils import ImageReader

    img = Image.open(src)
    c = rl_canvas.Canvas(str(dst))
    for frame in ImageSequence.Iterator(img):
        fr = ImageOps.exif_transpose(frame.convert("RGBA"))
        bg = Image.new("RGB", fr.size, "white")
        bg.paste(fr, mask=fr.split()[3])
        iw, ih = bg.size
        page = A4 if ih >= iw else (A4[1], A4[0])
        m = 24
        scale = min((page[0] - 2 * m) / iw, (page[1] - 2 * m) / ih, 1.0 if max(iw, ih) < 600 else 99)
        w, h = iw * scale, ih * scale
        c.setPageSize(page)
        c.drawImage(ImageReader(bg), (page[0] - w) / 2, (page[1] - h) / 2, w, h)
        c.showPage()
    c.save()


def to_pdf(src, dst) -> Path:
    """任意の対応ファイルを1つのPDFにする。"""
    src, dst = Path(src), Path(dst)
    ext = src.suffix.lower()
    if not src.exists():
        raise PdfStudioError(f"ファイルが見つかりません: {src}")
    if ext == ".pdf":
        if src.resolve() != dst.resolve():
            shutil.copyfile(src, dst)
    elif ext in IMAGE_EXTS:
        _image_to_pdf(src, dst)
    elif ext in TEXT_EXTS:
        _text_to_pdf(src, dst)
    elif ext in OFFICE_EXTS:
        _office_to_pdf(src, dst)
    else:
        raise PdfStudioError(f"対応していない形式です: {ext or src.name}")
    return dst


def _open(path, password: str | None = None) -> PdfReader:
    r = PdfReader(str(path))
    if r.is_encrypted:
        if not password or not r.decrypt(password):
            raise PdfStudioError("パスワード付きPDFです。パスワードを指定してください。")
    return r


def merge(sources, dst, passwords: dict | None = None, bookmarks: bool = True) -> Path:
    """PDF/Word/Excel/PowerPoint/画像/テキストを、与えた順に1つのPDFへ結合する。

    変換は並列で行い、すでにPDFのものはコピーせずそのまま読む。
    """
    from concurrent.futures import ThreadPoolExecutor

    sources = [Path(s) for s in sources]
    if not sources:
        raise PdfStudioError("結合するファイルがありません")
    passwords = passwords or {}
    w = PdfWriter()
    with tempfile.TemporaryDirectory() as td:
        def prep(i_s):
            i, s = i_s
            if s.suffix.lower() == ".pdf":
                return s
            return to_pdf(s, Path(td, f"{i}.pdf"))
        with ThreadPoolExecutor(max_workers=min(4, len(sources))) as ex:
            pdfs = list(ex.map(prep, enumerate(sources)))
        for s, pdf in zip(sources, pdfs):
            r = _open(pdf, passwords.get(s.name))
            start = len(w.pages)
            w.append(r, import_outline=False)
            if bookmarks and len(r.pages):
                w.add_outline_item(s.stem, start)
        with open(dst, "wb") as f:
            w.write(f)
    return Path(dst)


# --------------------------------------------------------------- 編集の下請け
def _disp_size(page) -> tuple[float, float, int]:
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    rot = int(page.get("/Rotate", 0) or 0) % 360
    return (h, w, rot) if rot in (90, 270) else (w, h, rot)


def _color(value, alpha: float = 1.0):
    try:
        c = HexColor(value if str(value).startswith("#") else "#" + str(value))
    except Exception:
        raise PdfStudioError(f"色の指定が不正です: {value}")
    return Color(c.red, c.green, c.blue, alpha=alpha)


_ROT_MATRIX = lambda W, H: {0: (1, 0, 0, 1, 0, 0), 90: (0, 1, -1, 0, W, 0),
                            180: (-1, 0, 0, -1, W, H), 270: (0, -1, 1, 0, 0, H)}


def _overlay_many(jobs) -> None:
    """jobs: [(page, draw)]。表示向き(左下原点・正立)の座標で draw(canvas, disp_w, disp_h) を描き、各ページへ重ねる。

    全ページ分を1つのキャンバス(=フォントの埋め込みも1回)で作るので、多ページでも速い。
    """
    if not jobs:
        return
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    for page, draw in jobs:
        W, H = float(page.mediabox.width), float(page.mediabox.height)
        dw, dh, rot = _disp_size(page)
        c.setPageSize((W, H))
        c.saveState()
        c.transform(*_ROT_MATRIX(W, H)[rot])
        draw(c, dw, dh)
        c.restoreState()
        c.showPage()
    c.save()
    buf.seek(0)
    ov = PdfReader(buf)
    for k, (page, _) in enumerate(jobs):
        page.merge_transformed_page(
            ov.pages[k], Transformation().translate(float(page.mediabox.left), float(page.mediabox.bottom)))


def _overlay(page, draw) -> None:
    _overlay_many([(page, draw)])


def _rewrite(src, dst, fn, password=None) -> Path:
    r = _open(src, password)
    w = PdfWriter()
    w.append(r)
    fn(w)
    if r.metadata:
        w.add_metadata({k: str(v) for k, v in r.metadata.items() if k.startswith("/")})
    with open(dst, "wb") as f:
        w.write(f)
    return Path(dst)


# --------------------------------------------------------------- 編集操作
def op_rotate(w, pages="all", angle=90):
    if int(angle) % 90:
        raise PdfStudioError("回転角は90の倍数で指定してください")
    for i in parse_pages(pages, len(w.pages)):
        w.pages[i].rotate(int(angle))


def op_delete(w, pages):
    idx = set(parse_pages(pages, len(w.pages)))
    if len(idx) >= len(w.pages):
        raise PdfStudioError("全ページは削除できません")
    for i in sorted(idx, reverse=True):
        del w.pages[i]


def op_arrange(w, pages):
    """pages の順にページを並べ替え/抽出/複製する(例: [3,1,2] や '5-1' 不可、'1,1,2')。"""
    order = parse_pages(pages, len(w.pages))
    if not order:
        raise PdfStudioError("ページが選ばれていません")
    src = PdfWriter()
    src.append(PdfReader(io.BytesIO(_dump(w))))
    for i in range(len(w.pages) - 1, -1, -1):
        del w.pages[i]
    for i in order:
        w.add_page(src.pages[i])


def _dump(w) -> bytes:
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


def op_insert_blank(w, after=0, count=1):
    after, count = int(after), int(count)
    if not 0 <= after <= len(w.pages) or count < 1:
        raise PdfStudioError("空白ページの挿入位置が不正です")
    ref = w.pages[min(max(after - 1, 0), len(w.pages) - 1)]
    for k in range(count):
        w.insert_blank_page(width=ref.mediabox.width, height=ref.mediabox.height, index=after + k)


def op_watermark(w, text, pages="all", size=60, opacity=0.2, angle=45, color="#ff0000"):
    if not text:
        raise PdfStudioError("透かし文字が空です")
    font = font_for(text)

    def draw(c, dw, dh):
        c.saveState()
        c.setFillColor(_color(color, float(opacity)))
        c.setFont(font, float(size))
        c.translate(dw / 2, dh / 2)
        c.rotate(float(angle))
        c.drawCentredString(0, -float(size) / 3, text)
        c.restoreState()
    _overlay_many([(w.pages[i], draw) for i in parse_pages(pages, len(w.pages))])


def op_page_numbers(w, fmt="{n} / {total}", position="bottom-center", size=10, start=1, pages="all"):
    font = font_for(fmt)
    total = len(w.pages)
    jobs = []
    for i in parse_pages(pages, total):
        label = fmt.replace("{n}", str(i + int(start))).replace("{total}", str(total + int(start) - 1))

        def draw(c, dw, dh, label=label):
            c.setFont(font, float(size))
            c.setFillColor(HexColor("#000000"))
            m = 28
            y = m if position.startswith("bottom") else dh - m
            if position.endswith("left"):
                c.drawString(m, y, label)
            elif position.endswith("right"):
                c.drawRightString(dw - m, y, label)
            else:
                c.drawCentredString(dw / 2, y, label)
        jobs.append((w.pages[i], draw))
    _overlay_many(jobs)


def op_add_text(w, page, x, y, text, size=14, color="#000000"):
    """x,y: 表示されているページの左上からの距離(pt)。文字の左端・ベースラインの位置。"""
    if not text:
        raise PdfStudioError("文字が空です")
    font = font_for(text)
    (i,) = parse_pages([page], len(w.pages))

    def draw(c, dw, dh):
        c.setFont(font, float(size))
        c.setFillColor(_color(color))
        for k, line in enumerate(str(text).split("\n")):
            c.drawString(float(x), dh - float(y) - k * float(size) * 1.2, line)
    _overlay(w.pages[i], draw)


def op_rect(w, page, x, y, width, height, color="#ffffff"):
    """矩形で塗りつぶす(白塗り/黒塗り)。※下の文字データは残るため、黒塗り用途は op_flatten と併用。"""
    (i,) = parse_pages([page], len(w.pages))

    def draw(c, dw, dh):
        c.setFillColor(_color(color))
        c.setStrokeColor(_color(color))
        c.rect(float(x), dh - float(y) - float(height), float(width), float(height), fill=1, stroke=0)
    _overlay(w.pages[i], draw)


def op_metadata(w, title=None, author=None, subject=None, keywords=None):
    md = {}
    for k, v in (("/Title", title), ("/Author", author), ("/Subject", subject), ("/Keywords", keywords)):
        if v is not None:
            md[k] = v
    w.add_metadata(md)


def op_compress(w, level=9):
    for p in w.pages:
        p.compress_content_streams(level=int(level))
    w.compress_identical_objects()


OPS = {
    "rotate": op_rotate, "delete": op_delete, "arrange": op_arrange,
    "insert_blank": op_insert_blank, "watermark": op_watermark,
    "page_numbers": op_page_numbers, "add_text": op_add_text, "rect": op_rect,
    "metadata": op_metadata, "compress": op_compress,
}


def edit(src, dst, op: str, params: dict | None = None, password: str | None = None) -> Path:
    if op == "replace_text":
        return replace_text(src, dst, password=password, **(params or {}))
    if op == "edit_text":
        return edit_text(src, dst, (params or {}).get("items"), password=password)
    if op == "flatten":
        return flatten(src, dst, password=password, **(params or {}))
    if op == "encrypt":
        return encrypt(src, dst, password=password, **(params or {}))
    if op == "decrypt":
        return decrypt(src, dst, password=password)
    if op not in OPS:
        raise PdfStudioError(f"未対応の編集です: {op}")
    params = {k: v for k, v in (params or {}).items() if k != "password"}
    try:
        return _rewrite(src, dst, lambda w: OPS[op](w, **params), password)
    except TypeError as e:
        raise PdfStudioError(f"編集の指定が足りません: {e}")


# --------------------------------------------------------------- 文字の置換
def replace_text(src, dst, find, replace, pages="all", size=None, password=None) -> Path:
    """既存の文字を探し、その位置を白塗りして新しい文字を書く(元の文字データは残りません)。

    背景が白の文書向け。回転ページは未対応。置換回数は戻り値ではなく例外で0件を知らせる。
    """
    import pdfplumber

    if not find:
        raise PdfStudioError("検索文字が空です")
    r = _open(src, password)
    hits: dict[int, list[tuple]] = {}
    tmp = None
    try:
        if r.is_encrypted:
            tmp = Path(tempfile.mkstemp(suffix=".pdf")[1])
            w0 = PdfWriter(); w0.append(r)
            with open(tmp, "wb") as f:
                w0.write(f)
        with pdfplumber.open(str(tmp or src)) as pl:
            for i in parse_pages(pages, len(pl.pages)):
                pg = pl.pages[i]
                if (pg.rotation or 0) % 360:
                    raise PdfStudioError("回転しているページの文字置換は未対応です。先に回転を戻してください。")
                for m in pg.search(re.escape(find)):
                    chars = m.get("chars") or []
                    fs = size or (max((c["size"] for c in chars), default=m["bottom"] - m["top"]))
                    hits.setdefault(i, []).append((m["x0"], m["top"], m["x1"], m["bottom"], fs))
    finally:
        if tmp:
            tmp.unlink(missing_ok=True)
    if not hits:
        raise PdfStudioError(f"「{find}」は見つかりませんでした(画像化されたPDFの文字は検索できません)")
    font = font_for(replace)

    def fn(w):
        jobs = []
        for i, rects in hits.items():
            def draw(c, dw, dh, rects=rects):
                for x0, top, x1, bottom, fs in rects:
                    c.setFillColor(HexColor("#ffffff"))
                    c.rect(x0 - 0.5, dh - bottom - 0.5, (x1 - x0) + 1, (bottom - top) + 1, fill=1, stroke=0)
                    c.setFillColor(HexColor("#000000"))
                    c.setFont(font, float(fs))
                    c.drawString(x0, dh - bottom + (bottom - top) * 0.2, replace)
            jobs.append((w.pages[i], draw))
        _overlay_many(jobs)

    out = _rewrite(src, dst, fn, password)
    return out


# --------------------------------------------------------------- 文字の直接編集
def _hex(col) -> str:
    """pdfplumber の色(グレー/RGB/CMYK)を #rrggbb にする。"""
    try:
        if col is None:
            return "#000000"
        if isinstance(col, (int, float)):
            col = (col,)
        col = tuple(float(c) for c in col)
        if len(col) == 1:
            r = g = b = col[0]
        elif len(col) == 3:
            r, g, b = col
        elif len(col) == 4:
            c, m, y, k = col
            r, g, b = (1 - min(1, c + k), 1 - min(1, m + k), 1 - min(1, y + k))
        else:
            return "#000000"
        return "#%02x%02x%02x" % tuple(int(max(0, min(1, v)) * 255) for v in (r, g, b))
    except Exception:
        return "#000000"


def text_segments(pdf, page, password=None) -> dict:
    """1ページ分の編集できる文字のかたまり(行を、表の列などの大きな空きで区切ったもの)を返す。

    座標は表示されているページの左上原点(pt)。
    """
    import pdfplumber

    tmp = None
    try:
        path = pdf
        if PdfReader(str(pdf)).is_encrypted:
            tmp = Path(tempfile.mkstemp(suffix=".pdf")[1])
            w0 = PdfWriter(); w0.append(_open(pdf, password))
            with open(tmp, "wb") as f:
                w0.write(f)
            path = tmp
        with pdfplumber.open(str(path)) as pl:
            if not 1 <= int(page) <= len(pl.pages):
                raise PdfStudioError("ページがありません")
            pg = pl.pages[int(page) - 1]
            if (pg.rotation or 0) % 360:
                raise PdfStudioError("回転しているページの文字編集は未対応です。先に回転を戻してください。")
            words = pg.extract_words(extra_attrs=["size", "non_stroking_color"], keep_blank_chars=False,
                                     x_tolerance=2, y_tolerance=2)
    finally:
        if tmp:
            tmp.unlink(missing_ok=True)
    # 行にまとめる(上端が近いものを同じ行とする)
    words.sort(key=lambda w: (round(w["top"] / 3), w["x0"]))
    lines: list[list[dict]] = []
    for wd in words:
        if lines and abs(lines[-1][-1]["top"] - wd["top"]) <= max(2.0, wd["size"] * 0.4):
            lines[-1].append(wd)
        else:
            lines.append([wd])
    segs = []
    for ln in lines:
        ln.sort(key=lambda w: w["x0"])
        cur = [ln[0]]
        for wd in ln[1:]:
            gap = wd["x0"] - cur[-1]["x1"]
            if gap > max(wd["size"], cur[-1]["size"]) * 1.2:
                segs.append(cur)
                cur = [wd]
            else:
                cur.append(wd)
        segs.append(cur)
    out = []
    for sg in segs:
        txt = ""
        for k, wd in enumerate(sg):
            if k:
                gap = wd["x0"] - sg[k - 1]["x1"]
                txt += " " if gap > wd["size"] * 0.15 and not _is_cjk(wd["text"][0]) else ""
            txt += wd["text"]
        out.append({"x0": min(w["x0"] for w in sg), "top": min(w["top"] for w in sg),
                    "x1": max(w["x1"] for w in sg), "bottom": max(w["bottom"] for w in sg),
                    "text": txt, "size": round(max(w["size"] for w in sg), 2),
                    "color": _hex(sg[0].get("non_stroking_color"))})
    return {"width": float(pg.width), "height": float(pg.height), "segments": out}


def _is_cjk(ch: str) -> bool:
    return ord(ch) >= 0x2E80


def _bg_color(img, x0, top, x1, bottom, scale=1.0) -> str:
    """文字のまわりの色(背景)を、枠のすぐ外側の画素の最頻値から推定する。"""
    from collections import Counter
    W, H = img.size
    px = img.load()
    pts = []
    pad = 2
    xs = range(max(0, int((x0 - pad) * scale)), min(W, int((x1 + pad) * scale) + 1))
    for y in (int((top - pad) * scale), int((bottom + pad) * scale)):
        if 0 <= y < H:
            pts += [px[x, y] for x in xs]
    for x in (int((x0 - pad) * scale), int((x1 + pad) * scale)):
        if 0 <= x < W:
            pts += [px[x, y] for y in range(max(0, int((top - pad) * scale)), min(H, int((bottom + pad) * scale) + 1))]
    if not pts:
        return "#ffffff"
    r, g, b = Counter(p[:3] for p in pts).most_common(1)[0][0]
    return "#%02x%02x%02x" % (r, g, b)


def edit_text(src, dst, items, password=None) -> Path:
    """items: [{page, x0, top, x1, bottom, text, size, color}] 元の位置の文字を新しい文字に差し替える。

    元の文字の範囲を背景色で塗りつぶし(背景色は周囲から推定)、同じ位置・大きさ・色で書き直す。
    """
    from PIL import Image
    if not items:
        raise PdfStudioError("編集内容がありません")
    by_page: dict[int, list] = {}
    for it in items:
        by_page.setdefault(int(it["page"]) - 1, []).append(it)
    # 背景色の推定用に、対象ページだけを72dpi(1px=1pt)で描画
    src_path = Path(src)
    tmp = None
    if PdfReader(str(src)).is_encrypted:
        tmp = Path(tempfile.mkstemp(suffix=".pdf")[1])
        w0 = PdfWriter(); w0.append(_open(src, password))
        with open(tmp, "wb") as f:
            w0.write(f)
        src_path = tmp
    bgs: dict[int, "Image.Image"] = {}
    try:
        for i in by_page:
            bgs[i] = render_pil(src_path, [i + 1], 72, keep=tmp is None)[0]
    finally:
        if tmp:
            tmp.unlink(missing_ok=True)

    def fn(w):
        jobs = []
        for i, its in by_page.items():
            if not 0 <= i < len(w.pages):
                raise PdfStudioError(f"ページ {i + 1} はありません")
            dw, dh, _ = _disp_size(w.pages[i])
            img = bgs[i]
            sc = img.size[0] / dw

            def draw(c, dw, dh, its=its, img=img, sc=sc):
                for it in its:
                    x0, top, x1, bottom = (float(it[k]) for k in ("x0", "top", "x1", "bottom"))
                    size = float(it.get("size") or (bottom - top))
                    bg = _bg_color(img, x0, top, x1, bottom, sc)
                    c.setFillColor(HexColor(bg))
                    c.rect(x0 - 0.8, dh - bottom - 0.8, (x1 - x0) + 1.6, (bottom - top) + 1.6, fill=1, stroke=0)
                    c.setFillColor(_color(it.get("color") or "#000000"))
                    c.setFont(font_for(it["text"]), size)
                    # ベースラインは枠の下端から文字の下がり分だけ上
                    c.drawString(x0, dh - bottom + (bottom - top - size) / 2 + size * 0.2, str(it["text"]))
            jobs.append((w.pages[i], draw))
        _overlay_many(jobs)
    return _rewrite(src, dst, fn, password)


# --------------------------------------------------------------- 画像化(黒塗りの確定)
def flatten(src, dst, dpi=150, password=None) -> Path:
    """全ページを画像にしてPDFへ戻す。白塗り/黒塗りの下の文字を完全に消したいときに使う。"""
    r = _open(src, password)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td, "in.pdf")
        w0 = PdfWriter(); w0.append(r)
        with open(tmp, "wb") as f:
            w0.write(f)
        pages = render_pil(tmp, None, int(dpi), keep=False)
    pages[0].save(str(dst), "PDF", resolution=float(dpi), save_all=True, append_images=pages[1:], quality=85)
    return Path(dst)


# pdfium(C製で高速)で描画。開いた文書は使い回す。pdfium は並行利用できないので1本ずつ。
_pdfium_lock = threading.RLock()
_pdfium_docs: "dict[tuple, object]" = {}


def _pdfium_doc(path, password=None):
    import pypdfium2 as pdfium
    key = (str(path), password)
    d = _pdfium_docs.get(key)
    if d is None:
        if len(_pdfium_docs) >= 6:  # 古いものから閉じる
            old = next(iter(_pdfium_docs))
            try:
                _pdfium_docs.pop(old).close()
            except Exception:
                pass
        d = pdfium.PdfDocument(str(path), password=password)
        _pdfium_docs[key] = d
    return d


def close_pdfium() -> None:
    with _pdfium_lock:
        for d in _pdfium_docs.values():
            try:
                d.close()
            except Exception:
                pass
        _pdfium_docs.clear()


def render_pil(pdf, pages=None, dpi=60, password=None, keep=True) -> list:
    """pages: 1始まりのページ番号のリスト(None=全ページ)。PIL画像のリストを返す。

    keep=False は一時ファイル用(開いたままにするとWindowsで削除できないため、使い終わったら閉じる)。
    """
    try:
        import pypdfium2  # noqa: F401
    except ImportError:
        return _render_pil_poppler(pdf, pages, dpi)
    import pypdfium2 as pdfium
    with _pdfium_lock:
        doc = _pdfium_doc(pdf, password) if keep else pdfium.PdfDocument(str(pdf), password=password)
        try:
            n = len(doc)
            idx = range(n) if pages is None else [p - 1 for p in pages if 1 <= p <= n]
            return [doc[i].render(scale=dpi / 72).to_pil().convert("RGB") for i in idx]
        finally:
            if not keep:
                doc.close()


def _render_pil_poppler(pdf, pages, dpi):
    from PIL import Image
    exe = shutil.which("pdftoppm")
    if not exe:
        raise PdfStudioError("プレビューには pypdfium2(pip install pypdfium2) か poppler(pdftoppm) が必要です。")
    out = []
    with tempfile.TemporaryDirectory() as td:
        rng = [(p, p) for p in pages] if pages else [(None, None)]
        for k, (a, b) in enumerate(rng):
            cmd = [exe, "-png", "-r", str(int(dpi))]
            if a:
                cmd += ["-f", str(a), "-l", str(b)]
            subprocess.run(cmd + [str(pdf), str(Path(td, f"p{k}_"))], check=True, capture_output=True, timeout=300)
        for p in sorted(Path(td).glob("p*.png"), key=lambda x: (int(x.name[1:].split("_")[0]), x.name)):
            out.append(Image.open(p).convert("RGB"))
    return out


def render_pages(pdf, dpi=60, first=None, last=None, password=None, quality=82) -> list[bytes]:
    """JPEGバイト列のリスト(サムネイル/プレビュー用。PNGより数倍速く、小さい)。"""
    first = first or 1
    imgs = render_pil(pdf, None if last is None and first == 1 else list(range(first, (last or first) + 1)),
                      dpi, password)
    out = []
    for im in imgs:
        bio = io.BytesIO()
        im.save(bio, "JPEG", quality=quality)
        out.append(bio.getvalue())
    return out


# --------------------------------------------------------------- 暗号化 / 分割 / 情報
def encrypt(src, dst, new_password, password=None) -> Path:
    if not new_password:
        raise PdfStudioError("パスワードが空です")
    return _rewrite(src, dst, lambda w: w.encrypt(new_password), password)


def decrypt(src, dst, password=None) -> Path:
    return _rewrite(src, dst, lambda w: None, password)


def split(src, outdir, ranges=None, password=None) -> list[Path]:
    """ranges 例 '1-3;4-5;6-' (省略時は1ページずつ)。"""
    r = _open(src, password)
    n = len(r.pages)
    groups = ([[i] for i in range(n)] if not ranges
              else [parse_pages(g, n) for g in str(ranges).replace("；", ";").split(";") if g.strip()])
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    stem = Path(src).stem
    outs = []
    for k, g in enumerate(groups, 1):
        w = PdfWriter()
        for i in g:
            w.add_page(r.pages[i])
        p = outdir / f"{stem}_{k:03d}.pdf"
        with open(p, "wb") as f:
            w.write(f)
        outs.append(p)
    return outs


def info(path, password=None) -> dict:
    r = PdfReader(str(path))
    enc = r.is_encrypted
    if enc and not (password and r.decrypt(password)):
        return {"pages": 0, "encrypted": True, "sizes": []}
    return {"pages": len(r.pages), "encrypted": enc,
            "sizes": [list(_disp_size(p)[:2]) for p in r.pages],
            "title": (r.metadata.title if r.metadata else None) or ""}
