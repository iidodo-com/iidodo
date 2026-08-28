import { useState } from "react";
import { ChipSelect } from "./ChipSelect";
import { CopyButton } from "./CopyButton";
import { generate } from "../lib/api";
import type { Recipient, Scene } from "../lib/prompt";
import type { WallbounceCritique, WallbounceEdit } from "../lib/types";

const RECIPIENTS: Recipient[] = [
  "上司（課長・補佐）",
  "同僚・他課",
  "区役所などの現場",
  "他都市・国",
  "受託事業者",
  "市民",
];
const SCENES: Scene[] = ["メール返信", "口頭で答える", "会議での発言", "文書・資料に書く", "議会・市長説明の想定問答"];

export function WallbounceMode() {
  const [text, setText] = useState("");
  const [myAnswer, setMyAnswer] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [loading, setLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [critique, setCritique] = useState<WallbounceCritique | null>(null);
  const [edit, setEdit] = useState<WallbounceEdit | null>(null);

  const canSubmit = text.trim() && myAnswer.trim();

  const handleCritique = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setCritique(null);
    setEdit(null);
    try {
      const res = await generate({ mode: "wallbounce_critique", text, myAnswer, recipient, scene });
      if (res.mode === "wallbounce_critique") setCritique(res.output);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!canSubmit) return;
    setEditLoading(true);
    setError(null);
    try {
      const res = await generate({ mode: "wallbounce_edit", text, myAnswer });
      if (res.mode === "wallbounce_edit") setEdit(res.output);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-4">
      <div className="space-y-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">質問・照会文</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="受け取った質問・相談・メール・照会文"
            className="w-full h-32 border border-gray-300 rounded p-3 text-sm leading-relaxed"
          />
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">本人が書いた答え</div>
          <textarea
            value={myAnswer}
            onChange={(e) => setMyAnswer(e.target.value)}
            placeholder="自分で書いた回答案を貼り付けてください"
            className="w-full h-40 border border-gray-300 rounded p-3 text-sm leading-relaxed"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChipSelect label="相手" options={RECIPIENTS} value={recipient} onChange={setRecipient} />
          <ChipSelect label="場面" options={SCENES} value={scene} onChange={setScene} />
        </div>
        <button
          type="button"
          onClick={handleCritique}
          disabled={loading || !canSubmit}
          className="px-4 py-2 rounded bg-gray-900 text-white text-sm disabled:opacity-50"
        >
          {loading ? "講評中…" : "この答えを講評する"}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div className="space-y-4">
        {!critique && !loading && (
          <div className="text-sm text-gray-400 border border-dashed border-gray-300 rounded p-6 text-center">
            講評結果はここに表示されます（代筆はしません）
          </div>
        )}
        {loading && <div className="text-sm text-gray-400">講評しています…</div>}

        {critique && (
          <>
            <div className="border border-gray-200 rounded p-3">
              <div className="text-sm font-medium text-gray-700 mb-1">
                判定：<VerdictBadge verdict={critique.verdict} />
              </div>
              <p className="text-sm whitespace-pre-wrap">{critique.verdict_reason}</p>
            </div>

            <div className="border border-gray-200 rounded p-3">
              <div className="text-sm font-medium text-gray-700 mb-2">相手から来る質問の予測</div>
              {critique.anticipated_questions.length === 0 && (
                <p className="text-sm text-gray-500">特になし</p>
              )}
              <ul className="space-y-2">
                {critique.anticipated_questions.map((q, i) => (
                  <li key={i} className="text-sm">
                    <div className="font-medium">Q. {q.question}</div>
                    <div className="text-gray-600">A. {q.response}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border border-gray-200 rounded p-3">
              <div className="text-sm font-medium text-gray-700 mb-1">裏取りが必要な箇所</div>
              <p className="text-sm whitespace-pre-wrap">{critique.verification_points}</p>
            </div>

            {!edit && (
              <button
                type="button"
                onClick={handleEdit}
                disabled={editLoading}
                className="px-4 py-2 rounded border border-gray-300 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                {editLoading ? "添削中…" : "直して（明示的に添削を依頼する）"}
              </button>
            )}
          </>
        )}

        {edit && (
          <div className="space-y-3">
            <div className="border border-gray-200 rounded">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-700">変更箇所と理由</span>
              </div>
              <div className="p-3 space-y-2">
                {edit.changes.length === 0 && <p className="text-sm text-gray-500">変更なし</p>}
                {edit.changes.map((c, i) => (
                  <div key={i} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div className="text-gray-500 text-xs mb-1">{c.location}</div>
                    <div className="line-through text-gray-400">{c.before}</div>
                    <div>{c.after}</div>
                    <div className="text-xs text-gray-500 mt-1">理由：{c.reason}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border border-gray-200 rounded">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-700">添削後の全文</span>
                <CopyButton text={edit.revised_text} />
              </div>
              <div className="p-3">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{edit.revised_text}</pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: WallbounceCritique["verdict"] }) {
  const color =
    verdict === "通る"
      ? "bg-green-100 text-green-800"
      : verdict === "条件付き"
        ? "bg-yellow-100 text-yellow-800"
        : "bg-red-100 text-red-800";
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{verdict}</span>;
}
