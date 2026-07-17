// V3-BBS-28 Engagement(社会機能: 公開Q&A・称賛・未出品オファー・一括募集)。
// 掲示板側の募集スレ型に限定(board_kind=engagement・plaza-routes.ts の既存投稿/スレ基盤を
// 再利用)。市場のオファー機構(V3-MKT-06)とは衝突しない — 実際の売買/取引はここでは
// 一切扱わず、募集/質問/称賛の「スレ」を投影するだけ(決定論・都度再計算・常駐DBなし・
// 不変条項①)。全 route は index.ts §1.5 gate 経由 PROTECTED。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { ENGAGEMENT_TAG_PREFIX, QUESTION_CATEGORIES, QUESTION_CATEGORY_KEYWORDS } from "./plaza-constants";

export const engagementRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// plaza-routes.ts と同一 Truth 型(型を複製せず文字列単一定義のみ再掲・スキーマは
// schemas/events/plaza-post.schema.json が唯一正本)。
const POST_TYPE = "ihl.plaza.post.v1";
// observation-routes.ts の capture(ihl.obs.capture.v1)を再利用(称賛ポイントの元データ)。
const CAPTURE_TYPE = "ihl.obs.capture.v1";

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

/**
 * classifyEngagementQuestion — 質問文を決定論キーワード辞書で自動分類(BBS-28)。
 * LLM 既定OFF(不変条項①)のフォールバック実装。複数カテゴリに一致した場合は
 * QUESTION_CATEGORIES の宣言順(research優先)で最初の一致を採る(決定論)。
 * どれにも一致しなければ "beginner"(初心者質問の既定分類・無害側へ倒す)。
 * "無意味"と分類された質問は出品者が答えなくてよい(呼び手が category==="meaningless"
 * で表示を畳む)。
 */
export function classifyEngagementQuestion(body: string): QuestionCategory {
  const text = body.toLowerCase();
  for (const cat of QUESTION_CATEGORIES) {
    if (QUESTION_CATEGORY_KEYWORDS[cat].some((kw) => text.includes(kw.toLowerCase()))) return cat;
  }
  return "beginner";
}

export interface PraisePoint {
  item: string;
  message: string;
}

// PRAISE_STABILITY_CV — 変動係数(標準偏差/平均の絶対値)がこの値未満なら
// 「安定して推移」と称賛する閾値。ponytail: 較正 knob(運用実測で調整)。
const PRAISE_STABILITY_CV = 0.15;

/**
 * projectPraisePoints — 観測データ(subject_ref の capture.measurements[])から
 * 褒めポイントを自動抽出する(BBS-28「観測データから褒めポイントを自動抽出」)。
 * 決定論統計(変動係数)のみ・LLM 不使用。項目名は観測側の item 文字列をそのまま使う
 * (胸角の角度/体色/成長速度等、項目辞書は observation 側の正本=measurement-dictionary)。
 */
export async function projectPraisePoints(s: TruthStore, subjectRef: string): Promise<PraisePoint[]> {
  const captures = (await s.listEvents(`truth/${CAPTURE_TYPE}/`)).map(dataOf).filter((d) => d.subject_ref === subjectRef);
  const byItem = new Map<string, number[]>();
  for (const cap of captures) {
    const measurements = Array.isArray(cap.measurements) ? (cap.measurements as Record<string, unknown>[]) : [];
    for (const m of measurements) {
      if (typeof m.item !== "string" || typeof m.value !== "number") continue;
      (byItem.get(m.item) ?? byItem.set(m.item, []).get(m.item)!).push(m.value);
    }
  }
  const points: PraisePoint[] = [];
  for (const [item, values] of byItem) {
    if (values.length < 2) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    const cv = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;
    if (cv < PRAISE_STABILITY_CV) {
      points.push({ item, message: `${item}が安定して推移しています(変動係数${cv.toFixed(2)}・n=${values.length})` });
    }
  }
  return points.sort((a, b) => a.item.localeCompare(b.item));
}

export interface PredictedQuestion {
  body: string;
  count: number;
  category: QuestionCategory;
}

// PREDICTED_QUESTIONS_TOP_K — 予測質問として表示する上限件数。
const PREDICTED_QUESTIONS_TOP_K = 10;

/**
 * projectPredictedQuestions — channel 内の過去 Q&A(board_kind=engagement・
 * tags に "engagement:qna")から頻出質問を頻度降順で抽出し、自動分類を付与する
 * (BBS-28「過去の質問文化から予測質問+回答を自動表示」)。回答文の自動表示は
 * reply_to で紐づく最頻回答が無い MVP のため質問文のみ返す(将来 reply_to 集計で拡張)。
 */
export async function projectPredictedQuestions(s: TruthStore, channel: string): Promise<PredictedQuestion[]> {
  const posts = (await s.listEvents(`truth/${POST_TYPE}/${channel}/`))
    .map(dataOf)
    .filter((d) => d.board_kind === "engagement" && Array.isArray(d.tags) && (d.tags as string[]).includes(`${ENGAGEMENT_TAG_PREFIX}qna`));
  const freq = new Map<string, number>();
  for (const p of posts) {
    const body = str(p.body).trim();
    if (!body) continue;
    freq.set(body, (freq.get(body) ?? 0) + 1);
  }
  return [...freq.entries()]
    .map(([body, count]) => ({ body, count, category: classifyEngagementQuestion(body) }))
    .sort((a, b) => b.count - a.count || a.body.localeCompare(b.body))
    .slice(0, PREDICTED_QUESTIONS_TOP_K);
}

// GET /plaza/engagement/insights — praise_points(?subject_ref=) と
// predicted_questions(?channel=) を単一エンドポイントで返す(BBS-28)。
// どちらのクエリも省略時は該当キーを省く(呼び手が必要な方だけ問い合わせられる)。
engagementRoutes.get("/plaza/engagement/insights", async (c) => {
  const channel = c.req.query("channel") || undefined;
  const subjectRef = c.req.query("subject_ref") || undefined;
  const s = store(c);
  const out: { praise_points?: PraisePoint[]; predicted_questions?: PredictedQuestion[] } = {};
  if (subjectRef) out.praise_points = await projectPraisePoints(s, subjectRef);
  if (channel) out.predicted_questions = await projectPredictedQuestions(s, channel);
  return c.json(out);
});
