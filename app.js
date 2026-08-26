(() => {
  const STORAGE_KEYS = {
    profile: "watashinara.profile.v1",
    history: "watashinara.history.v1",
    apiKey: "watashinara.apiKey.v1",
  };

  const ANTHROPIC_MODEL = "claude-sonnet-5";
  const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

  const state = {
    profile: loadProfile(),
    history: loadHistory(),
    apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || "",
  };

  // ---------- storage helpers ----------

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.profile);
      if (!raw) return emptyProfile();
      const parsed = JSON.parse(raw);
      return { ...emptyProfile(), ...parsed };
    } catch {
      return emptyProfile();
    }
  }

  function emptyProfile() {
    return { name: "", personality: "", tone: "", values: [], qaExamples: [] };
  }

  function saveProfile() {
    localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(state.profile));
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.history);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveHistory() {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(state.history));
  }

  // ---------- tabs ----------

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // ---------- profile tab ----------

  const nameInput = document.getElementById("profile-name");
  const personalityInput = document.getElementById("profile-personality");
  const toneInput = document.getElementById("profile-tone");
  const valuesInput = document.getElementById("profile-values-input");
  const valuesListEl = document.getElementById("values-list");
  const qaQuestionInput = document.getElementById("qa-question-input");
  const qaAnswerInput = document.getElementById("qa-answer-input");
  const qaExamplesListEl = document.getElementById("qa-examples-list");

  function fillProfileForm() {
    nameInput.value = state.profile.name;
    personalityInput.value = state.profile.personality;
    toneInput.value = state.profile.tone;
    renderValues();
    renderQaExamples();
  }

  function renderValues() {
    valuesListEl.innerHTML = "";
    state.profile.values.forEach((v, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<span></span><button aria-label="削除">×</button>`;
      chip.querySelector("span").textContent = v;
      chip.querySelector("button").addEventListener("click", () => {
        state.profile.values.splice(i, 1);
        renderValues();
      });
      valuesListEl.appendChild(chip);
    });
  }

  function renderQaExamples() {
    qaExamplesListEl.innerHTML = "";
    state.profile.qaExamples.forEach((qa, i) => {
      const item = document.createElement("div");
      item.className = "qa-item";
      const q = document.createElement("p");
      q.className = "qa-q";
      q.textContent = "Q: " + qa.q;
      const a = document.createElement("p");
      a.className = "qa-a";
      a.textContent = "A: " + qa.a;
      const del = document.createElement("button");
      del.className = "item-delete-btn";
      del.textContent = "削除";
      del.addEventListener("click", () => {
        state.profile.qaExamples.splice(i, 1);
        renderQaExamples();
      });
      item.append(q, a, del);
      qaExamplesListEl.appendChild(item);
    });
  }

  document.getElementById("add-value-btn").addEventListener("click", () => {
    const v = valuesInput.value.trim();
    if (!v) return;
    state.profile.values.push(v);
    valuesInput.value = "";
    renderValues();
  });

  valuesInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("add-value-btn").click();
    }
  });

  document.getElementById("add-qa-btn").addEventListener("click", () => {
    const q = qaQuestionInput.value.trim();
    const a = qaAnswerInput.value.trim();
    if (!q || !a) return;
    state.profile.qaExamples.push({ q, a });
    qaQuestionInput.value = "";
    qaAnswerInput.value = "";
    renderQaExamples();
  });

  document.getElementById("save-profile-btn").addEventListener("click", () => {
    state.profile.name = nameInput.value.trim();
    state.profile.personality = personalityInput.value.trim();
    state.profile.tone = toneInput.value.trim();
    saveProfile();
    const msg = document.getElementById("profile-saved-msg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2000);
  });

  // ---------- settings tab ----------

  const apiKeyInput = document.getElementById("api-key-input");
  apiKeyInput.value = state.apiKey;

  document.getElementById("save-key-btn").addEventListener("click", () => {
    state.apiKey = apiKeyInput.value.trim();
    if (state.apiKey) {
      localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.apiKey);
    }
    showKeyMsg(state.apiKey ? "保存しました" : "キーが空のため未設定です");
  });

  document.getElementById("clear-key-btn").addEventListener("click", () => {
    state.apiKey = "";
    apiKeyInput.value = "";
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    showKeyMsg("削除しました");
  });

  function showKeyMsg(text) {
    const msg = document.getElementById("key-saved-msg");
    msg.textContent = text;
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2000);
  }

  document.getElementById("clear-all-btn").addEventListener("click", () => {
    if (!confirm("プロフィール・履歴・APIキーをすべて削除します。よろしいですか？")) return;
    localStorage.removeItem(STORAGE_KEYS.profile);
    localStorage.removeItem(STORAGE_KEYS.history);
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    state.profile = emptyProfile();
    state.history = [];
    state.apiKey = "";
    apiKeyInput.value = "";
    fillProfileForm();
    renderHistory();
  });

  // ---------- history tab ----------

  function renderHistory() {
    const listEl = document.getElementById("history-list");
    const emptyMsg = document.getElementById("history-empty-msg");
    listEl.innerHTML = "";
    if (state.history.length === 0) {
      emptyMsg.classList.remove("hidden");
      return;
    }
    emptyMsg.classList.add("hidden");
    [...state.history].reverse().forEach((item) => {
      const realIndex = state.history.indexOf(item);
      const el = document.createElement("div");
      el.className = "history-item";
      const date = document.createElement("p");
      date.className = "h-date";
      date.textContent = new Date(item.date).toLocaleString("ja-JP");
      const q = document.createElement("p");
      q.className = "h-q";
      q.textContent = "Q: " + item.question;
      const a = document.createElement("p");
      a.className = "h-a";
      a.textContent = item.answer;
      const del = document.createElement("button");
      del.className = "item-delete-btn";
      del.textContent = "削除";
      del.addEventListener("click", () => {
        state.history.splice(realIndex, 1);
        saveHistory();
        renderHistory();
      });
      el.append(date, q, a, del);
      listEl.appendChild(el);
    });
  }

  // ---------- ask tab ----------

  const questionInput = document.getElementById("question-input");
  const askBtn = document.getElementById("ask-btn");
  const regenerateBtn = document.getElementById("regenerate-btn");
  const saveHistoryBtn = document.getElementById("save-history-btn");
  const answerBox = document.getElementById("answer-box");
  const answerText = document.getElementById("answer-text");
  const answerSourceBadge = document.getElementById("answer-source-badge");
  const askError = document.getElementById("ask-error");

  let lastQuestion = "";
  let lastAnswer = "";

  askBtn.addEventListener("click", () => generateAnswer());
  regenerateBtn.addEventListener("click", () => generateAnswer());

  saveHistoryBtn.addEventListener("click", () => {
    if (!lastAnswer) return;
    state.history.push({ question: lastQuestion, answer: lastAnswer, date: Date.now() });
    saveHistory();
    renderHistory();
    saveHistoryBtn.textContent = "保存しました";
    setTimeout(() => (saveHistoryBtn.textContent = "履歴に保存"), 1500);
  });

  async function generateAnswer() {
    const question = questionInput.value.trim();
    askError.classList.add("hidden");
    if (!question) {
      askError.textContent = "質問を入力してください。";
      askError.classList.remove("hidden");
      return;
    }
    lastQuestion = question;

    askBtn.disabled = true;
    askBtn.textContent = "考え中...";

    try {
      let answer;
      let source;
      if (state.apiKey) {
        answer = await generateWithClaude(question);
        source = "Claudeによる生成";
      } else {
        answer = generateWithHeuristic(question);
        source = "登録した価値観からの簡易生成";
      }
      lastAnswer = answer;
      answerText.textContent = answer;
      answerSourceBadge.textContent = source;
      answerBox.classList.remove("hidden");
    } catch (err) {
      askError.textContent = "生成に失敗しました：" + err.message;
      askError.classList.remove("hidden");
    } finally {
      askBtn.disabled = false;
      askBtn.textContent = "私ならどう答える？";
    }
  }

  // ---------- Claude-based generation ----------

  async function generateWithClaude(question) {
    const system = buildSystemPrompt();
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": state.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`APIエラー (${res.status}): ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("応答にテキストが含まれていません。");
    return textBlock.text.trim();
  }

  function buildSystemPrompt() {
    const p = state.profile;
    const lines = [];
    lines.push(
      `あなたはこれから「${p.name || "この人"}」本人になりきって、一人称で質問に答えます。` +
        "本人が実際にどう考え、どう答えそうかを再現してください。中立的なアドバイスや一般論ではなく、あくまで本人の視点・価値観・口調で答えてください。"
    );
    if (p.personality) {
      lines.push(`【性格・考え方】\n${p.personality}`);
    }
    if (p.values.length > 0) {
      lines.push(`【大切にしている価値観】\n${p.values.map((v) => "・" + v).join("\n")}`);
    }
    if (p.tone) {
      lines.push(`【話し方・口癖】\n${p.tone}`);
    }
    if (p.qaExamples.length > 0) {
      const examples = p.qaExamples
        .map((qa) => `Q: ${qa.q}\nA: ${qa.a}`)
        .join("\n\n");
      lines.push(`【過去にこの人が実際に答えた例】\n${examples}`);
    }
    lines.push("回答は3〜6文程度で、本人が話しているような自然な一人称の文章にしてください。");
    return lines.join("\n\n");
  }

  // ---------- heuristic fallback (no API key) ----------

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z0-9ぁ-んァ-ヶ一-龠々]+/gu) || []).filter(
      (t) => t.length > 1
    );
  }

  function overlapScore(tokensA, tokensB) {
    const setB = new Set(tokensB);
    let score = 0;
    tokensA.forEach((t) => {
      if (setB.has(t)) score += 1;
    });
    return score;
  }

  function generateWithHeuristic(question) {
    const p = state.profile;
    const qTokens = tokenize(question);

    // find best matching past QA example
    let bestQa = null;
    let bestQaScore = 0;
    p.qaExamples.forEach((qa) => {
      const score = overlapScore(qTokens, tokenize(qa.q));
      if (score > bestQaScore) {
        bestQaScore = score;
        bestQa = qa;
      }
    });

    // find matching values
    const matchedValues = p.values.filter((v) => overlapScore(qTokens, tokenize(v)) > 0);
    const topValues = matchedValues.length > 0 ? matchedValues : p.values.slice(0, 2);

    const hasAnyProfile =
      p.personality || p.tone || p.values.length > 0 || p.qaExamples.length > 0;

    if (!hasAnyProfile) {
      return (
        "まだプロフィールが登録されていません。「プロフィール」タブで性格・価値観・過去の回答例を登録すると、" +
        "それをもとにした回答を作れるようになります。ここでは一般的な答えしか出せません：\n\n" +
        `「${question}」について、まずは自分がその選択で何を一番失いたくないか、何を一番大事にしたいかを考えてみるとよさそうです。`
      );
    }

    const parts = [];

    if (bestQa && bestQaScore > 0) {
      parts.push(
        `似た話として、以前「${bestQa.q}」という質問に「${bestQa.a}」と答えたことがある。それに近い考え方をすると、`
      );
    }

    if (topValues.length > 0) {
      parts.push(`自分は${topValues.join("や")}を大事にしているタイプなので、`);
    }

    if (p.personality) {
      parts.push(`もともと${summarize(p.personality)}という面もあるから、`);
    }

    parts.push(`「${question}」については、それらを軸にして判断すると思う。`);

    let base = parts.join("");

    if (p.tone) {
      base += `\n\n(口調メモ：${p.tone} を意識するとより自分らしくなる)`;
    }

    return base;
  }

  function summarize(text) {
    const trimmed = text.trim();
    return trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed;
  }

  // ---------- init ----------

  fillProfileForm();
  renderHistory();
})();
