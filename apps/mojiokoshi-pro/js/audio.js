/* 送信前の音量チェック（ブラウザ内でデコードして解析。音声は外部送信しない） */
(function (g) {
  const MP = g.MP;
  const WIN_SEC = 0.05;      // 50ms窓
  const SILENCE_DB = -50;    // これ未満の窓は無音扱い
  // しきい値は経験則（ヒューリスティック）。本番では実音声で較正すること。
  const TH = { bad: -42, warn: -32, silenceWarn: 0.6, silenceBad: 0.95, clip: 0.01 };

  const MAX_DECODE_BYTES = 50 * 1024 * 1024; // これを超えるとデコード時のメモリ消費が大きいため解析を省略
  const toDb = (x) => (x > 0 ? 20 * Math.log10(x) : -120);

  MP.audio = {
    TH,
    async analyze(file) {
      if (file.size > MAX_DECODE_BYTES) {
        return unknown('ファイルが大きいため（50MB超）、ブラウザ内の音量解析を省略しました。送信は可能ですが、音量は確認できていません。');
      }
      const Ctx = g.AudioContext || g.webkitAudioContext;
      if (!Ctx) return unknown('このブラウザは音声解析に対応していません。送信は可能ですが、音量は確認できていません。');
      const ctx = new Ctx();
      try {
        const buf = await ctx.decodeAudioData(await file.arrayBuffer());
        const ch = buf.getChannelData(0);
        const sr = buf.sampleRate;
        const win = Math.max(1, Math.floor(sr * WIN_SEC));
        const nWin = Math.ceil(ch.length / win);
        let peak = 0, clipped = 0, silent = 0, sumSq = 0, nActive = 0;
        const binCount = 160, peaks = new Array(binCount).fill(0);
        for (let w = 0; w < nWin; w++) {
          const s = w * win, e = Math.min(ch.length, s + win);
          let sq = 0, wp = 0;
          for (let i = s; i < e; i++) {
            const a = Math.abs(ch[i]);
            sq += a * a;
            if (a > wp) wp = a;
            if (a >= 0.999) clipped++;
          }
          const rms = Math.sqrt(sq / (e - s));
          if (wp > peak) peak = wp;
          if (toDb(rms) < SILENCE_DB) silent++;
          else { sumSq += sq / (e - s); nActive++; }
          const b = Math.min(binCount - 1, Math.floor((w / nWin) * binCount));
          if (wp > peaks[b]) peaks[b] = wp;
        }
        const rmsDb = nActive ? toDb(Math.sqrt(sumSq / nActive)) : -120; // 有音区間の平均RMS
        const peakDb = toDb(peak);
        const silenceRatio = nWin ? silent / nWin : 1;
        const clipRatio = ch.length ? clipped / ch.length : 0;
        const messages = [];
        let level = 'ok';
        const raise = (l) => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };

        if (nActive === 0 || peakDb < -60 || silenceRatio >= TH.silenceBad) {
          raise('bad'); messages.push('ほぼ無音です。音声が含まれていない可能性があります。');
        } else if (rmsDb < TH.bad) {
          raise('bad'); messages.push('音量が非常に小さいです。聞き取れない箇所が多くなり、「聞き取れませんでした」が増えます。');
        } else if (rmsDb < TH.warn) {
          raise('warn'); messages.push('音量がやや小さめです。精度が下がる可能性があります。');
        }
        if (silenceRatio >= TH.silenceWarn && level !== 'bad') {
          raise('warn'); messages.push(`無音区間が ${(silenceRatio * 100).toFixed(0)}% を占めます。`);
        }
        if (clipRatio > TH.clip) {
          raise('warn'); messages.push('音割れ（クリッピング）が検出されました。録音レベルを下げて再録音すると改善します。');
        }
        if (!messages.length) messages.push('音量は問題ありません。');
        return { level, duration: buf.duration, rmsDb, peakDb, silenceRatio, clipRatio, messages, peaks };
      } catch (e) {
        return unknown('ブラウザで音声を解析できませんでした（形式未対応または破損の可能性）。送信は可能ですが、音量は確認できていません。実行に失敗する場合は MP3 または WAV に変換してください。');
      } finally {
        try { ctx.close(); } catch (e) {}
      }
    },

    /** 波形をcanvasに描画 */
    drawWave(canvas, peaks, level) {
      const dpr = g.devicePixelRatio || 1;
      const w = canvas.clientWidth || 600, h = canvas.clientHeight || 80;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const c = canvas.getContext('2d');
      c.scale(dpr, dpr);
      c.clearRect(0, 0, w, h);
      const cs = getComputedStyle(document.documentElement);
      c.fillStyle = cs.getPropertyValue(level === 'bad' ? '--bad' : level === 'warn' ? '--warn' : '--accent').trim() || '#2563eb';
      const bw = w / peaks.length;
      peaks.forEach((p, i) => {
        const bh = Math.max(1, p * (h - 4));
        c.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 1), bh);
      });
    },
  };

  function unknown(msg) {
    return { level: 'unknown', duration: 0, rmsDb: null, peakDb: null, silenceRatio: null, clipRatio: null, messages: [msg], peaks: [] };
  }
})(window);
