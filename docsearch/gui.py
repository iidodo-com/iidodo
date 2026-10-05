"""簡易GUI（tkinter）。検索・絞り込み・結果一覧・スニペットの強調・ダブルクリックで開く・CSV保存。

GUIを開く・検索する操作は、index.db と対象ファイルを読み取るだけで、変更しない。
既定では、ダブルクリックは「読み取り専用の一時コピー」を開く（元ファイルを開くと Word/Excel が
同じフォルダにロックファイルを作ることがあるため）。一時コピーは終了時と次回起動時に削除する。
"""
import os
import queue
import sys
import threading

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError:  # tkinter が無い環境
    print("エラー: tkinter を読み込めません。Python の標準インストーラで「tcl/tk and IDLE」を含めてインストールしてください。", file=sys.stderr)
    raise SystemExit(3)

from core import db, opener
from core.config import ConfigError, load_config
from core.export import write_results_csv
from core.query import QueryError
from core.searcher import build_options, folder_to_relative, search

HERE = os.path.dirname(os.path.abspath(__file__))
NOTICE = "index.db は文書の本文を含みます。元文書と同等に扱ってください。スニペットは正規化後の文字（㈱→(株)、全角英数字→半角 等）で表示されるため、引用は元ファイルで確認してください。"


class App:
    """検索画面。検索は別スレッドで実行し、画面が固まらないようにする。"""

    def __init__(self, root, cfg):
        """画面を組み立てる。"""
        self.root, self.cfg = root, cfg
        self.results, self.q = [], queue.Queue()
        root.title("過去資料の全文検索（読み取り専用）")
        root.geometry("1100x700")
        top = ttk.Frame(root, padding=6)
        top.pack(fill="x")
        self.query = tk.StringVar()
        ttk.Label(top, text="検索語").grid(row=0, column=0, sticky="w")
        e = ttk.Entry(top, textvariable=self.query, width=60)
        e.grid(row=0, column=1, columnspan=5, sticky="we", padx=4)
        e.bind("<Return>", lambda _e: self.start_search())
        e.focus_set()
        self.btn = ttk.Button(top, text="検索", command=self.start_search)
        self.btn.grid(row=0, column=6, padx=4)
        ttk.Button(top, text="CSV保存", command=self.save_csv).grid(row=0, column=7)
        ttk.Label(top, text="（スペース=AND、\"…\"=フレーズ、-語=除外）").grid(row=1, column=1, columnspan=5, sticky="w")
        self.ext_vars = {x: tk.BooleanVar(value=True) for x in ("docx", "xlsx", "pptx", "pdf")}
        ttk.Label(top, text="拡張子").grid(row=2, column=0, sticky="w")
        extf = ttk.Frame(top)
        extf.grid(row=2, column=1, columnspan=5, sticky="w")
        for x, v in self.ext_vars.items():
            ttk.Checkbutton(extf, text=x, variable=v).pack(side="left", padx=(0, 12))
        self.folder, self.since, self.until = tk.StringVar(), tk.StringVar(), tk.StringVar()
        ttk.Label(top, text="フォルダ").grid(row=3, column=0, sticky="w")
        ff = ttk.Frame(top)
        ff.grid(row=3, column=1, columnspan=2, sticky="we", padx=4)
        ttk.Entry(ff, textvariable=self.folder, width=24).pack(side="left", fill="x", expand=True)
        ttk.Button(ff, text="選択…", command=self.choose_folder).pack(side="left", padx=(4, 0))
        ttk.Button(ff, text="解除", command=lambda: self.folder.set("")).pack(side="left", padx=(4, 0))
        ttk.Label(top, text="更新日 (YYYY-MM-DD)").grid(row=3, column=3, sticky="e")
        ttk.Entry(top, textvariable=self.since, width=12).grid(row=3, column=4)
        ttk.Label(top, text="～").grid(row=3, column=5)
        ttk.Entry(top, textvariable=self.until, width=12).grid(row=3, column=6)
        self.sort = tk.StringVar(value="relevance")
        ttk.Label(top, text="並び順").grid(row=4, column=0, sticky="w")
        ttk.Radiobutton(top, text="関連度(bm25)", variable=self.sort, value="relevance").grid(row=4, column=1, sticky="w")
        ttk.Radiobutton(top, text="更新日の新しい順", variable=self.sort, value="date").grid(row=4, column=2, columnspan=2, sticky="w")
        self.place = tk.BooleanVar(value=False)
        ttk.Checkbutton(top, text="同じ場所内で全語を含む（オフ=ファイル内のどこかに含む）", variable=self.place).grid(row=4, column=4, columnspan=4, sticky="w")
        top.columnconfigure(1, weight=1)

        mid = ttk.PanedWindow(root, orient="vertical")
        mid.pack(fill="both", expand=True, padx=6)
        cols = ("name", "loc", "mtime", "snippet")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")
        for c, t, w in (("name", "ファイル名", 250), ("loc", "場所", 200), ("mtime", "更新日", 135), ("snippet", "スニペット", 500)):
            self.tree.heading(c, text=t)
            self.tree.column(c, width=w, anchor="w")
        sb = ttk.Scrollbar(self.tree, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", lambda _e: self.open_selected())
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self.show_detail())
        mid.add(self.tree, weight=3)
        det = ttk.Frame(mid)
        self.detail = tk.Text(det, height=7, wrap="word")
        self.detail.tag_configure("hit", background="#ffe066", foreground="black")
        self.detail.pack(fill="both", expand=True)
        self.detail.configure(state="disabled")
        mid.add(det, weight=1)
        bar = ttk.Frame(root, padding=4)
        bar.pack(fill="x")
        ttk.Button(bar, text="開く", command=self.open_selected).pack(side="left")
        ttk.Button(bar, text="フォルダを開く", command=self.reveal_selected).pack(side="left", padx=4)
        ttk.Button(bar, text="パスをコピー", command=self.copy_path).pack(side="left")
        self.status = tk.StringVar(value="検索語を入力してください。")
        ttk.Label(root, textvariable=self.status, foreground="#333").pack(fill="x", padx=8)
        roots_text = "検索対象フォルダ（config.toml の roots）: " + "、".join(self.cfg.roots)
        dummy = any("ダミー" in r for r in self.cfg.roots)
        ttk.Label(root, text=roots_text + ("  ← サンプルのダミーパスのままです。config.toml を書き換えて、更新.bat を実行してください" if dummy else ""),
                  foreground="#a00" if dummy else "#333", wraplength=1060).pack(fill="x", padx=8)
        ttk.Label(root, text=NOTICE, foreground="#a00", wraplength=1060).pack(fill="x", padx=8, pady=(0, 6))
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(100, self.poll)

    def form_options(self):
        """画面の入力から SearchOptions を作る（日付や拡張子の誤りは QueryError）。"""
        exts = ",".join(x for x, v in self.ext_vars.items() if v.get())
        if not exts:
            raise QueryError("拡張子が1つも選ばれていません。少なくとも1つ選んでください。")
        all4 = len(exts.split(",")) == 4
        return build_options("" if all4 else exts, self.folder.get(), self.since.get(), self.until.get(), 50,
                             self.sort.get(), "place" if self.place.get() else "file", self.cfg.snippet_chars, self.cfg.roots)

    def choose_folder(self):
        """検索対象フォルダの中から、絞り込むフォルダをダイアログで選ぶ（選択は読み取りだけで、何も変更しない）。"""
        start = next((r for r in self.cfg.roots if os.path.isdir(r)), HERE)
        cur = self.folder.get().strip()
        if cur and os.path.isdir(os.path.join(start, *cur.replace("\\", "/").split("/"))):
            start = os.path.join(start, *cur.replace("\\", "/").split("/"))
        path = filedialog.askdirectory(initialdir=start, mustexist=True, title="検索するフォルダを選択（検索対象フォルダの中）")
        if not path:
            return
        try:
            rel = folder_to_relative(os.path.normpath(path), self.cfg.roots)
        except QueryError as e:
            messagebox.showerror("選べません", str(e))
            return
        self.folder.set(rel)
        self.status.set("検索するフォルダ: %s" % (rel or "（検索対象フォルダ全体）"))

    def start_search(self):
        """検索を別スレッドで開始する。"""
        try:
            opts = self.form_options()
        except QueryError as e:
            self.status.set("入力エラー: %s" % e)
            return
        self.btn.configure(state="disabled")
        self.status.set("検索中…（3文字未満の語だけの検索は、全件走査のため時間がかかる場合があります）")
        raw = self.query.get()
        threading.Thread(target=self.worker, args=(raw, opts), daemon=True).start()

    def worker(self, raw, opts):
        """検索スレッド本体。DBは読み取り専用で、このスレッド内で開いて閉じる。"""
        try:
            conn = db.connect_ro(self.cfg.db_path)
            try:
                self.q.put(("ok", search(conn, raw, opts)))
            finally:
                conn.close()
        except (QueryError, db.DbError) as e:
            self.q.put(("err", str(e)))
        except Exception as e:  # 想定外でも画面は落とさない
            self.q.put(("err", "想定外のエラー: %s: %s" % (type(e).__name__, e)))

    def poll(self):
        """検索スレッドの結果を受け取って画面に反映する。"""
        try:
            kind, val = self.q.get_nowait()
        except queue.Empty:
            self.root.after(100, self.poll)
            return
        self.btn.configure(state="normal")
        if kind == "err":
            self.status.set("検索できません: %s" % val)
        else:
            self.show_results(val)
        self.root.after(100, self.poll)

    def show_results(self, res):
        """検索結果を一覧に表示する。"""
        self.results = res.results
        self.tree.delete(*self.tree.get_children())
        for i, r in enumerate(res.results):
            more = "（ほか%d箇所）" % (r.place_hits - 1) if r.place_hits > 1 and not self.place.get() else ""
            self.tree.insert("", "end", iid=str(i), values=(r.name, r.location + more, r.mtime_text, r.snippet))
        msg = "該当 %d 件中 %d 件を表示（並び順: %s）" % (res.total, len(res.results), "関連度(bm25)" if res.sort_used == "relevance" else "更新日の新しい順")
        self.status.set(msg + "".join(" ／ " + n for n in res.notices))
        self.set_detail("")

    def selected(self):
        """選択中の結果。無ければ None。"""
        sel = self.tree.selection()
        return self.results[int(sel[0])] if sel else None

    def set_detail(self, text, spans=()):
        """下部の詳細欄に、検索語を強調してスニペットを表示する。"""
        self.detail.configure(state="normal")
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", text)
        for a, b in spans:
            self.detail.tag_add("hit", "1.0+%dc" % a, "1.0+%dc" % b)
        self.detail.configure(state="disabled")

    def show_detail(self):
        """選択した結果のパス・場所・スニペットを詳細欄に表示する。"""
        r = self.selected()
        if r:
            head = "%s\n場所: %s\n\n" % (r.fullpath, r.location)
            self.set_detail(head + r.snippet, [(a + len(head), b + len(head)) for a, b in r.spans])

    def open_selected(self):
        """選択した結果のファイルを既定のアプリで開く（既定は読み取り専用の一時コピー）。"""
        r = self.selected()
        if not r:
            return
        try:
            opener.open_file(r.fullpath, self.cfg.open_mode)
            if self.cfg.open_mode == "copy":
                self.status.set("読み取り専用の一時コピーを開きました（元ファイルは変更されません。編集内容は元に反映されません）。")
        except OSError as e:
            messagebox.showerror("開けません", str(e))

    def reveal_selected(self):
        """選択した結果のフォルダを開く。"""
        r = self.selected()
        if r:
            try:
                opener.reveal_folder(r.fullpath)
            except OSError as e:
                messagebox.showerror("開けません", str(e))

    def copy_path(self):
        """選択した結果のフルパスをクリップボードにコピーする。"""
        r = self.selected()
        if r:
            self.root.clipboard_clear()
            self.root.clipboard_append(r.fullpath)
            self.status.set("パスをコピーしました: %s" % r.fullpath)

    def save_csv(self):
        """現在の検索結果をCSVに保存する。"""
        if not self.results:
            messagebox.showinfo("CSV保存", "保存する検索結果がありません。先に検索してください。")
            return
        path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")],
                                            initialdir=self.cfg.output_dir if os.path.isdir(self.cfg.output_dir) else HERE,
                                            initialfile="検索結果.csv")
        if path:
            try:
                write_results_csv(self.results, path)
                self.status.set("CSVを保存しました: %s" % path)
            except OSError as e:
                messagebox.showerror("保存できません", "CSVを保存できません（%s）。保存先・権限・ファイルが開かれていないかを確認してください。" % e)

    def close(self):
        """終了時に一時コピーを削除して閉じる。"""
        opener.cleanup_temp()
        self.root.destroy()


def main():
    """GUIを起動する。環境・設定・index.db に問題があれば、日本語のメッセージを出して終了する。"""
    root = tk.Tk()
    root.withdraw()
    try:
        db.check_environment()
        cfg = load_config(os.environ.get("DOCSEARCH_CONFIG", os.path.join(HERE, "config.toml")))
        db.connect_ro(cfg.db_path).close()
    except (db.EnvError, ConfigError, db.DbError) as e:
        messagebox.showerror("起動できません", str(e))
        return 2
    opener.cleanup_temp()  # 前回の一時コピーの消し残しを削除
    root.deiconify()
    App(root, cfg)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
