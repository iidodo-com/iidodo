(() => {
  const STORAGE_KEY = "tebikiReference.rules.v1";

  const SEVERITY_LABELS = { high: "高", medium: "中", low: "低" };

  const tebikiText = JSON.parse(document.getElementById("tebiki-text-data").textContent);
  const defaultRules = JSON.parse(document.getElementById("rules-data").textContent);

  let rules = loadRules();
  let activeRuleId = null;

  // ---------- storage ----------

  function loadRules() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneRules(defaultRules);
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : structuredCloneRules(defaultRules);
    } catch {
      return structuredCloneRules(defaultRules);
    }
  }

  function structuredCloneRules(list) {
    return JSON.parse(JSON.stringify(list));
  }

  function saveRules() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  }

  // ---------- helpers ----------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlightText(text, term) {
    const escaped = escapeHtml(text);
    const q = (term || "").trim();
    if (!q) return escaped;
    const re = new RegExp(escapeRegExp(escapeHtml(q)), "gi");
    return escaped.replace(re, (m) => `<mark>${m}</mark>`);
  }

  function getSnippet(text, term, radius = 40) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(term.toLowerCase());
    if (idx === -1) {
      return text.length > radius * 2 ? text.slice(0, radius * 2) + "…" : text;
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + term.length + radius);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = "…" + snippet;
    if (end < text.length) snippet = snippet + "…";
    return snippet;
  }

  function findPage(pageNumber) {
    return tebikiText.find((p) => p.page === Number(pageNumber));
  }

  // ---------- manual viewer ----------

  const manualPlaceholder = document.getElementById("manual-placeholder");
  const manualDetail = document.getElementById("manual-detail");
  const manualPageBadge = document.getElementById("manual-page-badge");
  const manualChapterSection = document.getElementById("manual-chapter-section");
  const manualHeading = document.getElementById("manual-heading");
  const manualTextEl = document.getElementById("manual-text");

  function showManualPage(pageNumber, term) {
    const entry = findPage(pageNumber);
    if (!entry) {
      manualDetail.classList.add("hidden");
      manualPlaceholder.classList.remove("hidden");
      manualPlaceholder.textContent = `p.${pageNumber} に該当する本文が見つかりませんでした。`;
      return;
    }
    manualPlaceholder.classList.add("hidden");
    manualDetail.classList.remove("hidden");
    manualPageBadge.textContent = `p.${entry.page}`;
    manualChapterSection.textContent = `${entry.chapter} ${entry.section}`;
    manualHeading.textContent = entry.heading;
    manualTextEl.innerHTML = highlightText(entry.text, term);
  }

  // ---------- full text search ----------

  const searchInput = document.getElementById("tebiki-search-input");
  const searchClearBtn = document.getElementById("tebiki-search-clear");
  const searchResultsEl = document.getElementById("search-results");

  function runSearch(rawTerm) {
    const term = rawTerm.trim();
    if (!term) {
      searchResultsEl.classList.add("hidden");
      searchResultsEl.innerHTML = "";
      return;
    }

    const lower = term.toLowerCase();
    const matches = tebikiText.filter((p) =>
      `${p.chapter} ${p.section} ${p.heading} ${p.text}`.toLowerCase().includes(lower)
    );

    searchResultsEl.innerHTML = "";
    searchResultsEl.classList.remove("hidden");

    if (matches.length === 0) {
      const none = document.createElement("p");
      none.className = "search-no-results";
      none.textContent = "一致する内容が見つかりませんでした。";
      searchResultsEl.appendChild(none);
      return;
    }

    matches.forEach((entry) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result-item";

      const top = document.createElement("div");
      top.className = "search-result-top";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `p.${entry.page}`;
      const heading = document.createElement("span");
      heading.className = "search-result-heading";
      heading.innerHTML = `${escapeHtml(entry.chapter)} ${escapeHtml(entry.section)}　${highlightText(
        entry.heading,
        term
      )}`;
      top.append(badge, heading);

      const snippet = document.createElement("p");
      snippet.className = "search-result-snippet";
      snippet.innerHTML = highlightText(getSnippet(entry.text, term), term);

      item.append(top, snippet);
      item.addEventListener("click", () => {
        showManualPage(entry.page, term);
        setActiveRuleCard(null);
      });
      searchResultsEl.appendChild(item);
    });
  }

  searchInput.addEventListener("input", () => runSearch(searchInput.value));
  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    runSearch("");
    searchInput.focus();
  });

  // ---------- rules list (指摘一覧) ----------

  const rulesListEl = document.getElementById("rules-list");
  const rulesEmptyMsg = document.getElementById("rules-empty-msg");

  function setActiveRuleCard(ruleId) {
    activeRuleId = ruleId;
    rulesListEl.querySelectorAll(".rule-card").forEach((card) => {
      card.classList.toggle("active", card.dataset.id === ruleId);
    });
  }

  function renderRules() {
    rulesListEl.innerHTML = "";
    if (rules.length === 0) {
      rulesEmptyMsg.classList.remove("hidden");
      return;
    }
    rulesEmptyMsg.classList.add("hidden");

    rules.forEach((rule) => {
      const card = document.createElement("div");
      card.className = "rule-card";
      card.dataset.id = rule.id;
      if (rule.id === activeRuleId) card.classList.add("active");

      const top = document.createElement("div");
      top.className = "rule-card-top";
      const severityBadge = document.createElement("span");
      severityBadge.className = `badge severity-${rule.severity || "medium"}`;
      severityBadge.textContent = SEVERITY_LABELS[rule.severity] || "中";
      const categoryChip = document.createElement("span");
      categoryChip.className = "badge category-chip";
      categoryChip.textContent = rule.category || "未分類";
      top.append(severityBadge, categoryChip);

      const title = document.createElement("h3");
      title.className = "rule-title";
      title.textContent = rule.title;

      const desc = document.createElement("p");
      desc.className = "rule-desc";
      desc.textContent = rule.description || "";

      const evidenceBtn = document.createElement("button");
      evidenceBtn.type = "button";
      evidenceBtn.className = "evidence-link";
      const ev = rule.evidence || {};
      evidenceBtn.textContent = `根拠：手引 p.${ev.page ?? "?"} ${ev.chapter || ""}${ev.section || ""}`;
      evidenceBtn.addEventListener("click", () => {
        showManualPage(ev.page, null);
        setActiveRuleCard(rule.id);
      });

      const actions = document.createElement("div");
      actions.className = "rule-card-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "item-edit-btn";
      editBtn.textContent = "編集";
      editBtn.addEventListener("click", () => openRuleForm(rule));
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "item-delete-btn";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", () => {
        if (!confirm(`「${rule.title}」を削除します。よろしいですか？`)) return;
        rules = rules.filter((r) => r.id !== rule.id);
        saveRules();
        renderRules();
      });
      actions.append(editBtn, deleteBtn);

      card.append(top, title, desc, evidenceBtn, actions);
      rulesListEl.appendChild(card);
    });
  }

  // ---------- rule form (add / edit) ----------

  const ruleForm = document.getElementById("rule-form");
  const ruleFormId = document.getElementById("rule-form-id");
  const ruleFormCategory = document.getElementById("rule-form-category");
  const ruleFormTitle = document.getElementById("rule-form-title");
  const ruleFormDescription = document.getElementById("rule-form-description");
  const ruleFormSeverity = document.getElementById("rule-form-severity");
  const ruleFormPage = document.getElementById("rule-form-page");
  const ruleFormChapter = document.getElementById("rule-form-chapter");
  const ruleFormSection = document.getElementById("rule-form-section");
  const ruleFormError = document.getElementById("rule-form-error");

  function openRuleForm(rule) {
    ruleFormError.classList.add("hidden");
    if (rule) {
      ruleFormId.value = rule.id;
      ruleFormCategory.value = rule.category || "";
      ruleFormTitle.value = rule.title || "";
      ruleFormDescription.value = rule.description || "";
      ruleFormSeverity.value = rule.severity || "medium";
      ruleFormPage.value = rule.evidence?.page ?? "";
      ruleFormChapter.value = rule.evidence?.chapter || "";
      ruleFormSection.value = rule.evidence?.section || "";
    } else {
      ruleForm.reset();
      ruleFormId.value = "";
    }
    ruleForm.classList.remove("hidden");
    ruleFormTitle.focus();
  }

  function closeRuleForm() {
    ruleForm.classList.add("hidden");
    ruleForm.reset();
    ruleFormId.value = "";
    ruleFormError.classList.add("hidden");
  }

  document.getElementById("add-rule-btn").addEventListener("click", () => openRuleForm(null));
  document.getElementById("rule-form-cancel").addEventListener("click", closeRuleForm);

  ruleForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = ruleFormTitle.value.trim();
    const description = ruleFormDescription.value.trim();
    const page = ruleFormPage.value.trim();

    if (!title || !description || !page) {
      ruleFormError.textContent = "指摘タイトル・指摘内容・根拠ページは必須です。";
      ruleFormError.classList.remove("hidden");
      return;
    }

    const ruleData = {
      category: ruleFormCategory.value.trim() || "未分類",
      title,
      description,
      severity: ruleFormSeverity.value,
      evidence: {
        page: Number(page),
        chapter: ruleFormChapter.value.trim(),
        section: ruleFormSection.value.trim(),
      },
    };

    const existingId = ruleFormId.value;
    if (existingId) {
      const idx = rules.findIndex((r) => r.id === existingId);
      if (idx !== -1) rules[idx] = { ...rules[idx], ...ruleData };
    } else {
      ruleData.id = `R-${Date.now().toString(36)}`;
      rules.push(ruleData);
    }

    saveRules();
    renderRules();
    closeRuleForm();
  });

  // ---------- export ----------

  document.getElementById("export-rules-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rules.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // ---------- init ----------

  renderRules();
})();
