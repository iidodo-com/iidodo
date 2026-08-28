import { useEffect, useState } from "react";
import { fetchContextStatus, reloadContext } from "../lib/api";
import type { ContextStatus } from "../lib/types";

export function ContextBar() {
  const [status, setStatus] = useState<ContextStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchContextStatus()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  const handleReload = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await reloadContext();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 text-xs text-gray-500 bg-white">
      <div className="flex items-center gap-3">
        <span className="font-medium text-gray-700">私ならこう答える</span>
        {status && (
          <span>
            context: {status.files.map((f) => f.name).join(", ")}
            {status.reloadedAt && ` （読込 ${new Date(status.reloadedAt).toLocaleTimeString("ja-JP")}）`}
          </span>
        )}
        {error && <span className="text-red-500">{error}</span>}
      </div>
      <button
        type="button"
        onClick={handleReload}
        disabled={loading}
        className="px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
      >
        {loading ? "読込中…" : "contextをリロード"}
      </button>
    </div>
  );
}
