import { motion } from 'framer-motion';
import { ArrowRight, ClipboardPaste, MousePointer2, Sparkles, Wand2 } from 'lucide-react';

const steps = [
  { icon: ClipboardPaste, title: 'テキストを入力', body: '会議メモ・ニュース・あらすじなどを左のパネルに貼り付け' },
  { icon: Sparkles, title: '「図解を生成」', body: '登場要素と関係を自動で抽出し、図として配置します' },
  { icon: MousePointer2, title: '触って整える', body: 'ドラッグ・ズーム・クリックで強調。PNG / SVG / JSONで書き出し' },
];

export function EmptyState({ onTry }: { onTry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 grid place-items-center p-6"
    >
      <div className="pointer-events-auto max-w-xl text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-400 to-violet-500 text-white shadow-lg">
          <Wand2 size={26} />
        </div>
        <h2 className="text-xl font-bold">テキストから、図をつくる</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          APIキーなしでも動きます。まずはサンプルで試してみましょう。
        </p>
        <ol className="mt-6 grid gap-3 text-left sm:grid-cols-3">
          {steps.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              className="rounded-xl border border-slate-200 bg-white/80 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80"
            >
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <s.icon size={15} className="text-blue-500" />
                {i + 1}. {s.title}
              </div>
              <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{s.body}</p>
            </motion.li>
          ))}
        </ol>
        <button type="button" onClick={onTry} className="btn-primary mt-6">
          三国志のサンプルで試す <ArrowRight size={15} />
        </button>
      </div>
    </motion.div>
  );
}
