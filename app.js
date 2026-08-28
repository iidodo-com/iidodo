(() => {
  const STORAGE_KEYS = {
    sessions: "bgtranscribe.sessions.v1",
    settings: "bgtranscribe.settings.v1",
  };

  const DB_NAME = "bgtranscribe-audio";
  const DB_STORE = "audio";

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  const state = {
    settings: loadSettings(),
    sessions: loadSessions(),
    recording: false,
    manualStop: false,
    recognition: null,
    mediaStream: null,
    mediaRecorder: null,
    audioChunks: [],
    currentSession: null,
    restartTimestamps: [],
    consecutiveFailures: 0,
    timerInterval: null,
    lastAudioBlobUrl: null,
    wakeLockSentinel: null,
  };

  // ---------- storage helpers ----------

  function loadSettings() {
    const defaults = { lang: "ja-JP", notify: false, wakeLock: true, keepalive: true };
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch {
      return defaults;
    }
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
  }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.sessions);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSessions() {
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessions));
  }

  // ---------- IndexedDB (audio blobs) ----------

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveAudioBlob(id, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadAudioBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteAudioBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- tabs ----------

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "history") renderHistory();
    });
  });

  // ---------- elements ----------

  const unsupportedMsg = document.getElementById("unsupported-msg");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const elapsedTimeEl = document.getElementById("elapsed-time");
  const toggleBtn = document.getElementById("toggle-btn");
  const liveTranscript = document.getElementById("live-transcript");
  const copyCurrentBtn = document.getElementById("copy-current-btn");
  const downloadAudioBtn = document.getElementById("download-audio-btn");
  const recordError = document.getElementById("record-error");
  const keepaliveAudio = document.getElementById("keepalive-audio");

  const langSelect = document.getElementById("lang-select");
  const notifyToggle = document.getElementById("notify-toggle");
  const wakelockToggle = document.getElementById("wakelock-toggle");
  const keepaliveToggle = document.getElementById("keepalive-toggle");

  langSelect.value = state.settings.lang;
  notifyToggle.checked = state.settings.notify;
  wakelockToggle.checked = state.settings.wakeLock;
  keepaliveToggle.checked = state.settings.keepalive;

  langSelect.addEventListener("change", () => {
    state.settings.lang = langSelect.value;
    saveSettings();
  });

  wakelockToggle.addEventListener("change", () => {
    state.settings.wakeLock = wakelockToggle.checked;
    saveSettings();
  });

  keepaliveToggle.addEventListener("change", () => {
    state.settings.keepalive = keepaliveToggle.checked;
    saveSettings();
  });

  notifyToggle.addEventListener("change", async () => {
    if (notifyToggle.checked && "Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        notifyToggle.checked = false;
      }
    }
    state.settings.notify = notifyToggle.checked;
    saveSettings();
  });

  document.getElementById("clear-all-btn").addEventListener("click", async () => {
    if (!confirm("履歴と設定をすべて削除します。よろしいですか？")) return;
    for (const s of state.sessions) {
      if (s.hasAudio) await deleteAudioBlob(s.id).catch(() => {});
    }
    localStorage.removeItem(STORAGE_KEYS.sessions);
    localStorage.removeItem(STORAGE_KEYS.settings);
    state.sessions = [];
    state.settings = loadSettings();
    renderHistory();
  });

  // ---------- silent keep-alive audio ----------
  // Some mobile browsers only exempt a background tab from throttling while it
  // is actively playing audio, so a near-silent looped clip helps recognition
  // survive being backgrounded (no guarantee, but a real-world workaround).
  function createSilentAudioUrl(durationSeconds = 1, sampleRate = 8000) {
    const numSamples = sampleRate * durationSeconds;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);
    return URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
  }

  function startKeepalive() {
    if (!state.settings.keepalive) return;
    if (!keepaliveAudio.src) keepaliveAudio.src = createSilentAudioUrl();
    keepaliveAudio.volume = 0.01;
    keepaliveAudio.play().catch(() => {});
  }

  function stopKeepalive() {
    keepaliveAudio.pause();
  }

  // ---------- wake lock ----------

  async function requestWakeLock() {
    if (!state.settings.wakeLock || !("wakeLock" in navigator)) return;
    try {
      state.wakeLockSentinel = await navigator.wakeLock.request("screen");
    } catch {
      state.wakeLockSentinel = null;
    }
  }

  function releaseWakeLock() {
    if (state.wakeLockSentinel) {
      state.wakeLockSentinel.release().catch(() => {});
      state.wakeLockSentinel = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.recording) {
      requestWakeLock();
    }
  });

  // ---------- status UI ----------

  function setStatus(mode, text) {
    statusDot.className = `status-dot ${mode}`;
    statusText.textContent = text;
  }

  function updateElapsed() {
    if (!state.currentSession) return;
    const secs = Math.floor((Date.now() - state.currentSession.startedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    elapsedTimeEl.textContent = `${mm}:${ss}`;
  }

  // ---------- transcript rendering ----------

  function renderLiveTranscript(interimText) {
    liveTranscript.innerHTML = "";
    const finalText = state.currentSession ? state.currentSession.transcript : "";
    if (!finalText && !interimText) {
      const span = document.createElement("span");
      span.className = "placeholder";
      span.textContent = "ここに文字起こし結果が表示されます。";
      liveTranscript.appendChild(span);
      return;
    }
    if (finalText) {
      const finalSpan = document.createElement("span");
      finalSpan.className = "final-text";
      finalSpan.textContent = finalText;
      liveTranscript.appendChild(finalSpan);
    }
    if (interimText) {
      const interimSpan = document.createElement("span");
      interimSpan.className = "interim-text";
      interimSpan.textContent = interimText;
      liveTranscript.appendChild(interimSpan);
    }
    liveTranscript.scrollTop = liveTranscript.scrollHeight;
  }

  // ---------- recognition control ----------

  function createRecognition() {
    const recognition = new SpeechRecognitionImpl();
    recognition.lang = state.settings.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      state.consecutiveFailures = 0;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          state.currentSession.transcript += result[0].transcript;
          saveSessions();
        } else {
          interim += result[0].transcript;
        }
      }
      renderLiveTranscript(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "audio-capture") {
        recordError.textContent =
          event.error === "not-allowed"
            ? "マイクの使用が許可されていません。ブラウザの設定を確認してください。"
            : "マイクにアクセスできませんでした。デバイスを確認してください。";
        recordError.classList.remove("hidden");
        stopRecording(true);
      }
      // other errors (no-speech, network, aborted) are handled via onend + auto-restart
    };

    recognition.onend = () => {
      if (!state.recording || state.manualStop) return;

      const now = Date.now();
      state.restartTimestamps.push(now);
      state.restartTimestamps = state.restartTimestamps.filter((t) => now - t < 15000);

      if (state.restartTimestamps.length > 8) {
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= 3) {
          notifyProblem();
        }
        setTimeout(() => restartRecognition(), 5000);
      } else {
        setTimeout(() => restartRecognition(), 250);
      }
    };

    return recognition;
  }

  function restartRecognition() {
    if (!state.recording || state.manualStop) return;
    try {
      state.recognition = createRecognition();
      state.recognition.start();
      setStatus("live", "文字起こし中");
    } catch {
      setTimeout(() => restartRecognition(), 1000);
    }
  }

  function notifyProblem() {
    if (state.settings.notify && "Notification" in window && Notification.permission === "granted") {
      new Notification("文字起こしが不安定です", {
        body: "認識の再接続を繰り返しています。タブを確認してください。",
      });
    }
    setStatus("warn", "再接続中...（不安定）");
  }

  // ---------- start / stop ----------

  async function startRecording() {
    recordError.classList.add("hidden");
    try {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      recordError.textContent = "マイクへのアクセスが拒否されました：" + err.message;
      recordError.classList.remove("hidden");
      return;
    }

    state.currentSession = {
      id: `s_${Date.now()}`,
      startedAt: Date.now(),
      endedAt: null,
      transcript: "",
      lang: state.settings.lang,
      hasAudio: false,
    };
    state.sessions.push(state.currentSession);
    saveSessions();

    state.recording = true;
    state.manualStop = false;
    state.restartTimestamps = [];
    state.consecutiveFailures = 0;
    state.audioChunks = [];

    const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
    state.mediaRecorder = new MediaRecorder(state.mediaStream, mimeType ? { mimeType } : undefined);
    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
    };
    state.mediaRecorder.start(1000);

    state.recognition = createRecognition();
    state.recognition.start();

    startKeepalive();
    requestWakeLock();

    state.timerInterval = setInterval(updateElapsed, 1000);
    elapsedTimeEl.classList.remove("hidden");
    downloadAudioBtn.classList.add("hidden");

    setStatus("live", "文字起こし中");
    toggleBtn.textContent = "録音・文字起こしを停止";
    toggleBtn.classList.add("recording");
    renderLiveTranscript("");
  }

  async function stopRecording(dueToError = false) {
    state.recording = false;
    state.manualStop = true;

    if (state.recognition) {
      try {
        state.recognition.onend = null;
        state.recognition.stop();
      } catch {}
      state.recognition = null;
    }

    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      await new Promise((resolve) => {
        state.mediaRecorder.onstop = resolve;
        state.mediaRecorder.stop();
      });
    }

    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((t) => t.stop());
      state.mediaStream = null;
    }

    stopKeepalive();
    releaseWakeLock();
    clearInterval(state.timerInterval);
    elapsedTimeEl.classList.add("hidden");

    if (state.currentSession) {
      state.currentSession.endedAt = Date.now();

      if (state.audioChunks.length > 0) {
        const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
        try {
          await saveAudioBlob(state.currentSession.id, blob);
          state.currentSession.hasAudio = true;
          state.currentSession.mimeType = blob.type;
          if (state.lastAudioBlobUrl) URL.revokeObjectURL(state.lastAudioBlobUrl);
          state.lastAudioBlobUrl = URL.createObjectURL(blob);
          downloadAudioBtn.classList.remove("hidden");
        } catch {
          // audio storage failed; transcript is still preserved
        }
      }
      saveSessions();
    }

    setStatus(dueToError ? "error" : "idle", dueToError ? "エラーで停止しました" : "停止中");
    toggleBtn.textContent = "録音・文字起こしを開始";
    toggleBtn.classList.remove("recording");
    state.currentSession = null;
  }

  toggleBtn.addEventListener("click", () => {
    if (state.recording) {
      stopRecording(false);
    } else {
      startRecording();
    }
  });

  copyCurrentBtn.addEventListener("click", async () => {
    const text = state.currentSession
      ? state.currentSession.transcript
      : (state.sessions[state.sessions.length - 1]?.transcript || "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyCurrentBtn.textContent = "コピーしました";
    } catch {
      copyCurrentBtn.textContent = "コピーに失敗しました";
    }
    setTimeout(() => (copyCurrentBtn.textContent = "現在の文字起こしをコピー"), 1500);
  });

  downloadAudioBtn.addEventListener("click", () => {
    if (!state.lastAudioBlobUrl) return;
    const a = document.createElement("a");
    a.href = state.lastAudioBlobUrl;
    a.download = `recording_${Date.now()}.webm`;
    a.click();
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.recording) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------- history ----------

  function formatDuration(ms) {
    const secs = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderHistory() {
    const listEl = document.getElementById("history-list");
    const emptyMsg = document.getElementById("history-empty-msg");
    listEl.innerHTML = "";

    const finished = state.sessions.filter((s) => s.endedAt);
    if (finished.length === 0) {
      emptyMsg.classList.remove("hidden");
      return;
    }
    emptyMsg.classList.add("hidden");

    [...finished].reverse().forEach((session) => {
      const el = document.createElement("div");
      el.className = "history-item";

      const date = document.createElement("p");
      date.className = "h-date";
      date.textContent =
        new Date(session.startedAt).toLocaleString("ja-JP") +
        `（${formatDuration(session.endedAt - session.startedAt)}）`;

      const text = document.createElement("p");
      text.className = "h-text";
      text.textContent = session.transcript || "（文字起こし結果なし）";

      const actions = document.createElement("div");
      actions.className = "btn-row";

      const copyBtn = document.createElement("button");
      copyBtn.className = "secondary-btn small-btn";
      copyBtn.textContent = "コピー";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(session.transcript || "");
        copyBtn.textContent = "コピーしました";
        setTimeout(() => (copyBtn.textContent = "コピー"), 1200);
      });

      const dlTextBtn = document.createElement("button");
      dlTextBtn.className = "secondary-btn small-btn";
      dlTextBtn.textContent = "テキスト保存";
      dlTextBtn.addEventListener("click", () => {
        downloadText(`transcript_${session.id}.txt`, session.transcript || "");
      });

      actions.append(copyBtn, dlTextBtn);

      if (session.hasAudio) {
        const audioBtn = document.createElement("button");
        audioBtn.className = "secondary-btn small-btn";
        audioBtn.textContent = "音声を読み込む";
        audioBtn.addEventListener("click", async () => {
          const blob = await loadAudioBlob(session.id);
          if (!blob) {
            audioBtn.textContent = "音声が見つかりません";
            return;
          }
          const url = URL.createObjectURL(blob);
          const audioEl = document.createElement("audio");
          audioEl.controls = true;
          audioEl.src = url;
          audioEl.className = "history-audio";
          audioBtn.replaceWith(audioEl);
        });
        actions.appendChild(audioBtn);
      }

      const delBtn = document.createElement("button");
      delBtn.className = "item-delete-btn";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", async () => {
        const idx = state.sessions.indexOf(session);
        if (idx !== -1) state.sessions.splice(idx, 1);
        saveSessions();
        if (session.hasAudio) await deleteAudioBlob(session.id).catch(() => {});
        renderHistory();
      });

      el.append(date, text, actions, delBtn);
      listEl.appendChild(el);
    });
  }

  // ---------- init ----------

  if (!SpeechRecognitionImpl) {
    unsupportedMsg.classList.remove("hidden");
    toggleBtn.disabled = true;
    toggleBtn.title = "このブラウザは音声認識に対応していません";
  }

  renderHistory();
})();
