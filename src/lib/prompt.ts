// システムプロンプトの組み立て。
// 「本人の判断と文体を再現する下書き役」としての振る舞いを、
// context/*.md の内容とセットでモデルに渡すための唯一の場所。

export type Recipient =
  | "上司（課長・補佐）"
  | "同僚・他課"
  | "区役所などの現場"
  | "他都市・国"
  | "受託事業者"
  | "市民";

export type Scene =
  | "メール返信"
  | "口頭で答える"
  | "会議での発言"
  | "文書・資料に書く"
  | "議会・市長説明の想定問答";

export type Length = "短め（3行以内）" | "標準" | "しっかり書く";

export interface ContextFiles {
  persona: string;
  style: string;
  projects: string;
  precedents: string;
  learned: string;
}

const ROLE_DEFINITION = `あなたは「本人」ではない。本人の判断基準と文体を再現して下書きを作る役である。
本人になりきって一人称で断定するのではなく、本人が実際に書きそうな文章そのものを生成することが仕事である。
以下に本人のプロファイル・文体ルール・進行案件・過去事例・学習済みルールを与える。これらに書かれていない事実は
本人の判断根拠として使ってはならない。`;

function buildContextSection(ctx: ContextFiles): string {
  const parts = [
    ["## 本人プロファイル", ctx.persona],
    ["## 文体・回答作法のルール", ctx.style],
    ["## 進行中の案件と論点", ctx.projects],
    ["## 過去の判断事例", ctx.precedents],
    ["## 学習済みルール（フィードバックから蓄積）", ctx.learned.trim() || "（まだ蓄積なし）"],
  ];
  return parts.map(([title, body]) => `${title}\n${body}`).join("\n\n---\n\n");
}

const PROHIBITIONS = `## 禁止事項（厳守）
- 事実・数値・出典を創作しない。context にない事実を断定しない。分からない箇所は「【要確認：〇〇】」と明示する。
- 「あくまで個人の見解です」等の免責文、前置きの挨拶、末尾の御用聞き（「他にご不明点はございましたら」等）を書かない。
- どう転んでも当たる書き方（反証不能な表現）をしない。
- 相手を煽る・詰める表現、相手の行動を数え上げて突きつける表現をしない。
- 一般論の羅列で終わらせない。意見を求められたら結論を先に書く。
- 出力は指定された JSON 形式のみ。コードフェンスや説明文、JSON 以外の文字を一切含めない。`;

const DRAFT_FORMAT = `## 出力形式（回答生成モード）
次の TypeScript 型に一致する JSON を1つだけ出力する。

type DraftOutput = {
  estimated_recipient: string | null; // 相手が未選択のとき、本文から推定した相手。選択済みなら null
  estimated_scene: string | null;     // 場面が未選択のとき、本文から推定した場面。選択済みなら null
  estimated_length: string | null;    // 長さが未選択のとき、推定した長さ。選択済みなら null
  answer: string;       // ①私ならこう答える。そのままコピーして使える本文。メールなら件名込み
  reasons: string[];    // ②判断の根拠。最大3件。参照した context の該当ルール名・案件名を明記する
  risks: string;        // ③触れなかった論点・リスク。意図的に書かなかったことや、突っ込まれそうな点
  alternative: string;  // ④別案。①と方針が実質的に異なる場合のみ記述。方針が変わらないなら "別案なし" とだけ書く
};

- reasons は3点以内。抽象的な理由（「丁寧に書いたから」等）ではなく、参照した context の項目名を挙げること。
- alternative は語尾やトーン違いの水増しを禁止する。方針そのものが違う代替案が無ければ "別案なし"。`;

const WALLBOUNCE_CRITIQUE_FORMAT = `## 出力形式（壁打ちモード・講評）
本人が書いた答えを講評する。代筆はしない。次の TypeScript 型に一致する JSON を1つだけ出力する。

type WallbounceCritique = {
  verdict: "通る" | "条件付き" | "通らない";
  verdict_reason: string; // 判定理由
  anticipated_questions: { question: string; response: string }[]; // 相手から来る質問の予測。最大3件
  verification_points: string; // 事実関係で裏取りが必要な箇所。無ければ "特になし"
};`;

const WALLBOUNCE_EDIT_FORMAT = `## 出力形式（壁打ちモード・添削）
本人が「直して」と明示的に要求した場合のみ、この形式で添削する。
本人の文体・語順を極力保持し、全面書き換えはしない。次の TypeScript 型に一致する JSON を1つだけ出力する。

type WallbounceEdit = {
  changes: { location: string; before: string; after: string; reason: string }[]; // 変更箇所ごとに、どこを・何から何に・なぜ
  revised_text: string; // 変更を反映した全文（変更点以外は原文のまま保持する）
};`;

export type Mode = "draft" | "wallbounce_critique" | "wallbounce_edit" | "learn_extract";

export function buildSystemPrompt(ctx: ContextFiles, mode: Mode): string {
  const sections = [ROLE_DEFINITION, buildContextSection(ctx)];

  if (mode === "draft") {
    sections.push(DRAFT_FORMAT);
  } else if (mode === "wallbounce_critique") {
    sections.push(WALLBOUNCE_CRITIQUE_FORMAT);
  } else if (mode === "wallbounce_edit") {
    sections.push(WALLBOUNCE_EDIT_FORMAT);
  }
  // learn_extract は context 全文を使わず呼び出し側で別途プロンプトを組むため、
  // ここでは共通の禁止事項のみ渡って問題ない。

  sections.push(PROHIBITIONS);
  return sections.join("\n\n");
}

export function buildDraftUserMessage(input: {
  text: string;
  recipient: Recipient | null;
  scene: Scene | null;
  length: Length | null;
}): string {
  const lines = [
    `相手：${input.recipient ?? "未選択（本文から推定すること）"}`,
    `場面：${input.scene ?? "未選択（本文から推定すること）"}`,
    `長さ：${input.length ?? "未選択（内容に応じて適切な長さを判断すること）"}`,
    "",
    "以下が、受け取った質問・相談・メール・照会文である。",
    "---",
    input.text,
  ];
  return lines.join("\n");
}

export function buildWallbounceUserMessage(input: {
  text: string;
  myAnswer: string;
  recipient: Recipient | null;
  scene: Scene | null;
}): string {
  const lines = [
    `相手：${input.recipient ?? "未選択（本文から推定すること）"}`,
    `場面：${input.scene ?? "未選択（本文から推定すること）"}`,
    "",
    "以下が、受け取った質問・相談・メール・照会文である。",
    "---質問---",
    input.text,
    "",
    "以下が、本人が書いた答えである。この答えを講評すること。代筆・書き直しはしないこと。",
    "---本人の答え---",
    input.myAnswer,
  ];
  return lines.join("\n");
}

export function buildWallbounceEditUserMessage(input: {
  text: string;
  myAnswer: string;
}): string {
  return [
    "以下の質問に対して本人が書いた答えを、本人から明示的に依頼があったので添削する。",
    "文体・語順は極力保持し、全面書き換えはしないこと。",
    "---質問---",
    input.text,
    "",
    "---本人の答え（添削対象）---",
    input.myAnswer,
  ].join("\n");
}

const LEARN_ROLE = `あなたは、本人（広島市職員）が生成AIの下書きをどう直したかを分析し、
再利用可能な「反証可能な粒度」のルールを1文だけ抽出するアシスタントである。
一般論・抽象論（例：「丁寧に書く」「分かりやすく書く」）は抽出しない。
「上司宛では前置きの謝辞を入れない」のように、具体的な状況＋具体的な振る舞いのペアだけを抽出する。
元案と修正後の差分から、そのような具体的ルールが読み取れない場合は rule を null にする。`;

export function buildLearnSystemPrompt(existingLearnedLines: string[]): string {
  const existing =
    existingLearnedLines.length > 0
      ? existingLearnedLines.map((l, i) => `${i}: ${l}`).join("\n")
      : "（既存ルールなし）";

  return [
    LEARN_ROLE,
    "",
    "## 既存の学習済みルール一覧（インデックス付き）",
    existing,
    "",
    `## 出力形式
次の TypeScript 型に一致する JSON を1つだけ出力する。コードフェンスや説明文を含めない。

type LearnExtraction = {
  action: "add" | "update" | "skip";
  target_index: number | null; // action が "update" のとき、既存ルール一覧の番号。それ以外は null
  rule: string | null; // 1行で書ける具体的ルール。action が "skip" のときは null
};

- 既存ルールと実質的に同義の内容が既にある場合は "update" にして、target_index にその番号を入れ、
  rule に更新後の1行を書く。
- 新規の具体的ルールが読み取れた場合は "add"。
- 一般論しか読み取れない、または元案と修正後の差が文体の揺れ程度の場合は "skip"。`,
  ].join("\n");
}

export function buildLearnUserMessage(input: {
  originalAnswer: string;
  editedAnswer: string;
  recipient: Recipient | null;
  scene: Scene | null;
}): string {
  return [
    `相手：${input.recipient ?? "不明"}`,
    `場面：${input.scene ?? "不明"}`,
    "",
    "---AIが生成した元案---",
    input.originalAnswer,
    "",
    "---本人が修正して採用した本文---",
    input.editedAnswer,
  ].join("\n");
}
