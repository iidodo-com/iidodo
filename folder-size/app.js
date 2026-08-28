(() => {
  const dropzone = document.getElementById("dropzone");
  const pickBtn = document.getElementById("pick-btn");
  const dirInput = document.getElementById("dir-input");
  const resetBtn = document.getElementById("reset-btn");
  const statusEl = document.getElementById("status");
  const summaryEl = document.getElementById("summary");
  const summaryNameEl = document.getElementById("summary-name");
  const summaryStatsEl = document.getElementById("summary-stats");
  const treeRootEl = document.getElementById("tree-root");

  const CHUNK_SIZE = 4000; // files aggregated per animation frame, keeps UI responsive on huge trees
  const MAX_ROWS = 300; // rows rendered per level before collapsing the rest into a summary row

  // ---------- tree model ----------
  // node: { name, total, ownSize, fileCount, dirChildren: Map|null, fileChildren: Array|null }

  function createNode(name) {
    return { name, total: 0, ownSize: 0, fileCount: 0, dirChildren: null, fileChildren: null };
  }

  function insertFile(root, parts, size, onNewDir) {
    let node = root;
    node.total += size;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node.dirChildren) node.dirChildren = new Map();
      let child = node.dirChildren.get(part);
      if (!child) {
        child = createNode(part);
        node.dirChildren.set(part, child);
        onNewDir();
      }
      child.total += size;
      node = child;
    }
    const fileName = parts[parts.length - 1];
    if (!node.fileChildren) node.fileChildren = [];
    node.fileChildren.push({ name: fileName, size });
    node.ownSize += size;
    node.fileCount += 1;
  }

  function buildTreeChunked(entries, stripFirst, onProgress, onDone) {
    const root = createNode("");
    let dirCount = 0;
    let i = 0;
    const total = entries.length;

    function processRange(end) {
      for (; i < end; i++) {
        const { path, size } = entries[i];
        let parts = path.split("/").filter(Boolean);
        if (stripFirst) parts = parts.slice(1);
        if (parts.length === 0) {
          // the dropped/selected item was itself a single file
          root.total += size;
          root.ownSize += size;
          root.fileCount += 1;
          if (!root.fileChildren) root.fileChildren = [];
          root.fileChildren.push({ name: path.split("/").pop() || path, size });
          continue;
        }
        insertFile(root, parts, size, () => dirCount++);
      }
    }

    if (total <= CHUNK_SIZE) {
      processRange(total);
      onDone(root, dirCount);
      return;
    }

    function step() {
      const end = Math.min(i + CHUNK_SIZE, total);
      processRange(end);
      onProgress(i, total);
      if (i < total) {
        requestAnimationFrame(step);
      } else {
        onDone(root, dirCount);
      }
    }
    requestAnimationFrame(step);
  }

  // ---------- collecting entries ----------

  function collectFromFileList(fileList) {
    const results = [];
    for (const file of fileList) {
      results.push({ path: file.webkitRelativePath || file.name, size: file.size });
    }
    const firstPath = fileList.length > 0 ? fileList[0].webkitRelativePath : "";
    const rootName = firstPath ? firstPath.split("/")[0] : "フォルダ";
    return { rootName: rootName || "フォルダ", results, stripFirst: true };
  }

  function getEntryFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  function readAllDirEntries(reader) {
    return new Promise((resolve, reject) => {
      const all = [];
      function readBatch() {
        reader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        }, reject);
      }
      readBatch();
    });
  }

  async function walkEntry(entry, basePath, results) {
    const path = basePath ? basePath + "/" + entry.name : entry.name;
    if (entry.isFile) {
      try {
        const file = await getEntryFile(entry);
        results.push({ path, size: file.size });
      } catch {
        // unreadable file (permissions, broken symlink, etc.) — skip it
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children = await readAllDirEntries(reader);
      await Promise.all(children.map((child) => walkEntry(child, path, results)));
    }
  }

  async function walkDroppedItems(items) {
    const topEntries = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) topEntries.push(entry);
    }
    if (topEntries.length === 0) return null;

    const results = [];
    await Promise.all(topEntries.map((e) => walkEntry(e, "", results)));

    const singleDir = topEntries.length === 1 && topEntries[0].isDirectory;
    const rootName =
      topEntries.length === 1 ? topEntries[0].name : `選択項目 (${topEntries.length}件)`;
    return { rootName, results, stripFirst: singleDir };
  }

  // ---------- formatting ----------

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    const digits = i === 0 ? 0 : val >= 100 ? 0 : val >= 10 ? 1 : 2;
    return val.toFixed(digits) + " " + units[i];
  }

  // ---------- rendering ----------

  function hasContent(node) {
    return !!(
      node &&
      ((node.dirChildren && node.dirChildren.size > 0) ||
        (node.fileChildren && node.fileChildren.length > 0))
    );
  }

  function collectChildren(node) {
    const items = [];
    if (node.dirChildren) {
      for (const child of node.dirChildren.values()) {
        items.push({ type: "dir", name: child.name, size: child.total, node: child });
      }
    }
    if (node.fileChildren) {
      for (const f of node.fileChildren) {
        items.push({ type: "file", name: f.name, size: f.size });
      }
    }
    items.sort((a, b) => b.size - a.size);
    return items;
  }

  function buildChildRows(node, depth) {
    const container = document.createElement("div");
    container.className = "rows";
    const items = collectChildren(node);
    const shown = items.slice(0, MAX_ROWS);
    const rest = items.slice(MAX_ROWS);

    shown.forEach((item) => {
      container.appendChild(buildRow(item, node.total, depth));
    });

    if (rest.length > 0) {
      const restSize = rest.reduce((s, r) => s + r.size, 0);
      const moreRow = document.createElement("div");
      moreRow.className = "more-row";
      moreRow.style.setProperty("--depth", depth);
      moreRow.textContent = `…ほか ${rest.length.toLocaleString()} 件（合計 ${formatBytes(restSize)}）`;
      container.appendChild(moreRow);
    }

    return container;
  }

  function buildRow(item, parentTotal, depth) {
    const row = document.createElement("div");
    row.className = "row " + (item.type === "dir" ? "dir" : "file");

    const expandable = item.type === "dir" && hasContent(item.node);
    const pct = parentTotal > 0 ? (item.size / parentTotal) * 100 : 0;

    const main = document.createElement("div");
    main.className = "row-main";
    main.style.setProperty("--depth", depth);

    const toggle = document.createElement("span");
    toggle.className = "toggle";
    toggle.textContent = expandable ? "▶" : "";

    const nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = (item.type === "dir" ? "📁 " : "📄 ") + item.name;
    nameEl.title = item.name;

    const barWrap = document.createElement("span");
    barWrap.className = "bar-wrap";
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.width = (item.size > 0 ? Math.max(pct, 0.5) : 0) + "%";
    barWrap.appendChild(bar);

    const sizeEl = document.createElement("span");
    sizeEl.className = "size";
    sizeEl.textContent = `${formatBytes(item.size)}（${pct.toFixed(1)}%）`;

    main.append(toggle, nameEl, barWrap, sizeEl);
    row.appendChild(main);

    if (expandable) {
      let childContainer = null;
      main.addEventListener("click", () => {
        if (!childContainer) {
          childContainer = buildChildRows(item.node, depth + 1);
          row.appendChild(childContainer);
        }
        const isOpen = childContainer.style.display !== "none";
        childContainer.style.display = isOpen ? "none" : "";
        toggle.textContent = isOpen ? "▶" : "▼";
      });
    }

    return row;
  }

  function render(root, rootName, meta) {
    summaryEl.classList.remove("hidden");
    summaryNameEl.textContent = rootName;
    summaryStatsEl.textContent =
      `合計 ${formatBytes(root.total)}　・　ファイル ${meta.fileCount.toLocaleString()} 件　・　` +
      `フォルダ ${meta.dirCount.toLocaleString()} 件　・　解析時間 ${meta.elapsedMs.toFixed(0)}ms`;

    treeRootEl.innerHTML = "";
    if (!hasContent(root) && root.total === 0) {
      const empty = document.createElement("p");
      empty.className = "status-text";
      empty.textContent = "空のフォルダ、またはファイルが見つかりませんでした。";
      treeRootEl.appendChild(empty);
      return;
    }
    treeRootEl.appendChild(buildChildRows(root, 0));
  }

  // ---------- orchestration ----------

  function setStatus(text) {
    if (!text) {
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      return;
    }
    statusEl.classList.remove("hidden");
    statusEl.textContent = text;
  }

  function runScan(rootName, entries, stripFirst, walkMs) {
    if (entries.length === 0) {
      setStatus("");
      render(createNode(""), rootName, { fileCount: 0, dirCount: 0, elapsedMs: walkMs || 0 });
      return;
    }
    setStatus(`集計中… (${entries.length.toLocaleString()} 件のファイル)`);
    const t0 = performance.now();
    buildTreeChunked(
      entries,
      stripFirst,
      (done, total) => {
        setStatus(`集計中… ${done.toLocaleString()} / ${total.toLocaleString()} 件`);
      },
      (root, dirCount) => {
        const elapsedMs = performance.now() - t0 + (walkMs || 0);
        setStatus("");
        render(root, rootName, { fileCount: entries.length, dirCount, elapsedMs });
      }
    );
  }

  pickBtn.addEventListener("click", () => dirInput.click());

  dirInput.addEventListener("change", () => {
    if (dirInput.files && dirInput.files.length > 0) {
      const { rootName, results, stripFirst } = collectFromFileList(dirInput.files);
      runScan(rootName, results, stripFirst, 0);
    }
    dirInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    })
  );

  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    })
  );

  dropzone.addEventListener("drop", async (e) => {
    const items = e.dataTransfer && e.dataTransfer.items;
    if (!items || items.length === 0) return;
    setStatus("フォルダを読み込み中…");
    const t0 = performance.now();
    const walkResult = await walkDroppedItems(Array.from(items));
    if (!walkResult) {
      setStatus("");
      return;
    }
    runScan(walkResult.rootName, walkResult.results, walkResult.stripFirst, performance.now() - t0);
  });

  resetBtn.addEventListener("click", () => {
    summaryEl.classList.add("hidden");
    treeRootEl.innerHTML = "";
    setStatus("");
  });
})();
