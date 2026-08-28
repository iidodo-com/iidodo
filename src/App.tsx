import { useState } from "react";
import { ContextBar } from "./components/ContextBar";
import { DraftMode, type DraftPrefill } from "./components/DraftMode";
import { WallbounceMode } from "./components/WallbounceMode";
import { HistoryPanel } from "./components/HistoryPanel";

type Tab = "draft" | "wallbounce" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("draft");
  const [prefill, setPrefill] = useState<DraftPrefill | undefined>(undefined);
  const [draftKey, setDraftKey] = useState(0);

  const handleReuse = (p: DraftPrefill) => {
    setPrefill(p);
    setDraftKey((k) => k + 1);
    setTab("draft");
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <ContextBar />
      <nav className="flex gap-1 px-4 pt-3 bg-white border-b border-gray-200">
        <TabButton label="回答生成" active={tab === "draft"} onClick={() => setTab("draft")} />
        <TabButton label="壁打ちモード" active={tab === "wallbounce"} onClick={() => setTab("wallbounce")} />
        <TabButton label="履歴" active={tab === "history"} onClick={() => setTab("history")} />
      </nav>
      <main className="bg-white">
        {tab === "draft" && <DraftMode key={draftKey} prefill={prefill} />}
        {tab === "wallbounce" && <WallbounceMode />}
        {tab === "history" && <HistoryPanel onReuse={handleReuse} />}
      </main>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2 text-sm border-b-2 -mb-px " +
        (active ? "border-gray-900 text-gray-900 font-medium" : "border-transparent text-gray-500 hover:text-gray-700")
      }
    >
      {label}
    </button>
  );
}
