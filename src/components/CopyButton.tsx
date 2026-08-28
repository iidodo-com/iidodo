import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API が使えない環境ではボタン自体は表示したまま何もしない
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50 whitespace-nowrap"
    >
      {copied ? "コピーしました" : "コピー"}
    </button>
  );
}
