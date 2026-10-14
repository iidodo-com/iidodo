"""PDF Studio: 画面(ブラウザ) と コマンドの両対応。

  python app.py                       画面を起動 (http://127.0.0.1:8765)
  python app.py convert a.docx b.xlsx   それぞれPDFにする
  python app.py merge -o all.pdf a.docx b.xlsx c.pptx d.pdf
  python app.py edit in.pdf out.pdf rotate pages=1-2 angle=90
  python app.py split in.pdf outdir [1-3;4-]
"""
from __future__ import annotations

import json
import re
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

HERE = Path(__file__).parent
MAX_UPLOAD = 500 * 1024 * 1024
ID_RE = re.compile(r"[0-9a-f]{32}")


class Store:
    """アップロード/結果ファイルの一時置き場。終了時に全削除。"""

    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="pdfstudio_"))
        self.names: dict[str, str] = {}
        self.lock = threading.Lock()

    def path(self, fid: str) -> Path:
        if not ID_RE.fullmatch(fid or "") or fid not in self.names:
            raise core.PdfStudioError("ファイルが見つかりません(期限切れの可能性があります)")
        return self.dir / fid

    def put(self, data: bytes | None, name: str) -> str:
        fid = uuid.uuid4().hex
        with self.lock:
            self.names[fid] = name
        if data is not None:
            (self.dir / fid).write_bytes(data)
        return fid

    def with_suffix(self, fid: str) -> Path:
        """拡張子つきの作業コピー(変換器が拡張子で形式を判断するため)。"""
        p = self.path(fid)
        q = self.dir / (fid + Path(self.names[fid]).suffix.lower())
        if not q.exists():
            shutil.copyfile(p, q)
        return q

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


STORE = Store()


def _safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\r\n]', "_", name).strip() or "file"


class Handler(BaseHTTPRequestHandler):
    server_version = "PDFStudio"

    def log_message(self, *a):  # 静かに
        pass

    # ---- 共通
    def _ok_host(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        origin = self.headers.get("Origin")  # 他サイトのページからの操作を拒否
        if origin and urlparse(origin).hostname not in ("127.0.0.1", "localhost"):
            return False
        return host in ("127.0.0.1", "localhost")

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

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
            if u.path == "/api/status":
                return self._json({"office": bool(core.find_soffice()),
                                   "exts": sorted(core.SUPPORTED_EXTS)})
            m = re.fullmatch(r"/api/(file|info|thumb)/([0-9a-f]{32})(?:/(\d+))?", u.path)
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
                    return self._json(core.info(p, (q.get("pw") or [None])[0]))
                dpi = min(max(int((q.get("dpi") or ["50"])[0]), 20), 200)
                png = core.render_pages(p, dpi=dpi, first=int(pg), last=int(pg))
                return self._send(200, png[0], "image/png")
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
                src = STORE.with_suffix(fid)
                out = STORE.put(None, Path(STORE.names[fid]).stem + ".pdf")
                core.to_pdf(src, STORE.dir / out)
                return self._json({"id": out, "name": STORE.names[out]})
            if u.path == "/api/merge":
                ids = req["ids"]
                srcs = []
                for fid in ids:
                    q = STORE.with_suffix(fid)
                    srcs.append(q)
                name = _safe_name(req.get("name") or "結合.pdf")
                if not name.lower().endswith(".pdf"):
                    name += ".pdf"
                out = STORE.put(None, name)
                # ブックマーク名に元のファイル名を使うため、名前を戻したコピーで結合
                with tempfile.TemporaryDirectory() as td:
                    named = []
                    for i, fid in enumerate(ids):
                        d = Path(td, str(i)); d.mkdir()
                        t = d / STORE.names[fid]
                        shutil.copyfile(STORE.path(fid), t)
                        named.append(t)
                    pw = {STORE.names[f]: p for f, p in (req.get("passwords") or {}).items() if f in STORE.names}
                    core.merge(named, STORE.dir / out, pw, bookmarks=req.get("bookmarks", True))
                return self._json({"id": out, "name": name, "info": core.info(STORE.dir / out)})
            if u.path == "/api/edit":
                fid = req["id"]
                out = STORE.put(None, STORE.names[fid])
                core.edit(STORE.path(fid), STORE.dir / out, req["op"], req.get("params"), req.get("password"))
                return self._json({"id": out, "name": STORE.names[out],
                                   "info": core.info(STORE.dir / out, (req.get("params") or {}).get("new_password"))})
            if u.path == "/api/split":
                fid = req["id"]
                with tempfile.TemporaryDirectory() as td:
                    parts = core.split(STORE.path(fid), td, req.get("ranges"), req.get("password"))
                    zid = STORE.put(None, Path(STORE.names[fid]).stem + "_分割.zip")
                    with zipfile.ZipFile(STORE.dir / zid, "w", zipfile.ZIP_DEFLATED) as z:
                        for p in parts:
                            z.write(p, p.name)
                return self._json({"id": zid, "name": STORE.names[zid], "count": len(parts)})
            self._send(404, b"not found", "text/plain")
        except KeyError as e:
            self._fail(core.PdfStudioError(f"必要な項目がありません: {e}"))
        except Exception as e:
            self._fail(e)


def serve(port: int = 8765, open_browser: bool = True):
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)  # 自分のPCからのみ
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
