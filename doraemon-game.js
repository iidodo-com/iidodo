(() => {
  const HIGH_SCORE_KEY = "doraemon-catch.highScore.v1";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const scoreEl = document.getElementById("score");
  const highScoreEl = document.getElementById("high-score");
  const livesEl = document.getElementById("lives");
  const startOverlay = document.getElementById("start-overlay");
  const gameoverOverlay = document.getElementById("gameover-overlay");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const finalScoreLine = document.getElementById("final-score-line");
  const newRecordLine = document.getElementById("new-record-line");

  const GROUND_Y = H - 60;
  const PLAYER_W = 70;
  const PLAYER_H = 70;
  const PLAYER_SPEED = 7;

  let highScore = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
  highScoreEl.textContent = highScore;

  const state = {
    running: false,
    score: 0,
    lives: 3,
    player: { x: W / 2, targetX: W / 2, invincibleUntil: 0, multiplierUntil: 0 },
    items: [],
    keys: { left: false, right: false },
    pointerDown: false,
    pointerX: null,
    spawnTimer: 0,
    elapsed: 0,
    lastTime: 0,
  };

  // ---------- audio (simple WebAudio beeps, no external assets) ----------

  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    return audioCtx;
  }

  function beep(freq, duration, type = "sine", gain = 0.15, delay = 0) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ac.destination);
    const t0 = ac.currentTime + delay;
    osc.start(t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.stop(t0 + duration);
  }

  function sfxCatch() {
    beep(880, 0.12, "square", 0.12);
  }
  function sfxBonus() {
    beep(660, 0.08, "square", 0.12);
    beep(990, 0.14, "square", 0.12, 0.08);
  }
  function sfxHit() {
    beep(160, 0.25, "sawtooth", 0.18);
  }
  function sfxPowerup() {
    beep(520, 0.08, "triangle", 0.14);
    beep(780, 0.08, "triangle", 0.14, 0.09);
    beep(1040, 0.15, "triangle", 0.14, 0.18);
  }
  function sfxGameOver() {
    beep(300, 0.2, "sawtooth", 0.16);
    beep(220, 0.3, "sawtooth", 0.16, 0.18);
  }

  // ---------- input ----------

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.keys.left = true;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.keys.right = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") state.keys.left = false;
    if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") state.keys.right = false;
  });

  function canvasXFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return ((clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener("pointerdown", (e) => {
    state.pointerDown = true;
    state.pointerX = canvasXFromEvent(e);
  });
  window.addEventListener("pointermove", (e) => {
    if (state.pointerDown) state.pointerX = canvasXFromEvent(e);
  });
  window.addEventListener("pointerup", () => {
    state.pointerDown = false;
  });

  // ---------- item spawning ----------

  const ITEM_TYPES = [
    { type: "dorayaki", weight: 60, score: 10, radius: 20 },
    { type: "kuri", weight: 12, score: 30, radius: 18 },
    { type: "bomb", weight: 22, score: 0, radius: 18 },
    { type: "copter", weight: 6, score: 5, radius: 18 },
  ];
  const TOTAL_WEIGHT = ITEM_TYPES.reduce((s, t) => s + t.weight, 0);

  function pickItemType() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const t of ITEM_TYPES) {
      if (r < t.weight) return t;
      r -= t.weight;
    }
    return ITEM_TYPES[0];
  }

  function difficultyFactor() {
    return Math.min(1 + state.elapsed / 30, 2.6);
  }

  function spawnItem() {
    const def = pickItemType();
    const x = 30 + Math.random() * (W - 60);
    const baseSpeed = 90 + Math.random() * 40;
    state.items.push({
      def,
      x,
      y: -30,
      vy: baseSpeed * difficultyFactor(),
      rot: 0,
      caught: false,
    });
  }

  // ---------- game lifecycle ----------

  function resetGame() {
    state.score = 0;
    state.lives = 3;
    state.items = [];
    state.player.x = W / 2;
    state.player.targetX = W / 2;
    state.player.invincibleUntil = 0;
    state.player.multiplierUntil = 0;
    state.spawnTimer = 0;
    state.elapsed = 0;
    updateHud();
  }

  function startGame() {
    ensureAudio();
    resetGame();
    state.running = true;
    startOverlay.classList.add("hidden");
    gameoverOverlay.classList.add("hidden");
    state.lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function endGame() {
    state.running = false;
    sfxGameOver();
    const isRecord = state.score > highScore;
    if (isRecord) {
      highScore = state.score;
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
      highScoreEl.textContent = highScore;
    }
    finalScoreLine.textContent = `スコア: ${state.score}`;
    newRecordLine.classList.toggle("hidden", !isRecord);
    gameoverOverlay.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startGame);
  retryBtn.addEventListener("click", startGame);

  function updateHud() {
    scoreEl.textContent = state.score;
    livesEl.textContent = "♥".repeat(Math.max(state.lives, 0)) + "♡".repeat(Math.max(3 - state.lives, 0));
  }

  // ---------- update ----------

  function updatePlayer(dt) {
    const p = state.player;
    if (state.pointerX !== null && state.pointerDown) {
      p.targetX = state.pointerX;
    }
    if (state.keys.left) p.targetX = p.x - PLAYER_SPEED * 3;
    if (state.keys.right) p.targetX = p.x + PLAYER_SPEED * 3;

    const dx = p.targetX - p.x;
    const maxStep = PLAYER_SPEED * (state.keys.left || state.keys.right ? 1 : 2.2);
    if (Math.abs(dx) < maxStep) {
      p.x = p.targetX;
    } else {
      p.x += Math.sign(dx) * maxStep;
    }
    p.x = Math.max(PLAYER_W / 2, Math.min(W - PLAYER_W / 2, p.x));
  }

  function checkCatch(item) {
    const p = state.player;
    const dx = item.x - p.x;
    const dy = item.y - (GROUND_Y - PLAYER_H / 4);
    const catchRadiusX = PLAYER_W / 2 + item.def.radius * 0.6;
    const catchRadiusY = 28;
    return Math.abs(dx) < catchRadiusX && Math.abs(dy) < catchRadiusY;
  }

  function onItemCaught(item) {
    const now = state.elapsed;
    const invincible = now < state.player.invincibleUntil;
    const multiplier = now < state.player.multiplierUntil ? 2 : 1;

    if (item.def.type === "bomb") {
      if (invincible) {
        state.score += 5;
        sfxBonus();
      } else {
        state.lives -= 1;
        sfxHit();
        if (state.lives <= 0) {
          updateHud();
          endGame();
          return;
        }
      }
    } else if (item.def.type === "copter") {
      state.player.invincibleUntil = now + 5;
      state.player.multiplierUntil = now + 5;
      state.score += item.def.score * multiplier;
      sfxPowerup();
    } else if (item.def.type === "kuri") {
      state.score += item.def.score * multiplier;
      sfxBonus();
    } else {
      state.score += item.def.score * multiplier;
      sfxCatch();
    }
    updateHud();
  }

  function update(dt) {
    state.elapsed += dt;
    updatePlayer(dt);

    const spawnInterval = Math.max(0.35, 0.95 - state.elapsed / 60);
    state.spawnTimer += dt;
    if (state.spawnTimer >= spawnInterval) {
      state.spawnTimer = 0;
      spawnItem();
    }

    for (const item of state.items) {
      if (item.caught) continue;
      item.y += item.vy * dt;
      item.rot += dt * 3;
      if (!item.caught && item.y > GROUND_Y - PLAYER_H / 3 && item.y < GROUND_Y + 30) {
        if (checkCatch(item)) {
          item.caught = true;
          item.remove = true;
          onItemCaught(item);
        }
      }
      if (item.y > H + 30) {
        item.remove = true;
      }
    }
    state.items = state.items.filter((i) => !i.remove);
  }

  // ---------- drawing ----------

  function drawBackground() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#cdeeff";
    ctx.fillRect(0, 0, W, H);

    // soft clouds
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    drawCloud(70, 90, 1);
    drawCloud(290, 150, 0.8);
    drawCloud(180, 60, 0.6);

    // ground
    ctx.fillStyle = "#bfe6a8";
    ctx.fillRect(0, GROUND_Y + 20, W, H - GROUND_Y - 20);
    ctx.fillStyle = "#a9d98e";
    ctx.fillRect(0, GROUND_Y + 20, W, 8);
  }

  function drawCloud(x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.arc(22, -6, 16, 0, Math.PI * 2);
    ctx.arc(-20, -4, 14, 0, Math.PI * 2);
    ctx.arc(10, 8, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const p = state.player;
    const now = state.elapsed;
    const invincible = now < p.invincibleUntil;
    const cx = p.x;
    const cy = GROUND_Y;

    ctx.save();
    ctx.translate(cx, cy);

    if (invincible) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 12);
      ctx.save();
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.beginPath();
      ctx.arc(0, -PLAYER_H / 2, PLAYER_W / 2 + 12, 0, Math.PI * 2);
      ctx.fillStyle = "#ffe17a";
      ctx.fill();
      ctx.restore();
    }

    // shadow
    ctx.beginPath();
    ctx.ellipse(0, 6, PLAYER_W / 2.3, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fill();

    const r = PLAYER_W / 2;
    // body (round blue robot cat, flat-top head referencing the missing ears)
    ctx.beginPath();
    ctx.arc(0, -r, r, Math.PI, 0, false);
    ctx.lineTo(r, -r + 10);
    ctx.quadraticCurveTo(r, -6, 0, -2);
    ctx.quadraticCurveTo(-r, -6, -r, -r + 10);
    ctx.closePath();
    ctx.fillStyle = "#2aa3e0";
    ctx.fill();

    // flat top of head (ears removed detail)
    ctx.beginPath();
    ctx.moveTo(-r + 6, -r * 1.72);
    ctx.lineTo(r - 6, -r * 1.72);
    ctx.quadraticCurveTo(r, -r * 1.62, r, -r);
    ctx.arc(0, -r, r, Math.PI, 0, false);
    ctx.quadraticCurveTo(-r, -r * 1.62, -r + 6, -r * 1.72);
    ctx.closePath();
    ctx.fillStyle = "#2aa3e0";
    ctx.fill();

    // face (white)
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.72, r * 0.82, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    // eyes
    ctx.beginPath();
    ctx.ellipse(-r * 0.28, -r * 1.02, 10, 13, 0, 0, Math.PI * 2);
    ctx.ellipse(r * 0.28, -r * 1.02, 10, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.28 + 3, -r * 1.0, 4, 0, Math.PI * 2);
    ctx.arc(r * 0.28 + 3, -r * 1.0, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#1a1a1a";
    ctx.fill();

    // nose
    ctx.beginPath();
    ctx.arc(0, -r * 0.86, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#e8433a";
    ctx.fill();

    // mouth line
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.78);
    ctx.lineTo(0, -r * 0.45);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -r * 0.42, 22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    // whiskers
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#444";
    [-1, 1].forEach((side) => {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(side * r * 0.5, -r * 0.62 + i * 9);
        ctx.lineTo(side * (r * 0.5 + 26), -r * 0.62 + i * 9 - side * 0 + i * 2);
        ctx.stroke();
      }
    });

    // collar + bell
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.86, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.strokeStyle = "#e8433a";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, -r * 0.02, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd23f";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, -r * 0.02, 9, 0, Math.PI * 2);
    ctx.strokeStyle = "#c8940f";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -r * 0.02);
    ctx.lineTo(9, -r * 0.02);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -r * 0.02 + 3, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#c8940f";
    ctx.fill();

    ctx.restore();
  }

  function drawItem(item) {
    const { x, y, def, rot } = item;
    ctx.save();
    ctx.translate(x, y);

    if (def.type === "dorayaki") {
      ctx.rotate(Math.sin(rot) * 0.15);
      ctx.beginPath();
      ctx.ellipse(0, -6, def.radius, def.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#c9903f";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 6, def.radius, def.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#a5672b";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, def.radius - 2, def.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#5a3414";
      ctx.fill();
    } else if (def.type === "kuri") {
      ctx.rotate(Math.sin(rot) * 0.15);
      ctx.beginPath();
      ctx.ellipse(0, -6, def.radius, def.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f0c23f";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 6, def.radius, def.radius * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#d99e1e";
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, def.radius - 2, def.radius * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4d0";
      ctx.fill();
      ctx.font = "bold 12px sans-serif";
      ctx.fillStyle = "#a5672b";
      ctx.textAlign = "center";
      ctx.fillText("金", 0, 4);
    } else if (def.type === "bomb") {
      ctx.beginPath();
      ctx.arc(0, 4, def.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#222";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-def.radius * 0.3, -def.radius * 0.3, def.radius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fill();
      ctx.strokeStyle = "#8a5a2a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 4 - def.radius);
      ctx.quadraticCurveTo(8, -def.radius - 4, 4, -def.radius - 12);
      ctx.stroke();
      const sparkPulse = 0.5 + 0.5 * Math.sin(rot * 6);
      ctx.beginPath();
      ctx.arc(4, -def.radius - 12, 3 + sparkPulse * 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffcf3f";
      ctx.fill();
    } else if (def.type === "copter") {
      ctx.rotate(rot * 8);
      ctx.beginPath();
      ctx.ellipse(0, 0, def.radius * 1.1, def.radius * 0.35, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#e8433a";
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.arc(0, 6, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd23f";
      ctx.fill();
    }

    ctx.restore();
  }

  function draw() {
    drawBackground();
    for (const item of state.items) drawItem(item);
    drawPlayer();
  }

  // ---------- loop ----------

  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // initial idle render behind start overlay
  draw();
})();
