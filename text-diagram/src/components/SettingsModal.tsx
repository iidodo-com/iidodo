import { useEffect, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import type { Provider, Settings } from '../types';
import { Modal } from './Modal';

export const DEFAULT_MODEL: Record<Provider, string> = {
  none: '',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5-5',
};

export function SettingsModal({
  open,
  settings,
  onSave,
  onClose,
}: {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(settings);
  useEffect(() => {
    if (open) setS(settings);
  }, [open, settings]);

  const setProvider = (p: Provider) => setS((x) => ({ ...x, provider: p, model: DEFAULT_MODEL[p] }));

  return (
    <Modal open={open} title="AI設定（任意）" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        APIキーが未設定の間は、内蔵のルールベースパーサーで解析します。キーを設定すると、LLMで文章から要素と関係を抽出します（失敗時は自動でルールベースへフォールバック）。
      </p>

      <div className="mb-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="プロバイダ">
        {(
          [
            ['none', 'ルールベース'],
            ['openai', 'OpenAI'],
            ['anthropic', 'Anthropic'],
          ] as [Provider, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={s.provider === id}
            onClick={() => setProvider(id)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              s.provider === id
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {s.provider !== 'none' && (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-1 font-medium">
              <KeyRound size={14} /> APIキー
            </span>
            <input
              className="field"
              type="password"
              autoComplete="off"
              placeholder={s.provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              value={s.apiKey}
              onChange={(e) => setS({ ...s, apiKey: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">モデル</span>
            <input className="field" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
          </label>
          <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            キーはこのブラウザの localStorage にのみ保存され、各プロバイダのAPIへ直接送信されます。入力したテキストも外部へ送信されます。共用PCでは使用しないでください。
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onSave({ ...s, apiKey: s.apiKey.trim(), provider: s.provider !== 'none' && !s.apiKey.trim() ? 'none' : s.provider });
            onClose();
          }}
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
