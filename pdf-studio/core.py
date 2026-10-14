"""PDF Studio core: 何でもPDF化 / 結合 / 編集。

外部への通信は一切しません。Office変換には LibreOffice (soffice) を使います。
"""
from __future__ import annotations

import io
import math
import os
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


def _office_to_pdf(src: Path, dst: Path) -> None:
    soffice = find_soffice()
    if not soffice:
        raise PdfStudioError(
            "Word/Excel/PowerPoint のPDF化には LibreOffice(無料)が必要です。"
            "https://www.libreoffice.org/ からインストールしてください。")
    with tempfile.TemporaryDirectory() as td:
        profile = Path(td, "profile")
        out = Path(td, "out")
        out.mkdir()
        # 同名の拡張子違いや日本語名で失敗しないよう、英数字名にコピーして変換
        work = Path(td, "in" + src.suffix.lower())
        shutil.copyfile(src, work)
        cmd = [soffice, f"-env:UserInstallation={profile.resolve().as_uri()}",
               "--headless", "--norestore", "--convert-to", "pdf", "--outdir", str(out), str(work)]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        except subprocess.TimeoutExpired:
            raise PdfStudioError(f"変換がタイムアウトしました: {src.name}")
        except subprocess.CalledProcessError as e:
            raise PdfStudioError(f"変換に失敗しました: {src.name} ({e.stderr.decode(errors='replace')[:200]})")
        made = out / (work.stem + ".pdf")
        if not made.exists():
            raise PdfStudioError(f"変換結果が作成されませんでした(壊れたファイル?): {src.name}")
        shutil.copyfile(made, dst)


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
    """PDF/Word/Excel/PowerPoint/画像/テキストを、与えた順に1つのPDFへ結合する。"""
    sources = [Path(s) for s in sources]
    if not sources:
        raise PdfStudioError("結合するファイルがありません")
    passwords = passwords or {}
    w = PdfWriter()
    with tempfile.TemporaryDirectory() as td:
        for i, s in enumerate(sources):
            pdf = Path(td, f"{i}.pdf")
            to_pdf(s, pdf)
            r = _open(pdf, passwords.get(s.name))
            start = len(w.pages)
            for p in r.pages:
                w.add_page(p)
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


def _overlay(page, draw) -> None:
    """表示向き(左下原点・正立)の座標で draw(canvas, disp_w, disp_h) を描き、ページへ重ねる。"""
    W, H = float(page.mediabox.width), float(page.mediabox.height)
    dw, dh, rot = _disp_size(page)
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(W, H))
    mat = {0: (1, 0, 0, 1, 0, 0), 90: (0, 1, -1, 0, W, 0),
           180: (-1, 0, 0, -1, W, H), 270: (0, -1, 1, 0, 0, H)}[rot]
    c.transform(*mat)
    draw(c, dw, dh)
    c.save()
    buf.seek(0)
    ov = PdfReader(buf).pages[0]
    page.merge_transformed_page(
        ov, Transformation().translate(float(page.mediabox.left), float(page.mediabox.bottom)))


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
    font = cjk_font()
    for i in parse_pages(pages, len(w.pages)):
        def draw(c, dw, dh):
            c.saveState()
            c.setFillColor(_color(color, float(opacity)))
            c.setFont(font, float(size))
            c.translate(dw / 2, dh / 2)
            c.rotate(float(angle))
            c.drawCentredString(0, -float(size) / 3, text)
            c.restoreState()
        _overlay(w.pages[i], draw)


def op_page_numbers(w, fmt="{n} / {total}", position="bottom-center", size=10, start=1, pages="all"):
    font = cjk_font()
    total = len(w.pages)
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
        _overlay(w.pages[i], draw)


def op_add_text(w, page, x, y, text, size=14, color="#000000"):
    """x,y: 表示されているページの左上からの距離(pt)。文字の左端・ベースラインの位置。"""
    if not text:
        raise PdfStudioError("文字が空です")
    font = cjk_font()
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
    font = cjk_font()

    def fn(w):
        for i, rects in hits.items():
            def draw(c, dw, dh, rects=rects):
                for x0, top, x1, bottom, fs in rects:
                    c.setFillColor(HexColor("#ffffff"))
                    c.rect(x0 - 0.5, dh - bottom - 0.5, (x1 - x0) + 1, (bottom - top) + 1, fill=1, stroke=0)
                    c.setFillColor(HexColor("#000000"))
                    c.setFont(font, float(fs))
                    c.drawString(x0, dh - bottom + (bottom - top) * 0.2, replace)
            _overlay(w.pages[i], draw)

    out = _rewrite(src, dst, fn, password)
    return out


# --------------------------------------------------------------- 画像化(黒塗りの確定)
def flatten(src, dst, dpi=150, password=None) -> Path:
    """全ページを画像にしてPDFへ戻す。白塗り/黒塗りの下の文字を完全に消したいときに使う。"""
    from PIL import Image
    r = _open(src, password)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td, "in.pdf")
        w0 = PdfWriter(); w0.append(r)
        with open(tmp, "wb") as f:
            w0.write(f)
        imgs = render_pages(tmp, dpi=int(dpi))
        pages = [Image.open(io.BytesIO(b)).convert("RGB") for b in imgs]
    pages[0].save(str(dst), "PDF", resolution=float(dpi), save_all=True, append_images=pages[1:])
    return Path(dst)


def render_pages(pdf, dpi=60, first=None, last=None) -> list[bytes]:
    """PNGバイト列のリスト(サムネイル/プレビュー用)。pdftoppm か pypdfium2 を使う。"""
    exe = shutil.which("pdftoppm")
    if exe:
        with tempfile.TemporaryDirectory() as td:
            cmd = [exe, "-png", "-r", str(int(dpi))]
            if first:
                cmd += ["-f", str(first)]
            if last:
                cmd += ["-l", str(last)]
            subprocess.run(cmd + [str(pdf), str(Path(td, "p"))], check=True, capture_output=True, timeout=300)
            return [p.read_bytes() for p in sorted(Path(td).glob("p*.png"))]
    try:
        import pypdfium2 as pdfium
    except ImportError:
        raise PdfStudioError("プレビューには poppler(pdftoppm) か pypdfium2 が必要です。")
    doc = pdfium.PdfDocument(str(pdf))
    a, b = (first or 1) - 1, (last or len(doc))
    out = []
    for i in range(a, b):
        bio = io.BytesIO()
        doc[i].render(scale=dpi / 72).to_pil().save(bio, "PNG")
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
