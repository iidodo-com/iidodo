/* マスキング機能
 *  (1) 送信前マスキング: 指定区間の音声を無音化した WAV を作り、元ファイルの代わりに Gemini へ送る
 *      → 無音化した区間の内容は Google に送信されない（送信データそのものを伏せる）
 *  (2) 用語ヒントからの辞書語の除外（テキスト側の送信データ）
 *  (3) 出力時の伏せ字: 辞書の語を ■ に置換してコピー/ダウンロードする（送信後の処理）
 * 注意: 音声から氏名を自動検出して伏せることは、ブラウザ内では（文字起こし前なので）できない。
 *       送信前マスキングは利用者が時間区間を指定する方式。 */
(function (g) {
  const MP = g.MP;
  const MASK_CHAR = '■';
  const MAX_RANGES = 50;
  const MAX_MASK_BYTES = 30 * 1024 * 1024; // デコード+再サンプリングのメモリ消費を考慮した上限
  const OUT_SR = 16000;                     // 音声認識で一般的な16kHzモノラル

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** "1:23" / "01:02:03" / "83" / "83.5" → 秒。不正なら NaN */
  function parseTime(v) {
    const t = String(v == null ? '' : v).trim().replace(/：/g, ':');
    if (!t) return NaN;
    const p = t.split(':');
    if (p.length > 3 || p.some((x) => !/^\d+(\.\d+)?$/.test(x))) return NaN;
    const n = p.map(Number);
    if (p.length > 1 && n.slice(1).some((x) => x >= 60)) return NaN;
    return p.length === 1 ? n[0] : p.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  }

  /** 範囲の正規化: 範囲外のクランプ・無効除去・重複/隣接の結合・上限 */
  function normalizeRanges(ranges, duration) {
    const max = duration > 0 ? duration : Infinity;
    const rs = (ranges || [])
      .map((r) => ({ start: Math.max(0, Number(r.start)), end: Math.min(max, Number(r.end)) }))
      .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
      .sort((a, b) => a.start - b.start);
    const out = [];
    rs.forEach((r) => {
      const last = out[out.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else out.push({ start: r.start, end: r.end });
    });
    return out.slice(0, MAX_RANGES);
  }
  const totalSeconds = (rs) => rs.reduce((a, r) => a + (r.end - r.start), 0);

  /* ---------- 辞書（テキスト） ---------- */
  function parseTermsText(text) {
    return String(text || '').split(/[\n,、，]+/).map((s) => s.trim()).filter(Boolean);
  }
  function termRegex(terms) {
    const list = (terms || []).filter(Boolean).slice().sort((a, b) => b.length - a.length);
    return list.length ? new RegExp(list.map(escRe).join('|'), 'gi') : null;
  }
  /** 辞書の語を ■ に置換（最低2文字分。語の長さが推測されにくいよう最小幅を設ける） */
  function applyTerms(text, terms) {
    const re = termRegex(terms);
    if (!re || !text) return text;
    return String(text).replace(re, (m) => MASK_CHAR.repeat(Math.max(2, m.length)));
  }
  /** 用語ヒント（1行1語）から、辞書の語を含む行を除外して返す */
  function removeTermLines(glossary, terms) {
    const re = termRegex(terms);
    const lines = String(glossary || '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!re) return { text: lines.join('\n'), removed: 0 };
    const keep = lines.filter((l) => { re.lastIndex = 0; return !re.test(l); });
    return { text: keep.join('\n'), removed: lines.length - keep.length };
  }
  /** レコードの複製に伏せ字を適用（出力用。元データは変更しない） */
  function maskRecord(rec, terms) {
    const c = JSON.parse(JSON.stringify(rec));
    const m = (s) => applyTerms(s, terms);
    c.fileName = m(c.fileName);
    Object.keys(c.speakers).forEach((k) => { c.speakers[k] = m(c.speakers[k]); });
    c.transcript.forEach((s) => { s.text = m(s.text); });
    c.polished.forEach((s) => { s.text = m(s.text); });
    c.summary = c.summary.map(m); c.decisions = c.decisions.map(m);
    c.todos.forEach((t) => { t.task = m(t.task); t.owner = m(t.owner); t.due = m(t.due); });
    c.audio_notes = m(c.audio_notes);
    return c;
  }

  /* ---------- 音声（送信前マスキング） ---------- */
  function encodeWav(f32, sr) {
    const n = f32.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      const x = Math.max(-1, Math.min(1, f32[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
    return buf;
  }

  /** 指定区間を無音化した 16kHz モノラル WAV(File) を作る。タイムラインは元の音声と同一。 */
  async function buildMaskedWav(file, ranges) {
    if (file.size > MAX_MASK_BYTES) {
      throw new MP.AppError(`${MP.fmtSize(MAX_MASK_BYTES)}を超えるファイルは、送信前マスキングできません（ブラウザのメモリ制限）。`,
        '音声を短く分割するか、MP3など小さい形式に変換してから取り込んでください。');
    }
    const Ctx = g.AudioContext || g.webkitAudioContext;
    const Off = g.OfflineAudioContext || g.webkitOfflineAudioContext;
    if (!Ctx || !Off) throw new MP.AppError('このブラウザは音声の加工に対応していません。', '最新の Chrome / Edge / Safari / Firefox でお試しください。');
    let decoded;
    const ctx = new Ctx();
    try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); }
    catch (e) { throw new MP.AppError('音声をブラウザで読み込めず、マスキングできませんでした（形式未対応または破損の可能性）。', 'MP3 または WAV に変換してから、もう一度取り込んでください。'); }
    finally { try { ctx.close(); } catch (e) { /* ignore */ } }

    const rs = normalizeRanges(ranges, decoded.duration);
    const off = new Off(1, Math.max(1, Math.ceil(decoded.duration * OUT_SR)), OUT_SR);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const data = (await off.startRendering()).getChannelData(0);
    rs.forEach((r) => {
      const a = Math.max(0, Math.floor(r.start * OUT_SR)), b = Math.min(data.length, Math.ceil(r.end * OUT_SR));
      data.fill(0, a, b);
    });
    const blob = new Blob([encodeWav(data, OUT_SR)], { type: 'audio/wav' });
    return { file: new File([blob], 'masked.wav', { type: 'audio/wav' }), size: blob.size, duration: decoded.duration,
      ranges: rs, mutedSeconds: totalSeconds(rs) };
  }

  /** マスク後WAVの推定サイズ（16kHz・16bit・モノラル） */
  const estimateWavSize = (duration) => Math.round(duration * OUT_SR * 2) + 44;

  MP.mask = {
    MASK_CHAR, MAX_RANGES, MAX_MASK_BYTES, OUT_SR,
    parseTime, normalizeRanges, totalSeconds, parseTermsText, applyTerms, removeTermLines, maskRecord,
    buildMaskedWav, estimateWavSize,
  };
})(window);
