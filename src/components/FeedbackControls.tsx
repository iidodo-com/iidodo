import { useState } from "react";
import { sendFeedback } from "../lib/api";
import type { Verdict } from "../lib/types";

export function FeedbackControls({ historyId }: { historyId: string }) {
  const [sent, setSent] = useState<Verdict | null>(null);
  const [showEditBox, setShowEditBox] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (verdict: Verdict, text?: string) => {
    setSubmitting(true);
    try {
      const res = await sendFeedback({ historyId, verdict, editedText: text });
      setSent(verdict);
      setShowEditBox(false);
      if (res.ruleUpdate.action !== "skip" && res.ruleUpdate.rule) {
        setRuleMessage(
          `学習メモに${res.ruleUpdate.action === "add" ? "追記" : "更新"}しました：「${res.ruleUpdate.rule}」`
        );
      } else if (verdict === "adopt_edited") {
        setRuleMessage("今回の修正からは、再利用可能なルールは抽出されませんでした。");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="text-sm text-gray-600 border-t border-gray-100 pt-3 mt-3">
        評価を記録しました（{labelOf(sent)}）。
        {ruleMessage && <div className="text-xs text-gray-500 mt-1">{ruleMessage}</div>}
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 pt-3 mt-3">
      <div className="text-xs text-gray-500 mb-2">この回答案を評価してください</div>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          disabled={submitting}
          onClick={() => submit("adopt")}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
        >
          採用
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => setShowEditBox((v) => !v)}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
        >
          修正して採用
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => submit("reject")}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
        >
          不採用
        </button>
      </div>
      {showEditBox && (
        <div className="mt-2">
          <textarea
            value={editedText}
            onChange={(e) => setEditedText(e.target.value)}
            placeholder="実際に使った（修正後の）本文を貼り付けてください"
            className="w-full border border-gray-300 rounded p-2 text-sm h-28"
          />
          <button
            type="button"
            disabled={submitting || !editedText.trim()}
            onClick={() => submit("adopt_edited", editedText)}
            className="mt-1.5 px-3 py-1.5 text-sm rounded bg-gray-900 text-white disabled:opacity-50"
          >
            この内容で記録する
          </button>
        </div>
      )}
    </div>
  );
}

function labelOf(v: Verdict): string {
  if (v === "adopt") return "採用";
  if (v === "adopt_edited") return "修正して採用";
  return "不採用";
}
