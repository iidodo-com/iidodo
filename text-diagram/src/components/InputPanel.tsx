import { useLayoutEffect, useRef } from 'react';
import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import type { Preset } from '../types';
import { PRESETS, SAMPLES } from '../lib/samples';

interface Props {
  text: string;
  setText: (t: string) => void;
  preset: Preset;
  setPreset: (p: Preset) => void;
  onGenerate: () => void;
  onSample: (id: string) => void;
  busy: boolean;
  aiOn: boolean;
}

export function InputPanel({ text, setText, preset, setPreset, onGenerate, onSample, busy, aiOn }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ta.current!;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 180), 520)}px`;
  }, [text]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">図解タイプ</h3>
        <div className="grid gap-1.5" role="radiogroup" aria-label="図解プリセット">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={preset === p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                preset === p.id
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/60'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
              }`}
            >
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{p.hint}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">テキスト</h3>
          <span className="text-xs text-slate-400">{text.length} 文字</span>
        </div>
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onGenerate();
          }}
          spellCheck={false}
          placeholder={'会議メモ・ニュース・物語のあらすじなどを貼り付け\n\n書き方の例:\nA → B: 関係名\nA vs B\n- 箇条書きの項目'}
          className="field resize-none leading-relaxed"
        />
        <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer select-none">書式ヒント</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>
              <code>A → B: 関係</code>、<code>A → B → C</code>、<code>A -関係-&gt; B</code>
            </li>
            <li>
              <code>A ⇔ B</code> 双方向、<code>A vs B</code> 対立
            </li>
            <li>
              <code>名前(カテゴリ)</code> で色分け、<code># 見出し</code> でグループ指定
            </li>
            <li>箇条書きは業務フローで順番に連結。「AはBを〜した」の文も解析</li>
          </ul>
        </details>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <BookOpen size={13} /> サンプル
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSample(s.id)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:text-blue-300"
            >
              {s.title}
            </button>
          ))}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-slate-200 bg-slate-50/90 px-4 pb-1 pt-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <button
          type="button"
          className="btn-primary w-full py-2.5"
          onClick={onGenerate}
          disabled={busy || !text.trim()}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? 'AIで解析中…' : '図解を生成'}
        </button>
        <p className="mt-1.5 text-center text-xs text-slate-400">
          {aiOn ? 'AI解析 ON（失敗時はルールベース）' : 'ルールベース解析'} ・ Ctrl/⌘ + Enter
        </p>
      </div>
    </div>
  );
}
