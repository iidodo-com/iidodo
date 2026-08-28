import { useEffect, useState } from "react";
import { fetchHistory } from "../lib/api";
import type { HistoryEntry } from "../lib/types";
import type { DraftPrefill } from "./DraftMode";

export function HistoryPanel({ onReuse }: { onReuse: (prefill: DraftPrefill) => void }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    fetchHistory()
      .then(setHistory)
      .finally(() => setLoading(false));
  }, []);

  const filtered = history.filter((h) => {
    if (!query.trim()) return true;
    const haystack = [h.input.text, h.input.myAnswer, JSON.stringify(h.output)].join(" ");
    return haystack.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
      <div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="履歴を検索"
          className="w-full border border-gray-300 rounded p-2 text-sm mb-3"
        />
        {loading && <div className="text-sm text-gray-400">読み込み中…</div>}
        {!loading && filtered.length === 0 && <div className="text-sm text-gray-400">履歴がありません</div>}
        <ul className="space-y-2">
          {filtered.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setSelected(h)}
                className={
                  "w-full text-left border rounded p-2 text-sm hover:border-gray-400 " +
                  (selected?.id === h.id ? "border-gray-900" : "border-gray-200")
                }
              >
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{modeLabel(h.mode)}</span>
                  <span>{new Date(h.timestamp).toLocaleString("ja-JP")}</span>
                </div>
                <div className="truncate">{h.input.text}</div>
                {h.feedback && (
                  <div className="text-xs text-gray-500 mt-1">評価：{feedbackLabel(h.feedback.verdict)}</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {!selected && <div className="text-sm text-gray-400">履歴を選択すると詳細が表示されます</div>}
        {selected && (
          <div className="space-y-3">
            <div className="border border-gray-200 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">入力</div>
              <pre className="whitespace-pre-wrap text-sm">{selected.input.text}</pre>
              {selected.input.myAnswer && (
                <>
                  <div className="text-xs text-gray-500 mt-2 mb-1">本人の答え</div>
                  <pre className="whitespace-pre-wrap text-sm">{selected.input.myAnswer}</pre>
                </>
              )}
            </div>
            <div className="border border-gray-200 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">出力</div>
              <pre className="whitespace-pre-wrap text-xs text-gray-700">
                {JSON.stringify(selected.output, null, 2)}
              </pre>
            </div>
            {selected.mode === "draft" && (
              <button
                type="button"
                onClick={() =>
                  onReuse({
                    text: selected.input.text,
                    recipient: selected.input.recipient,
                    scene: selected.input.scene,
                    length: selected.input.length ?? null,
                  })
                }
                className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                この入力を回答生成モードに呼び戻す
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function modeLabel(mode: HistoryEntry["mode"]): string {
  if (mode === "draft") return "回答生成";
  if (mode === "wallbounce_critique") return "壁打ち・講評";
  return "壁打ち・添削";
}

function feedbackLabel(v: string): string {
  if (v === "adopt") return "採用";
  if (v === "adopt_edited") return "修正して採用";
  return "不採用";
}
