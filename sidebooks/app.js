(() => {
  const $ = (id) => document.getElementById(id);
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  // ---------- IndexedDB ----------
  const dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open("cloud-bookshelf", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("folders", { keyPath: "id" });
      db.createObjectStore("docs", { keyPath: "id" });
      db.createObjectStore("memos", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  };
  const dbAll = (s) => tx(s, "readonly", (o) => o.getAll());
  const dbGet = (s, k) => tx(s, "readonly", (o) => o.get(k));
  const dbPut = (s, v) => tx(s, "readwrite", (o) => o.put(v));
  const dbDel = (s, k) => tx(s, "readwrite", (o) => o.delete(k));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- state ----------
  const state = { folders: [], docs: [], folderId: "all", role: "admin" };
  const v = { doc: null, pdf: null, page: 1, scale: 1.2, memo: null, pen: false, drawing: null };
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("cloud-bookshelf") : null;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add("hidden"), 3000);
  }

  // ---------- shelf ----------
  async function reload() {
    [state.folders, state.docs] = await Promise.all([dbAll("folders"), dbAll("docs")]);
    state.docs.sort((a, b) => b.created - a.created);
    renderFolders();
    renderGrid();
  }

  function renderFolders() {
    const ul = $("folder-list");
    ul.innerHTML = "";
    const items = [{ id: "all", name: "すべて" }, ...state.folders];
    for (const f of items) {
      const li = document.createElement("li");
      li.className = f.id === state.folderId ? "active" : "";
      li.innerHTML = `<span>📁 ${esc(f.name)}</span>`;
      if (f.id !== "all") {
        const del = document.createElement("button");
        del.className = "del admin-only";
        del.textContent = "✕";
        del.title = "フォルダ削除（中の資料は「すべて」に残ります）";
        del.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`フォルダ「${f.name}」を削除しますか？`)) return;
          for (const d of state.docs.filter((d) => d.folderId === f.id)) {
            d.folderId = null;
            await dbPut("docs", d);
          }
          await dbDel("folders", f.id);
          if (state.folderId === f.id) state.folderId = "all";
          reload();
        };
        li.appendChild(del);
      }
      li.onclick = () => {
        state.folderId = f.id;
        $("results").classList.add("hidden");
        renderFolders();
        renderGrid();
      };
      ul.appendChild(li);
    }
    $("folder-title").textContent = (items.find((f) => f.id === state.folderId) || items[0]).name;
  }

  function renderGrid() {
    const grid = $("book-grid");
    grid.innerHTML = "";
    const docs = state.docs.filter((d) => state.folderId === "all" || d.folderId === state.folderId);
    $("empty").classList.toggle("hidden", docs.length > 0);
    for (const d of docs) {
      const c = document.createElement("div");
      c.className = "card";
      c.innerHTML = `<div class="thumb">${d.thumb ? `<img src="${d.thumb}" alt="">` : "📄"}</div>
        <div class="meta"><div class="name">${esc(d.name)}</div>
        <div class="muted">${d.pages}ページ</div></div>`;
      c.onclick = () => openDoc(d.id, 1);
      const del = document.createElement("button");
      del.className = "del admin-only";
      del.textContent = "削除";
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`「${d.name}」を削除しますか？`)) return;
        await dbDel("docs", d.id);
        reload();
      };
      c.appendChild(del);
      grid.appendChild(c);
    }
  }

  $("add-folder").onclick = async () => {
    const name = (prompt("フォルダ名") || "").trim();
    if (!name) return;
    await dbPut("folders", { id: uid(), name });
    reload();
  };

  $("file-input").onchange = async (e) => {
    for (const file of e.target.files) {
      try {
        toast(`「${file.name}」を取り込み中…`);
        await importPdf(file);
      } catch (err) {
        console.error(err);
        toast(`「${file.name}」を読み込めませんでした`);
      }
    }
    e.target.value = "";
    reload();
  };

  async function importPdf(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      texts.push(tc.items.map((it) => it.str).join(" "));
    }
    const p1 = await pdf.getPage(1);
    const vp0 = p1.getViewport({ scale: 1 });
    const vp = p1.getViewport({ scale: 220 / vp0.height });
    const cv = document.createElement("canvas");
    cv.width = vp.width;
    cv.height = vp.height;
    await p1.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    await dbPut("docs", {
      id: uid(),
      name: file.name.replace(/\.pdf$/i, ""),
      folderId: state.folderId === "all" ? null : state.folderId,
      created: Date.now(),
      pages: pdf.numPages,
      thumb: cv.toDataURL("image/jpeg", 0.7),
      texts,
      blob: new Blob([buf], { type: "application/pdf" }),
    });
  }

  // ---------- search ----------
  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return "";
    const s = text.slice(Math.max(0, i - 25), i + q.length + 40);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return esc(s).replace(re, (m) => `<mark>${m}</mark>`);
  }
  function searchDocs(docs, q) {
    const out = [];
    for (const d of docs)
      d.texts.forEach((t, i) => {
        if (t.toLowerCase().includes(q.toLowerCase())) out.push({ doc: d, page: i + 1, text: t });
      });
    return out;
  }

  $("global-search").onsubmit = (e) => {
    e.preventDefault();
    const q = $("global-q").value.trim();
    const box = $("results");
    if (!viewerHidden()) closeViewer();
    if (!q) return box.classList.add("hidden");
    const hits = searchDocs(state.docs, q);
    box.classList.remove("hidden");
    box.innerHTML = `<strong>「${esc(q)}」の検索結果：${hits.length}件</strong>`;
    for (const h of hits.slice(0, 100)) {
      const row = document.createElement("div");
      row.className = "hit";
      row.innerHTML = `<div><strong>${esc(h.doc.name)}</strong> <span class="muted">p.${h.page}</span></div>
        <div class="muted">…${snippet(h.text, q)}…</div>`;
      row.onclick = () => openDoc(h.doc.id, h.page);
      box.appendChild(row);
    }
  };

  $("doc-search").onsubmit = (e) => {
    e.preventDefault();
    const q = $("doc-q").value.trim();
    const ul = $("doc-hits");
    ul.innerHTML = "";
    if (!q || !v.doc) return;
    const hits = searchDocs([v.doc], q);
    if (!hits.length) ul.innerHTML = '<li class="muted">見つかりませんでした</li>';
    for (const h of hits) {
      const li = document.createElement("li");
      li.innerHTML = `p.${h.page} …${snippet(h.text, q)}…`;
      li.onclick = () => goto(h.page);
      ul.appendChild(li);
    }
    if (hits.length) goto(hits[0].page);
  };

  // ---------- viewer ----------
  const viewerHidden = () => $("viewer").classList.contains("hidden");
  let renderTask = null;

  async function openDoc(id, page) {
    const doc = state.docs.find((d) => d.id === id) || (await dbGet("docs", id));
    if (!doc) return;
    v.doc = doc;
    v.pdf = await pdfjsLib.getDocument({ data: await doc.blob.arrayBuffer() }).promise;
    $("doc-title").textContent = doc.name;
    $("page-total").textContent = doc.pages;
    $("page-no").max = doc.pages;
    $("doc-hits").innerHTML = "";
    $("viewer").classList.remove("hidden");
    await goto(page || 1);
  }

  function closeViewer() {
    saveMemo();
    $("viewer").classList.add("hidden");
    v.doc = v.pdf = null;
  }

  async function goto(n) {
    if (!v.pdf) return;
    await saveMemo();
    v.page = Math.min(Math.max(1, n), v.doc.pages);
    $("page-no").value = v.page;
    const key = `${v.doc.id}:${v.page}`;
    v.memo = (await dbGet("memos", key)) || { key, text: "", strokes: [] };
    $("memo-text").value = v.memo.text;
    await draw();
  }

  async function draw() {
    if (renderTask) renderTask.cancel();
    const page = await v.pdf.getPage(v.page);
    const vp = page.getViewport({ scale: v.scale });
    const cv = $("pdf-canvas");
    cv.width = vp.width;
    cv.height = vp.height;
    const ink = $("ink-canvas");
    ink.width = vp.width;
    ink.height = vp.height;
    renderTask = page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
    try {
      await renderTask.promise;
    } catch {
      return; // cancelled by a newer render
    }
    drawInk();
  }

  function drawInk() {
    const ink = $("ink-canvas");
    const ctx = ink.getContext("2d");
    ctx.clearRect(0, 0, ink.width, ink.height);
    ctx.strokeStyle = "#e0262b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = ctx.lineJoin = "round";
    const all = v.drawing ? [...v.memo.strokes, v.drawing] : v.memo.strokes;
    for (const s of all) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x * ink.width, y * ink.height) : ctx.moveTo(x * ink.width, y * ink.height)));
      ctx.stroke();
    }
  }

  async function saveMemo() {
    if (!v.memo) return;
    v.memo.text = $("memo-text").value;
    if (v.memo.text || v.memo.strokes.length) await dbPut("memos", v.memo);
    else await dbDel("memos", v.memo.key);
  }

  $("back").onclick = closeViewer;
  $("prev").onclick = () => goto(v.page - 1);
  $("next").onclick = () => goto(v.page + 1);
  $("page-no").onchange = (e) => goto(parseInt(e.target.value, 10) || 1);
  $("zoom-in").onclick = () => ((v.scale = Math.min(3, v.scale + 0.2)), draw());
  $("zoom-out").onclick = () => ((v.scale = Math.max(0.5, v.scale - 0.2)), draw());
  let memoTimer;
  $("memo-text").oninput = () => {
    clearTimeout(memoTimer);
    memoTimer = setTimeout(saveMemo, 500);
  };
  document.addEventListener("keydown", (e) => {
    if (viewerHidden() || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") goto(v.page + 1);
    if (e.key === "ArrowLeft") goto(v.page - 1);
  });

  // handwriting
  $("pen").onclick = () => {
    v.pen = !v.pen;
    $("pen").classList.toggle("on", v.pen);
    $("ink-canvas").classList.toggle("drawing", v.pen);
  };
  $("erase").onclick = async () => {
    if (!v.memo || !v.memo.strokes.length || !confirm("このページの手書きを消去しますか？")) return;
    v.memo.strokes = [];
    drawInk();
    saveMemo();
  };
  const ink = $("ink-canvas");
  const pt = (e) => {
    const r = ink.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  ink.addEventListener("pointerdown", (e) => {
    if (!v.pen) return;
    ink.setPointerCapture(e.pointerId);
    v.drawing = [pt(e)];
  });
  ink.addEventListener("pointermove", (e) => {
    if (!v.drawing) return;
    v.drawing.push(pt(e));
    drawInk();
  });
  const endStroke = () => {
    if (!v.drawing) return;
    if (v.drawing.length > 1) v.memo.strokes.push(v.drawing);
    v.drawing = null;
    drawInk();
    saveMemo();
  };
  ink.addEventListener("pointerup", endStroke);
  ink.addEventListener("pointercancel", endStroke);

  // ---------- page notification (same-browser tabs via BroadcastChannel) ----------
  $("notify").onclick = () => {
    if (!v.doc) return;
    if (!channel) return toast("このブラウザはページ通知に対応していません");
    channel.postMessage({ type: "page", docId: v.doc.id, page: v.page, name: v.doc.name });
    toast(`p.${v.page} を全員に通知しました`);
  };
  if (channel)
    channel.onmessage = async (e) => {
      const m = e.data;
      if (m.type !== "page" || state.role === "admin") return;
      if (!$("follow").checked) return toast(`発言者が「${m.name}」p.${m.page} を表示中`);
      await reload();
      if (v.doc && v.doc.id === m.docId) await goto(m.page);
      else await openDoc(m.docId, m.page);
      toast(`発言者の操作に追従：p.${m.page}`);
    };

  // ---------- role ----------
  $("role").onchange = (e) => {
    state.role = e.target.value;
    document.body.classList.toggle("member", state.role === "member");
  };

  reload();
})();
