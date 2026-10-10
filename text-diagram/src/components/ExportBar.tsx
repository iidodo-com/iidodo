import { Braces, Download, FileImage, LayoutGrid } from 'lucide-react';

export function ExportBar({
  disabled,
  onLayout,
  onPng,
  onSvg,
  onJson,
}: {
  disabled: boolean;
  onLayout: () => void;
  onPng: () => void;
  onSvg: () => void;
  onJson: () => void;
}) {
  const b =
    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700';
  return (
    <div className="absolute right-2 top-2 md:right-4 md:top-4 flex flex-wrap items-center gap-0.5 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
      <button type="button" className={b} disabled={disabled} onClick={onLayout} title="自動レイアウトをやり直す">
        <LayoutGrid size={14} /> <span className="hidden sm:inline">再配置</span>
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-600" />
      <button type="button" className={b} disabled={disabled} onClick={onPng} title="PNG（2x）で保存">
        <FileImage size={14} /> <span className="hidden sm:inline">PNG</span>
      </button>
      <button type="button" className={b} disabled={disabled} onClick={onSvg} title="SVGで保存">
        <Download size={14} /> <span className="hidden sm:inline">SVG</span>
      </button>
      <button type="button" className={b} onClick={onJson} title="JSONのコピー・読み込み">
        <Braces size={14} /> <span className="hidden sm:inline">JSON</span>
      </button>
    </div>
  );
}
