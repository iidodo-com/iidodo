import type { Length, Recipient, Scene } from "./prompt";

export interface DraftOutput {
  estimated_recipient: string | null;
  estimated_scene: string | null;
  estimated_length: string | null;
  answer: string;
  reasons: string[];
  risks: string;
  alternative: string;
}

export interface WallbounceCritique {
  verdict: "通る" | "条件付き" | "通らない";
  verdict_reason: string;
  anticipated_questions: { question: string; response: string }[];
  verification_points: string;
}

export interface WallbounceEdit {
  changes: { location: string; before: string; after: string; reason: string }[];
  revised_text: string;
}

export type GenerateRequest =
  | {
      mode: "draft";
      text: string;
      recipient: Recipient | null;
      scene: Scene | null;
      length: Length | null;
    }
  | {
      mode: "wallbounce_critique";
      text: string;
      myAnswer: string;
      recipient: Recipient | null;
      scene: Scene | null;
    }
  | {
      mode: "wallbounce_edit";
      text: string;
      myAnswer: string;
    };

export type GenerateResponse =
  | { mode: "draft"; historyId: string; output: DraftOutput }
  | { mode: "wallbounce_critique"; historyId: string; output: WallbounceCritique }
  | { mode: "wallbounce_edit"; historyId: string; output: WallbounceEdit };

export type Verdict = "adopt" | "adopt_edited" | "reject";

export interface FeedbackRequest {
  historyId: string;
  verdict: Verdict;
  editedText?: string;
}

export interface FeedbackResponse {
  ok: true;
  ruleUpdate: { action: "add" | "update" | "skip"; rule: string | null };
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  mode: "draft" | "wallbounce_critique" | "wallbounce_edit";
  input: {
    text: string;
    myAnswer?: string;
    recipient: Recipient | null;
    scene: Scene | null;
    length?: Length | null;
  };
  output: DraftOutput | WallbounceCritique | WallbounceEdit;
  feedback?: {
    verdict: Verdict;
    editedText?: string;
    ruleAction?: "add" | "update" | "skip";
    rule?: string | null;
  };
}

export interface ContextStatus {
  files: { name: string; mtime: string; chars: number }[];
  reloadedAt: string;
}
