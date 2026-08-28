import type {
  ContextStatus,
  FeedbackRequest,
  FeedbackResponse,
  GenerateRequest,
  GenerateResponse,
  HistoryEntry,
} from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `リクエストに失敗しました (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function generate(req: GenerateRequest): Promise<GenerateResponse> {
  return jsonFetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function sendFeedback(req: FeedbackRequest): Promise<FeedbackResponse> {
  return jsonFetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

export function fetchHistory(): Promise<HistoryEntry[]> {
  return jsonFetch("/api/history");
}

export function fetchContextStatus(): Promise<ContextStatus> {
  return jsonFetch("/api/context");
}

export function reloadContext(): Promise<ContextStatus> {
  return jsonFetch("/api/context/reload", { method: "POST" });
}
