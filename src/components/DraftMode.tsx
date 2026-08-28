import { useState } from "react";
import { ChipSelect } from "./ChipSelect";
import { CopyButton } from "./CopyButton";
import { FeedbackControls } from "./FeedbackControls";
import { generate } from "../lib/api";
import type { Length, Recipient, Scene } from "../lib/prompt";
import type { DraftOutput } from "../lib/types";

const RECIPIENTS: Recipient[] = [
  "上司（課長・補佐）",
  "同僚・他課",
  "区役所などの現場",
  "他都市・国",
  "受託事業者",
  "市民",
];
const SCENES: Scene[] = ["メール返信", "口頭で答える", "会議での発言", "文書・資料に書く", "議会・市長説明の想定問答"];
const LENGTHS: Length[] = ["短め（3行以内）", "標準", "しっかり書く"];

export interface DraftPrefill {
  text: string;
  recipient: Recipient | null;
  scene: Scene | null;
  length: Length | null;
}

export function DraftMode({ prefill }: { prefill?: DraftPrefill }) {
  const [text, setText] = useState(prefill?.text ?? "");
  const [recipient, setRecipient] = useState<Recipient | null>(prefill?.recipient ?? null);
  const [scene, setScene] = useState<Scene | null>(prefill?.scene ?? null);
  const [length, setLength] = useState<Length | null>(prefill?.length ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ historyId: string; output: DraftOutput } | null>(null);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await generate({ mode: "draft", text, recipient, scene, length });
      if (res.mode === "draft") setResult({ historyId: res.historyId, output: res.output });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
      <div className="space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="質問文・メール本文・照会文をそのまま貼り付けてください"
          className="w-full h-64 border border-gray-300 rounded p-3 text-sm leading-relaxed"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ChipSelect label="相手" options={RECIPIENTS} value={recipient} onChange={setRecipient} />
          <ChipSelect label="場面" options={SCENES} value={scene} onChange={setScene} />
          <ChipSelect label="長さ" options={LENGTHS} value={length} onChange={setLength} />
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !text.trim()}
          className="px-4 py-2 rounded bg-gray-900 text-white text-sm disabled:opacity-50"
        >
          {loading ? "生成中…" : "私ならこう答える を生成"}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div>
        {!result && !loading && (
          <div className="text-sm text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
            生成結果はここに表示されます
          </div>
        )}
        {loading && <div className="text-sm text-gray-400">生成しています…</div>}
        {result && <DraftResult result={result} />}
      </div>
    </div>
  );
}

function DraftResult({ result }: { result: { historyId: string; output: DraftOutput } }) {
  const { output } = result;
  const estimations = [
    output.estimated_recipient && `相手：${output.estimated_recipient}`,
    output.estimated_scene && `場面：${output.estimated_scene}`,
    output.estimated_length && `長さ：${output.estimated_length}`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      {estimations.length > 0 && (
        <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
          未選択の項目を本文から推定しました：{estimations.join(" / ")}
        </div>
      )}

      <Block title="① 私ならこう答える" text={output.answer}>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{output.answer}</pre>
      </Block>

      <Block title="② 判断の根拠" text={output.reasons.join("\n")}>
        <ul className="list-disc list-inside text-sm space-y-1">
          {output.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Block>

      <Block title="③ 触れなかった論点・リスク" text={output.risks}>
        <p className="text-sm whitespace-pre-wrap">{output.risks}</p>
      </Block>

      <Block title="④ 別案" text={output.alternative}>
        <p className="text-sm whitespace-pre-wrap">{output.alternative}</p>
      </Block>

      <FeedbackControls historyId={result.historyId} />
    </div>
  );
}

function Block({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">{title}</span>
        <CopyButton text={text} />
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}
