// APIプロキシ + context読み込み + 学習メモ追記。
// Vite の dev サーバのミドルウェアとして動く（`npm run dev` だけで起動する）。
// ここでのみ Anthropic API キーを扱う。クライアントバンドルには一切含まれない。
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Connect, Plugin, ViteDevServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSystemPrompt,
  buildDraftUserMessage,
  buildWallbounceUserMessage,
  buildWallbounceEditUserMessage,
  buildLearnSystemPrompt,
  buildLearnUserMessage,
  type ContextFiles,
} from "../src/lib/prompt";
import type {
  DraftOutput,
  WallbounceCritique,
  WallbounceEdit,
  GenerateRequest,
  GenerateResponse,
  FeedbackRequest,
  FeedbackResponse,
  HistoryEntry,
  ContextStatus,
} from "../src/lib/types";

const ROOT = process.cwd();
const CONTEXT_DIR = path.join(ROOT, "context");
const DATA_DIR = path.join(ROOT, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const LEARNED_FILE = path.join(CONTEXT_DIR, "04_learned.md");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const CONTEXT_FILE_NAMES: Record<keyof ContextFiles, string> = {
  persona: "00_persona.md",
  style: "01_style.md",
  projects: "02_projects.md",
  precedents: "03_precedents.md",
  learned: "04_learned.md",
};

let contextCache: ContextFiles | null = null;
let contextLoadedAt: string = "";

async function readContextFromDisk(): Promise<ContextFiles> {
  const entries = await Promise.all(
    (Object.entries(CONTEXT_FILE_NAMES) as [keyof ContextFiles, string][]).map(
      async ([key, filename]) => {
        const p = path.join(CONTEXT_DIR, filename);
        try {
          const content = await fs.readFile(p, "utf-8");
          return [key, content] as const;
        } catch {
          return [key, ""] as const;
        }
      }
    )
  );
  return Object.fromEntries(entries) as unknown as ContextFiles;
}

async function loadContext(): Promise<ContextFiles> {
  contextCache = await readContextFromDisk();
  contextLoadedAt = new Date().toISOString();
  return contextCache;
}

async function getContext(): Promise<ContextFiles> {
  if (!contextCache) return loadContext();
  return contextCache;
}

async function getContextStatus(): Promise<ContextStatus> {
  const files = await Promise.all(
    (Object.entries(CONTEXT_FILE_NAMES) as [keyof ContextFiles, string][]).map(
      async ([key, filename]) => {
        const p = path.join(CONTEXT_DIR, filename);
        try {
          const stat = await fs.stat(p);
          const content = contextCache?.[key] ?? "";
          return { name: filename, mtime: stat.mtime.toISOString(), chars: content.length };
        } catch {
          return { name: filename, mtime: "", chars: 0 };
        }
      }
    )
  );
  return { files, reloadedAt: contextLoadedAt };
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf-8");
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

async function writeHistory(entries: HistoryEntry[]) {
  await ensureDataDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = stripCodeFence(text);
  return JSON.parse(cleaned) as T;
}

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY が設定されていません。.env に設定してください（.env.example を参照）。"
    );
  }
  return new Anthropic({ apiKey });
}

async function callClaude(system: string, userMessage: string): Promise<string> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude からテキスト応答が得られませんでした。");
  }
  return block.text;
}

function readRequestBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getLearnedLines(learnedText: string): string[] {
  return learnedText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function applyLearnedRuleUpdate(
  action: "add" | "update" | "skip",
  targetIndex: number | null,
  rule: string | null
): Promise<void> {
  if (action === "skip" || !rule) return;
  const ctx = await getContext();
  const lines = getLearnedLines(ctx.learned);
  const formatted = rule.startsWith("- ") ? rule : `- ${rule}`;

  if (action === "update" && targetIndex !== null && targetIndex >= 0 && targetIndex < lines.length) {
    lines[targetIndex] = formatted;
  } else {
    lines.push(formatted);
  }

  const newContent = lines.join("\n") + "\n";
  await fs.writeFile(LEARNED_FILE, newContent, "utf-8");
  if (contextCache) contextCache.learned = newContent;
}

async function handleGenerate(req: Connect.IncomingMessage, res: import("node:http").ServerResponse) {
  const body = JSON.parse(await readRequestBody(req)) as GenerateRequest;
  const ctx = await getContext();

  let historyEntry: HistoryEntry;

  if (body.mode === "draft") {
    const system = buildSystemPrompt(ctx, "draft");
    const userMessage = buildDraftUserMessage({
      text: body.text,
      recipient: body.recipient,
      scene: body.scene,
      length: body.length,
    });
    const raw = await callClaude(system, userMessage);
    const output = parseJsonResponse<DraftOutput>(raw);
    historyEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      mode: "draft",
      input: { text: body.text, recipient: body.recipient, scene: body.scene, length: body.length },
      output,
    };
    await appendHistory(historyEntry);
    return sendJson(res, 200, {
      mode: "draft",
      historyId: historyEntry.id,
      output,
    } satisfies GenerateResponse);
  }

  if (body.mode === "wallbounce_critique") {
    const system = buildSystemPrompt(ctx, "wallbounce_critique");
    const userMessage = buildWallbounceUserMessage({
      text: body.text,
      myAnswer: body.myAnswer,
      recipient: body.recipient,
      scene: body.scene,
    });
    const raw = await callClaude(system, userMessage);
    const output = parseJsonResponse<WallbounceCritique>(raw);
    historyEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      mode: "wallbounce_critique",
      input: {
        text: body.text,
        myAnswer: body.myAnswer,
        recipient: body.recipient,
        scene: body.scene,
      },
      output,
    };
    await appendHistory(historyEntry);
    return sendJson(res, 200, {
      mode: "wallbounce_critique",
      historyId: historyEntry.id,
      output,
    } satisfies GenerateResponse);
  }

  if (body.mode === "wallbounce_edit") {
    const system = buildSystemPrompt(ctx, "wallbounce_edit");
    const userMessage = buildWallbounceEditUserMessage({ text: body.text, myAnswer: body.myAnswer });
    const raw = await callClaude(system, userMessage);
    const output = parseJsonResponse<WallbounceEdit>(raw);
    historyEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      mode: "wallbounce_edit",
      input: { text: body.text, myAnswer: body.myAnswer, recipient: null, scene: null },
      output,
    };
    await appendHistory(historyEntry);
    return sendJson(res, 200, {
      mode: "wallbounce_edit",
      historyId: historyEntry.id,
      output,
    } satisfies GenerateResponse);
  }

  sendJson(res, 400, { error: "unknown mode" });
}

async function appendHistory(entry: HistoryEntry) {
  const history = await readHistory();
  history.push(entry);
  await writeHistory(history);
}

async function handleFeedback(req: Connect.IncomingMessage, res: import("node:http").ServerResponse) {
  const body = JSON.parse(await readRequestBody(req)) as FeedbackRequest;
  const history = await readHistory();
  const idx = history.findIndex((h) => h.id === body.historyId);
  if (idx === -1) {
    return sendJson(res, 404, { error: "history not found" });
  }
  const entry = history[idx];

  let ruleUpdate: FeedbackResponse["ruleUpdate"] = { action: "skip", rule: null };

  if (body.verdict === "adopt_edited" && body.editedText && entry.mode === "draft") {
    const draftOutput = entry.output as DraftOutput;
    const ctx = await getContext();
    const existingLines = getLearnedLines(ctx.learned);
    const system = buildLearnSystemPrompt(existingLines);
    const userMessage = buildLearnUserMessage({
      originalAnswer: draftOutput.answer,
      editedAnswer: body.editedText,
      recipient: entry.input.recipient,
      scene: entry.input.scene,
    });
    const raw = await callClaude(system, userMessage);
    const extraction = parseJsonResponse<{
      action: "add" | "update" | "skip";
      target_index: number | null;
      rule: string | null;
    }>(raw);
    await applyLearnedRuleUpdate(extraction.action, extraction.target_index, extraction.rule);
    ruleUpdate = { action: extraction.action, rule: extraction.rule };
  }

  entry.feedback = {
    verdict: body.verdict,
    editedText: body.editedText,
    ruleAction: ruleUpdate.action,
    rule: ruleUpdate.rule,
  };
  history[idx] = entry;
  await writeHistory(history);

  sendJson(res, 200, { ok: true, ruleUpdate } satisfies FeedbackResponse);
}

async function handleHistory(_req: Connect.IncomingMessage, res: import("node:http").ServerResponse) {
  const history = await readHistory();
  sendJson(res, 200, history.slice().reverse());
}

async function handleContextGet(_req: Connect.IncomingMessage, res: import("node:http").ServerResponse) {
  await getContext();
  sendJson(res, 200, await getContextStatus());
}

async function handleContextReload(_req: Connect.IncomingMessage, res: import("node:http").ServerResponse) {
  await loadContext();
  sendJson(res, 200, await getContextStatus());
}

function wrapAsync(
  handler: (req: Connect.IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>
): Connect.NextHandleFunction {
  return (req, res, next) => {
    handler(req, res).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    });
  };
}

export function apiPlugin(): Plugin {
  return {
    name: "watashi-nara-api",
    async configureServer(server: ViteDevServer) {
      await loadContext();
      await ensureDataDir();

      server.middlewares.use("/api/generate", wrapAsync(handleGenerate));
      server.middlewares.use("/api/feedback", wrapAsync(handleFeedback));
      server.middlewares.use("/api/history", wrapAsync(handleHistory));
      server.middlewares.use("/api/context/reload", (req, res, next) => {
        if (req.method !== "POST") return next();
        wrapAsync(handleContextReload)(req, res, next);
      });
      server.middlewares.use("/api/context", wrapAsync(handleContextGet));
    },
  };
}
