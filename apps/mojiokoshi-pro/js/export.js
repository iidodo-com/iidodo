/* 出力整形・コピー・ダウンロード */
(function (g) {
  const MP = g.MP;
  const name = (rec, id) => (rec.speakers && rec.speakers[id]) || `話者${id}`;
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  /* Markdown出力時のエスケープ: 本文は <> のみ（生HTMLとして解釈されるのを防ぐ）、名前・表セルは記法文字も */
  const mdText = (s) => String(s).replace(/[<>]/g, (m) => '\\' + m);
  const mdName = (s) => String(s).replace(/[\\*_`\[\]<>]/g, (m) => '\\' + m);

  const SECTIONS = [
    { key: 'transcript', title: '文字起こし全文' },
    { key: 'polished', title: '整文' },
    { key: 'summary', title: '要約' },
    { key: 'actions', title: '決定事項とToDo' },
  ];

  /** セクション本文（fmt: 'txt' | 'md'） */
  function section(rec, key, fmt) {
    const md = fmt === 'md';
    const T = md ? mdText : (x) => x;
    if (key === 'transcript') {
      return rec.transcript.map((s) => `${s.start ? `[${s.start}] ` : ''}${md ? `**${mdName(name(rec, s.spk))}**` : name(rec, s.spk)}: ${T(s.text)}`).join(md ? '\n\n' : '\n');
    }
    if (key === 'polished') {
      return rec.polished.map((s) => `${md ? `**${mdName(name(rec, s.spk))}**` : name(rec, s.spk)}: ${T(s.text)}`).join(md ? '\n\n' : '\n') || '（なし）';
    }
    if (key === 'summary') {
      return rec.summary.length ? rec.summary.map((s) => `${md ? '- ' : '・'}${T(s)}`).join('\n') : '（なし）';
    }
    // actions
    const dec = rec.decisions.length ? rec.decisions.map((d) => `${md ? '- ' : '・'}${T(d)}`).join('\n') : '（なし）';
    let todo;
    if (!rec.todos.length) todo = '（なし）';
    else if (md) {
      todo = '| 完了 | タスク | 担当 | 期限 |\n|---|---|---|---|\n' +
        rec.todos.map((t) => `| ${t.done ? '☑' : '☐'} | ${esc(mdName(t.task))} | ${esc(mdName(t.owner))} | ${esc(mdName(t.due))} |`).join('\n');
    } else {
      todo = rec.todos.map((t) => `${t.done ? '☑' : '☐'} ${t.task}（担当: ${t.owner} / 期限: ${t.due}）`).join('\n');
    }
    return md ? `### 決定事項\n\n${dec}\n\n### ToDo\n\n${todo}` : `[決定事項]\n${dec}\n\n[ToDo]\n${todo}`;
  }

  function header(rec, md) {
    const lines = [
      `ファイル: ${md ? mdText(rec.fileName) : rec.fileName}`,
      `作成日時: ${MP.fmtDate(rec.createdAt)}`,
      `モデル: ${rec.demo ? 'デモ（モックデータ）' : rec.model}`,
      '※ AIによる生成物です。聞き取れなかった箇所は「' + MP.UNINTELLIGIBLE + '」と表示しています。重要な内容は必ず原音で確認してください。',
    ];
    if (rec.preMask && rec.preMask.count) lines.splice(3, 0, `送信前マスキング: ${rec.preMask.count}区間（計${Math.round(rec.preMask.seconds)}秒）を無音化して送信`);
    if (rec.maskedOutput) lines.splice(3, 0, '出力時の伏せ字: 適用済み（辞書の語を ■ に置換）');
    return md ? lines.map((l) => `> ${l}`).join('\n') : lines.join('\n');
  }

  MP.exporter = {
    SECTIONS,
    sectionText(rec, key, fmt) { return section(rec, key, fmt || 'txt'); },
    toText(rec) {
      return `文字起こし結果\n${header(rec, false)}\n\n` +
        SECTIONS.map((s) => `■ ${s.title}\n${section(rec, s.key, 'txt')}`).join('\n\n') + '\n';
    },
    toMarkdown(rec) {
      return `# 文字起こし結果\n\n${header(rec, true)}\n\n` +
        SECTIONS.map((s) => `## ${s.title}\n\n${section(rec, s.key, 'md')}`).join('\n\n') + '\n';
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = MP.h('textarea', { 'aria-hidden': 'true', tabindex: '-1' });
        ta.style.position = 'fixed'; ta.style.opacity = '0'; // CSSOM経由（CSPのstyle-srcを緩めないため）
        ta.value = text; document.body.append(ta); ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        ta.remove();
        if (!ok) { MP.toast('コピーに失敗しました。ブラウザのクリップボード許可を確認するか、TXTでダウンロードしてください。', 'err'); return false; }
      }
      MP.toast('コピーしました');
      return true;
    },
    download(text, filename, mime) {
      const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
      const a = MP.h('a', { href: url, download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    baseName(rec) {
      return (rec.fileName || 'transcript').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') + '_文字起こし';
    },
  };
})(window);
