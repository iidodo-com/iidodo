"""帳票（様式が決まった書類）の項目別読み取り。
  1. ページの外枠を検出して位置の基準にする（スキャンのずれ・拡大縮小に強い）
  2. テンプレート(YAML)に書いた項目の範囲だけを切り出す
  3. 項目の種類（金額・数字・日付・文字）ごとに読み方と検証を変える
手書き欄(handwritten: true)は、Tesseractでは信頼できないため、必ず「要目視」にする。"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import yaml

from . import engine, preprocess
from .errors import OcrToolError
from .normalize import normalize_digits, normalize_text, parse_amount, parse_date_jp

FRAME_UNITS = 1000.0  # テンプレートの座標は「枠の幅 = 1000」とした相対値


@dataclass
class FieldSpec:
    id: str
    label: str
    box: tuple[float, float, float, float]   # x0, y0, x1, y1（枠の幅=1000とした相対座標）
    type: str = "text"                       # text / digits / amount / date
    psm: int = 6
    lang: str | None = None                  # 省略時は config.yaml の ocr.language
    handwritten: bool = False
    pattern: str | None = None               # 読み取り値がこの正規表現に合わなければ要確認
    keep: str = "-"                          # digits型で残す記号
    choices: tuple[str, ...] = ()            # 取りうる値の一覧。読み取り結果が近ければこの値に補正する（預金種別など）
    scale: float = 1.0                       # 読み取り前の拡大率（小さい特殊な書体向け）


@dataclass
class Template:
    name: str
    fields: list[FieldSpec]
    checks: list[dict] = field(default_factory=list)
    match: dict = field(default_factory=dict)
    preprocess: dict = field(default_factory=dict)


@dataclass
class FieldResult:
    id: str
    label: str
    text: str                 # OCRの生の読み取り（採用した読み方）
    value: object             # 正規化後の値（int / str / (Y,M,D) / None）
    conf: float | None        # 信頼度(0-100)
    handwritten: bool
    problems: list[str]       # 読み取り段階の問題（パターン不一致・結果の揺れなど）
    crop: np.ndarray | None = None
    box_px: tuple[int, int, int, int] | None = None
    readings: list[tuple[str, object, float]] = field(default_factory=list)  # すべての読み方の (文字列, 値, 信頼度)
    type_is_text: bool = False  # 文字列項目か（数字・金額・日付ではない）


def load_template(path: str | Path) -> Template:
    """テンプレートYAMLを読み込んで検証する。"""
    p = Path(path)
    if not p.is_file():
        raise OcrToolError(f"テンプレートが見つかりません: {p}", "templates フォルダのYAMLファイルを --template で指定してください。")
    try:
        d = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise OcrToolError(f"テンプレートの書式エラーです: {e}", "インデントとコロンの後の半角スペースを確認してください。") from e
    fields = []
    for i, f in enumerate(d.get("fields") or []):
        try:
            box = tuple(float(v) for v in f["box"])
            if len(box) != 4 or box[2] <= box[0] or box[3] <= box[1]:
                raise ValueError
            ftype = f.get("type", "text")
            if ftype not in ("text", "digits", "amount", "date"):
                raise OcrToolError(f"テンプレートの項目 '{f['id']}' の type '{ftype}' は使えません。",
                                   "text / digits / amount / date のいずれかにしてください。")
            fields.append(FieldSpec(
                id=str(f["id"]), label=str(f.get("label", f["id"])), box=box, type=ftype,
                psm=int(f.get("psm", 6)), lang=f.get("lang"), handwritten=bool(f.get("handwritten", False)),
                pattern=f.get("pattern"), keep=str(f.get("keep", "-")),
                choices=tuple(str(c) for c in (f.get("choices") or ())), scale=float(f.get("scale", 1.0))))
        except OcrToolError:
            raise
        except (KeyError, TypeError, ValueError):
            raise OcrToolError(f"テンプレートの {i + 1} 番目の項目が不正です。",
                               "id と box（x0, y0, x1, y1 の4数値で x1>x0, y1>y0）が必要です。") from None
    if not fields:
        raise OcrToolError("テンプレートに項目(fields)がありません。", "fields: の下に項目を書いてください。")
    ids = [f.id for f in fields]
    if len(set(ids)) != len(ids):
        raise OcrToolError("テンプレートの項目 id が重複しています。", "id は項目ごとに別の名前にしてください。")
    return Template(str(d.get("name", p.stem)), fields, d.get("checks") or [], d.get("match") or {}, d.get("preprocess") or {})


# ---------------------------------------------------------------- 枠の検出

def _runs(mask_1d: np.ndarray, gap: int = 3) -> list[tuple[int, int]]:
    idx = np.where(mask_1d)[0]
    if not len(idx):
        return []
    out, s, p = [], idx[0], idx[0]
    for x in idx[1:]:
        if x - p > gap:
            out.append((int(s), int(p)))
            s = x
        p = x
    out.append((int(s), int(p)))
    return out


def detect_frame(gray: np.ndarray) -> tuple[int, int, int]:
    """外枠の (左x, 上y, 幅) を返す。長い横線のうち最上段の y、長い縦線の最左 x と最右 x を使う。
    見つからなければ OcrToolError。"""
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    h, w = bw.shape
    horiz = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(w // 4, 10), 1)))
    vert = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(h // 12, 10))))
    ys = _runs(horiz.sum(axis=1) > 0)
    xs = _runs(vert.sum(axis=0) > 0)
    if not ys or len(xs) < 2:
        raise OcrToolError(
            "帳票の外枠（罫線）を検出できませんでした。",
            "スキャンの向き・濃さ・解像度（300dpi以上）を確認してください。枠のない書式は、このテンプレート方式に向きません。")
    y0 = (ys[0][0] + ys[0][1]) // 2
    x0 = (xs[0][0] + xs[0][1]) // 2
    x1 = (xs[-1][0] + xs[-1][1]) // 2
    if x1 - x0 < w * 0.3:
        raise OcrToolError("帳票の外枠の幅が極端に小さいため、枠の検出に失敗したと判断しました。",
                           "ページ全体が写っているか、向きが正しいか確認してください。")
    return x0, y0, x1 - x0


def field_box_px(spec: FieldSpec, frame: tuple[int, int, int], shape: tuple[int, int]) -> tuple[int, int, int, int]:
    """項目の相対座標を、画像上のピクセル範囲 (x0, y0, x1, y1) に変換する（画像の外にはみ出さないよう丸める）。"""
    fx, fy, fw = frame
    k = fw / FRAME_UNITS
    x0, y0, x1, y1 = (int(round(v)) for v in (fx + spec.box[0] * k, fy + spec.box[1] * k, fx + spec.box[2] * k, fy + spec.box[3] * k))
    h, w = shape
    return max(0, x0), max(0, y0), min(w, x1), min(h, y1)


# ---------------------------------------------------------------- 項目の読み取り

def despeckle(gray: np.ndarray, min_area: int = 12) -> np.ndarray:
    """スキャンのゴミ（小さな黒い点）を消す。"""
    inv = 255 - cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    n, lab, st, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= min_area]
    out = np.full_like(gray, 255)
    out[np.isin(lab, keep)] = 0
    return out


def _variants(gray: np.ndarray, spec: FieldSpec, frame: tuple[int, int, int]) -> list[np.ndarray]:
    """読み取りを試す画像の候補。同じ項目を加工や余白を変えて何通りか読み、結果を比べる。
    （1通りだと、わずかな画素の違いで レ→シ のように読みが変わるため）"""
    x0, y0, x1, y1 = field_box_px(spec, frame, gray.shape)
    base = gray[y0:y1, x0:x1]
    if spec.scale != 1.0:
        base = cv2.resize(base, None, fx=spec.scale, fy=spec.scale, interpolation=cv2.INTER_CUBIC)
    if spec.type in ("amount", "digits", "date"):
        # 拡大(2x)も試したが、数字で誤読が増えたため、数字欄では既定では使わない
        return [base, despeckle(base)]
    m = FRAME_UNITS * 0.004
    wide = FieldSpec(spec.id, spec.label, (spec.box[0] - m, spec.box[1] - m, spec.box[2] + m, spec.box[3] + m))
    ex0, ey0, ex1, ey1 = field_box_px(wide, frame, gray.shape)
    otsu = cv2.threshold(base, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    return [base, gray[ey0:ey1, ex0:ex1], otsu]


_EDGE_NOISE = re.compile(r"^[\s.。,，'\"‘’`´・|]+|[\s.。,，'\"‘’`´・|]+$")


def _read_once(img: np.ndarray, spec: FieldSpec, cfg: dict, dpi: int, tessdata_dir: str | None = None,
               lang: str | None = None) -> tuple[str, float | None]:
    img = cv2.copyMakeBorder(img, 25, 25, 25, 25, cv2.BORDER_CONSTANT, value=255)  # 余白がないと端の文字を落とす
    lang = lang or spec.lang or cfg["ocr"]["language"]
    page = engine.recognize_with(img, lang, spec.psm, dpi, cfg["ocr"]["timeout_sec"], cfg["ocr"]["remove_cjk_spaces"],
                                 tessdata_dir=tessdata_dir)
    conf = page.mean_conf
    if spec.type in ("amount", "digits", "date"):
        # 数字欄は、¥や円やゴミ点など数字以外の断片の信頼度を除き、数字を含む単語だけで信頼度を出す
        ws = [w for ln in page.lines for w in ln.words if re.search(r"[0-9OoＯ０-９]", w.text)]
        if ws:
            conf = sum(w.conf * len(w.text) for w in ws) / sum(len(w.text) for w in ws)
    return page.text.replace("\n\n", "\n").strip(), conf


def _interpret(text: str, spec: FieldSpec):
    """読み取り文字列を型に応じた値にする。"""
    if spec.type == "amount":
        return parse_amount(text)
    if spec.type == "digits":
        v = normalize_digits(text, spec.keep)
        return v or None
    if spec.type == "date":
        return parse_date_jp(text)
    return _EDGE_NOISE.sub("", text) or None  # 文字列は、前後に付いたゴミ点などの記号を除く


def read_field(gray: np.ndarray, spec: FieldSpec, frame: tuple[int, int, int], cfg: dict, dpi: int) -> FieldResult:
    """1項目を、複数の読み方（画像の加工 × 言語データ）で読み、多数決で採用する。"""
    box = field_box_px(spec, frame, gray.shape)
    x0, y0, x1, y1 = box
    if x1 - x0 < 8 or y1 - y0 < 8:
        return FieldResult(spec.id, spec.label, "", None, None, spec.handwritten,
                           ["項目の範囲が画像の外です（枠の検出位置がずれた可能性）"], None, box)
    variants = [_variants(gray, spec, frame)[0]] if spec.handwritten else _variants(gray, spec, frame)
    # 読み方 = (言語データの場所, 言語)。数字・金額は、日本語モデルが 8→6 のように誤読することがあるため、
    # 英語モデル(eng)でも読んで多数決にする（実サンプルと合成帳票で、engのほうが数字は正確なことを確認）
    readers: list[tuple[str | None, str | None]] = [(None, None)]
    if spec.type in ("amount", "digits") and not spec.lang and "eng" in engine.available_languages():
        readers.append((None, "eng"))
    if cfg["ocr"].get("second_tessdata_dir"):
        readers.append((cfg["ocr"]["second_tessdata_dir"], None))
    cands = []  # (text, value, conf)
    for v in variants:
        for md, lg in readers:
            text, conf = _read_once(v, spec, cfg, dpi, md, lg)
            cands.append((text, _interpret(text, spec), conf or 0.0))
    crop = gray[y0:y1, x0:x1]
    valid = [c for c in cands if c[1] is not None]
    readings = [(t, v, c) for t, v, c in cands]
    if not valid:
        best = max(cands, key=lambda c: c[2])
        return FieldResult(spec.id, spec.label, best[0], None, best[2] if best[0] else None, spec.handwritten,
                           ["読み取れませんでした"] if not best[0] else ["値として解釈できません"], crop, box, readings)
    if spec.type == "text":
        # 文字列は、各読み方が他の読み方とどれだけ似ているか（平均類似度）が最大のもの＝「みんなに一番近い」ものを採用する。
        # 1文字違いの読み方が割れても、外れ値（例: 株→折）に引きずられない
        norm = [normalize_text(str(v)) for _, v, _ in valid]
        def agree(i: int) -> float:
            others = [difflib.SequenceMatcher(None, norm[i], norm[j]).ratio() for j in range(len(valid)) if j != i]
            return sum(others) / len(others) if others else 1.0
        scores = [agree(i) for i in range(len(valid))]
        bi = max(range(len(valid)), key=lambda i: (round(scores[i], 4), valid[i][2]))
        text, value, conf = valid[bi]
        agreement = scores[bi]
        n_same = sum(1 for n in norm if n == norm[bi])
    else:
        # 数字・金額・日付は、同じ値が最も多い読み方を採用する（同数なら信頼度の高いもの）
        votes: dict = {}
        for t, v, c in valid:
            votes.setdefault(v, []).append((t, v, c))
        best_key = max(votes, key=lambda k: (len(votes[k]), max(c for _, _, c in votes[k])))
        text, value, conf = max(votes[best_key], key=lambda x: x[2])
        agreement = len(votes[best_key]) / len(valid)
        n_same = len(votes[best_key])
    problems: list[str] = []
    # 揺れの判定: 文字列は類似度が0.9未満のとき（1文字違い程度なら問題にしない）、数字は値が割れたとき
    if (spec.type == "text" and agreement < 0.9) or (spec.type != "text" and agreement < 0.6):
        problems.append(f"読み取り方によって結果が揺れました（{n_same}/{len(cands)}件が同じ）")
    if spec.choices and isinstance(value, str):
        # 選択肢のうち最も近いものに補正する（似ていなければそのまま）
        nv = normalize_text(value)
        best = max(spec.choices, key=lambda c: difflib.SequenceMatcher(None, nv, normalize_text(c)).ratio())
        if difflib.SequenceMatcher(None, nv, normalize_text(best)).ratio() >= 0.6:
            if best != value:
                text, value = best, best
        else:
            problems.append(f"選択肢（{' / '.join(spec.choices)}）のどれにも似ていません")
    if spec.pattern and not re.fullmatch(spec.pattern, str(value) if not isinstance(value, tuple) else "-".join(map(str, value))):
        problems.append(f"形式が想定と違います（期待: {spec.pattern}、読み取り: {value}）")
    return FieldResult(spec.id, spec.label, text, value, conf, spec.handwritten, problems, crop, box, readings,
                       spec.type == "text")


def read_form(image: np.ndarray, tpl: Template, cfg: dict, dpi: int) -> tuple[list[FieldResult], tuple[int, int, int], float]:
    """1ページの帳票画像から全項目を読み取る。(項目結果, 枠, 補正した傾き) を返す。"""
    pp = {"enabled": True, "grayscale": True, "deskew": True, "denoise": "none", "flatten": True, "binarize": "none"}
    pp.update(tpl.preprocess)
    img, applied = preprocess.preprocess(image, pp)
    gray = preprocess.to_gray(img)
    frame = detect_frame(gray)
    results = [read_field(gray, f, frame, cfg, dpi) for f in tpl.fields]
    return results, frame, applied.get("deskew_deg", 0.0)
