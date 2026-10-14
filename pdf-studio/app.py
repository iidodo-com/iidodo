"""PDF Studio: 画面(ブラウザ) と コマンドの両対応。

  python app.py                       画面を起動 (http://127.0.0.1:8765)
  python app.py convert a.docx b.xlsx   それぞれPDFにする
  python app.py merge -o all.pdf a.docx b.xlsx c.pptx d.pdf
  python app.py edit in.pdf out.pdf rotate pages=1-2 angle=90
  python app.py split in.pdf outdir [1-3;4-]
"""
from __future__ import annotations

import json
import os
import re
from concurrent.futures import Future, ThreadPoolExecutor
import shutil
import sys
import tempfile
import threading
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import core

HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))  # exe化時は展開先
MAX_UPLOAD = 500 * 1024 * 1024
ID_RE = re.compile(r"[0-9a-f]{32}")


class Store:
    """アップロード/結果ファイルの一時置き場。終了時に全削除。

    - Office/画像/テキストはアップロード直後に裏でPDF化を始める(結合ボタンの頃には終わっている)。
    - 各バージョンの「ページごとの出どころ(tag)」を覚えて、編集していないページは
      サムネイル/プレビュー/文字情報を作り直さずに再利用する。
    """

    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="pdfstudio_"))
        self.names: dict[str, str] = {}
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=4)
        self.conv: dict[str, Future] = {}
        self.tags: dict[str, list] = {}       # fid -> [[元fid, 元ページ], ...]
        self.pw: dict[str, str] = {}          # パスワード付きの結果の閲覧用
        self.img_cache: dict[tuple, bytes] = {}
        self.text_cache: dict[tuple, dict] = {}
        self.render_lock = threading.Lock()

    def path(self, fid: str) -> Path:
        if not ID_RE.fullmatch(fid or "") or fid not in self.names:
            raise core.PdfStudioError("ファイルが見つかりません(期限切れの可能性があります)")
        return self.dir / (fid + Path(self.names[fid]).suffix.lower())

    def put(self, data: bytes | None, name: str) -> str:
        fid = uuid.uuid4().hex
        with self.lock:
            self.names[fid] = name
        if data is not None:
            self.path(fid).write_bytes(data)
            if Path(name).suffix.lower() != ".pdf":
                self.conv[fid] = self.pool.submit(self._convert, fid)
        return fid

    def _convert(self, fid: str) -> Path:
        out = self.dir / (fid + ".conv.pdf")
        core.to_pdf(self.path(fid), out)
        return out

    def pdf_for(self, fid: str) -> Path:
        """そのファイルのPDF版(変換済みを待って返す。PDFならそのまま)。"""
        p = self.path(fid)
        if fid in self.conv:
            return self.conv[fid].result()
        return p

    def tags_of(self, fid: str) -> list:
        t = self.tags.get(fid)
        if t is None:
            n = core.info(self.path(fid), self.pw.get(fid))["pages"]
            t = self.tags[fid] = [[fid, i + 1] for i in range(n)]
        return t

    def derive(self, parent: str, new: str, op: str, params: dict) -> None:
        """編集で変わらなかったページは、元のページの tag を引き継ぐ。"""
        try:
            old = self.tags_of(parent)
            m, changed = page_effect(op, params or {}, len(old))
            n = core.info(self.path(new), self.pw.get(new))["pages"]
            if len(m) != n:
                raise ValueError
            self.tags[new] = [old[j] if (j is not None and i not in changed) else [new, i + 1]
                              for i, j in enumerate(m)]
        except Exception:
            self.tags.pop(new, None)   # 不明なら全ページ作り直し(tags_of が新規に作る)

    def image(self, fid: str, page: int, dpi: int) -> bytes:
        key = (fid, page, dpi)
        b = self.img_cache.get(key)
        if b is None:
            with self.render_lock:
                b = self.img_cache.get(key)
                if b is None:
                    b = core.render_pages(self.path(fid), dpi=dpi, first=page, last=page,
                                          password=self.pw.get(fid))[0]
                    if len(self.img_cache) > 3000:
                        self.img_cache.clear()
                    self.img_cache[key] = b
        return b

    def close(self):
        self.pool.shutdown(wait=False, cancel_futures=True)
        core.close_pdfium()
        shutil.rmtree(self.dir, ignore_errors=True)


def page_effect(op: str, params: dict, n: int):
    """編集後の各ページが、編集前のどのページと同じ内容か(None=新規)と、内容が変わったページ(新ページ番号, 0始まり)。"""
    ident = list(range(n))
    pg = lambda spec: set(core.parse_pages(spec, n))
    if op in ("metadata", "compress", "encrypt", "decrypt"):
        return ident, set()
    if op == "rotate":
        return ident, pg(params.get("pages", "all"))
    if op in ("add_text", "rect"):
        return ident, {int(params["page"]) - 1}
    if op == "edit_text":
        return ident, {int(i["page"]) - 1 for i in params["items"]}
    if op in ("watermark", "page_numbers", "replace_text"):
        return ident, pg(params.get("pages", "all"))
    if op == "delete":
        gone = pg(params["pages"])
        return [i for i in ident if i not in gone], set()
    if op == "arrange":
        return core.parse_pages(params["pages"], n), set()
    if op == "insert_blank":
        after, cnt = int(params.get("after", 0)), int(params.get("count", 1))
        return ident[:after] + [None] * cnt + ident[after:], set()
    return [None] * n, set()


STORE = Store()


def _safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\r\n]', "_", name).strip() or "file"


class Handler(BaseHTTPRequestHandler):
    server_version = "PDFStudio"
    protocol_version = "HTTP/1.1"      # 接続を使い回す(Windowsでは1回ごとの接続が遅い)
    wbufsize = 1 << 16                 # ヘッダと本文を1回で送る
    disable_nagle_algorithm = True

    def log_message(self, *a):  # 静かに
        pass

    # ---- 共通
    def _ok_host(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        origin = self.headers.get("Origin")  # 他サイトのページからの操作を拒否
        if origin and urlparse(origin).hostname not in ("127.0.0.1", "localhost"):
            return False
        return host in ("127.0.0.1", "localhost")

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8", extra=None, cache=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # 画像・文字情報は中身が変わらないID/ページ単位なので、ブラウザに覚えさせて再取得を省く
        self.send_header("Cache-Control", "private, max-age=86400, immutable" if cache else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _info(self, fid: str) -> dict:
        i = core.info(STORE.path(fid), STORE.pw.get(fid))
        i["tags"] = STORE.tags_of(fid) if i["pages"] else []
        return i

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode())

    def _fail(self, e: Exception):
        if isinstance(e, core.PdfStudioError):
            self._json({"error": str(e)}, 400)
        else:
            self._json({"error": f"想定外のエラー: {type(e).__name__}: {e}"}, 500)

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise core.PdfStudioError("ファイルが大きすぎます(上限 500MB)")
        return self.rfile.read(n)

    # ---- GET
    def do_GET(self):
        if not self._ok_host():
            return self._send(403, b"forbidden", "text/plain")
        u = urlparse(self.path)
        try:
            if u.path in ("/", "/index.html"):
                return self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
            if u.path == "/api/state":
                st = {}
                for fid, fut in list(STORE.conv.items()):
                    if not fut.done():
                        st[fid] = {"state": "converting"}
                    elif fut.exception():
                        e = fut.exception()
                        st[fid] = {"state": "error", "error": str(e) if isinstance(e, core.PdfStudioError) else f"{type(e).__name__}: {e}"}
                    else:
                        st[fid] = {"state": "ready"}
                return self._json({"files": st})
            if u.path == "/api/status":
                return self._json({"office": bool(core.find_soffice()),
                                   "exts": sorted(core.SUPPORTED_EXTS)})
            m = re.fullmatch(r"/api/(file|info|thumb|text)/([0-9a-f]{32})(?:/(\d+))?", u.path)
            if m:
                kind, fid, pg = m.groups()
                p = STORE.path(fid)
                q = parse_qs(u.query)
                if kind == "file":
                    name = _safe_name(STORE.names[fid])
                    ctype = "application/pdf" if p.read_bytes()[:4] == b"%PDF" else "application/octet-stream"
                    if q.get("inline"):
                        return self._send(200, p.read_bytes(), ctype)
                    from urllib.parse import quote
                    return self._send(200, p.read_bytes(), ctype, {
                        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})
                if kind == "info":
                    return self._json(self._info(fid))
                if kind == "text":
                    key = (fid, int(pg))
                    if key not in STORE.text_cache:
                        STORE.text_cache[key] = core.text_segments(p, int(pg), STORE.pw.get(fid))
                    return self._send(200, json.dumps(STORE.text_cache[key], ensure_ascii=False).encode(),
                                      cache=True)
                dpi = min(max(int((q.get("dpi") or ["50"])[0]), 20), 220)
                return self._send(200, STORE.image(fid, int(pg), dpi), "image/jpeg", cache=True)
            self._send(404, b"not found", "text/plain")
        except Exception as e:
            self._fail(e)

    # ---- POST
    def do_POST(self):
        if not self._ok_host():
            return self._send(403, b"forbidden", "text/plain")
        u = urlparse(self.path)
        try:
            if u.path == "/api/upload":
                name = _safe_name(unquote(self.headers.get("X-Filename", "file")))
                if Path(name).suffix.lower() not in core.SUPPORTED_EXTS:
                    raise core.PdfStudioError(f"対応していない形式です: {name}")
                fid = STORE.put(self._body(), name)
                return self._json({"id": fid, "name": name})
            req = json.loads(self._body() or b"{}")
            if u.path == "/api/convert":
                fid = req["id"]
                out = STORE.put(None, Path(STORE.names[fid]).stem + ".pdf")
                shutil.copyfile(STORE.pdf_for(fid), STORE.path(out))
                return self._json({"id": out, "name": STORE.names[out]})
            if u.path == "/api/merge":
                ids = req["ids"]
                name = _safe_name(req.get("name") or "結合.pdf")
                if not name.lower().endswith(".pdf"):
                    name += ".pdf"
                out = STORE.put(None, name)
                # 変換済みPDFを元の名前(拡張子だけ.pdf)で並べて結合 → しおり名が元のファイル名になる
                with tempfile.TemporaryDirectory() as td:
                    named = []
                    for i, fid in enumerate(ids):
                        d = Path(td, str(i)); d.mkdir()
                        t = d / (Path(STORE.names[fid]).stem + ".pdf")
                        pdf = STORE.pdf_for(fid)
                        try:
                            os.link(pdf, t)  # コピーせずリンク(同一ドライブなら瞬時)
                        except OSError:
                            shutil.copyfile(pdf, t)
                        named.append(t)
                    pw = {Path(STORE.names[f]).stem + ".pdf": p
                          for f, p in (req.get("passwords") or {}).items() if f in STORE.names}
                    core.merge(named, STORE.path(out), pw, bookmarks=req.get("bookmarks", True))
                return self._json({"id": out, "name": name, "info": self._info(out)})
            if u.path == "/api/edit":
                fid = req["id"]
                out = STORE.put(None, STORE.names[fid])
                params = req.get("params") or {}
                core.edit(STORE.path(fid), STORE.path(out), req["op"], params,
                          req.get("password") or STORE.pw.get(fid))
                if req["op"] == "encrypt":
                    STORE.pw[out] = params.get("new_password")
                STORE.derive(fid, out, req["op"], params)
                return self._json({"id": out, "name": STORE.names[out], "info": self._info(out)})
            if u.path == "/api/split":
                fid = req["id"]
                with tempfile.TemporaryDirectory() as td:
                    parts = core.split(STORE.path(fid), td, req.get("ranges"), req.get("password"))
                    zid = STORE.put(None, Path(STORE.names[fid]).stem + "_分割.zip")
                    with zipfile.ZipFile(STORE.path(zid), "w", zipfile.ZIP_DEFLATED) as z:
                        for p in parts:
                            z.write(p, p.name)
                return self._json({"id": zid, "name": STORE.names[zid], "count": len(parts)})
            self._send(404, b"not found", "text/plain")
        except KeyError as e:
            self._fail(core.PdfStudioError(f"必要な項目がありません: {e}"))
        except Exception as e:
            self._fail(e)


def serve(port: int = 8765, open_browser: bool = True):
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer.request_queue_size = 64
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)  # 自分のPCからのみ
    threading.Thread(target=core.warm_up, daemon=True).start()   # 初回操作を速くする下準備
    url = f"http://127.0.0.1:{port}/"
    print(f"PDF Studio: {url}  (終了は Ctrl+C)")
    if not core.find_soffice():
        print("注意: LibreOffice が見つかりません。Word/Excel/PowerPoint のPDF化はできません。")
    if open_browser:
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STORE.close()


def _coerce(v: str):
    try:
        return json.loads(v)
    except ValueError:
        return v


def cli(argv: list[str]) -> int:
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd == "convert":
            for s in rest:
                out = Path(s).with_suffix(".pdf")
                if out.resolve() == Path(s).resolve():
                    print(f"スキップ(すでにPDF): {s}")
                    continue
                core.to_pdf(s, out)
                print(f"{s} -> {out}")
        elif cmd == "merge":
            if "-o" not in rest or rest.index("-o") + 1 >= len(rest):
                raise core.PdfStudioError("出力先を -o で指定してください")
            i = rest.index("-o")
            out = rest[i + 1]
            srcs = rest[:i] + rest[i + 2:]
            core.merge(srcs, out)
            print(f"{len(srcs)} 件 -> {out} ({core.info(out)['pages']} ページ)")
        elif cmd == "edit":
            src, dst, op, *kv = rest
            params = {k: _coerce(v) for k, v in (a.split("=", 1) for a in kv)}
            pw = params.pop("password", None)
            core.edit(src, dst, op, params, pw)
            print(f"{op}: {dst}")
        elif cmd == "split":
            outs = core.split(rest[0], rest[1], rest[2] if len(rest) > 2 else None)
            print(f"{len(outs)} ファイルに分割: {rest[1]}")
        else:
            print(__doc__)
            return 2
    except core.PdfStudioError as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 1
    except (ValueError, IndexError):
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        sys.exit(cli(sys.argv[1:]))
    port = 8765
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    serve(port, open_browser="--no-browser" not in sys.argv)
