// V3-BBS-37 — 任意の画面/機能/正本ファイルから、関連する議論スレ・intentチェーン
// (intent→spec→commit→post)・ADR・採用/不採用理由(rejected_alternatives)を時系列で
// 一覧できる読み取り専用ビュー。新規Truth型は作らず、既存資産の再配線のみ(reuse-first):
// intent.ts(V3-AIP-35/36 の意図台帳)・plaza-routes.ts(BBS-05 スレ投影)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { INTENT_TYPE, type IntentData } from "./intent";
import { projectThread } from "./plaza-routes";

export const knowledgeTimelineRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

export interface TimelineEntry {
  at: string;
  kind: "intent" | "post";
  ref: string;
  summary: string;
  rejected_alternatives?: string[];
}

/**
 * projectDecisionTimeline — ref(post_id)を起点に、その post_id を刻んだ intent
 * (ihl.process.intent.v1・post_id 一致)と、その議論スレ(plaza thread)を時系列で束ねる
 * (都度再計算・常駐なし)。ADR相当は intent.decision_source(出典パス自由記述)として
 * 各エントリに同梱し、rejected_alternatives(不採用理由)も透過する。
 */
export async function projectDecisionTimeline(s: TruthStore, ref: string): Promise<TimelineEntry[]> {
  const intents = (await s.listEvents(`truth/${INTENT_TYPE}/`)).map(dataOf) as Partial<IntentData>[];
  const relatedIntents = intents.filter((d) => d.post_id === ref || d.intent_id === ref);

  const entries: TimelineEntry[] = relatedIntents.map((d) => ({
    at: d.created_at ?? "",
    kind: "intent" as const,
    ref: d.intent_id ?? "",
    summary: d.intent_summary ?? "",
    rejected_alternatives: d.rejected_alternatives,
  }));

  const thread = await projectThread(s, ref);
  if (thread) {
    for (const p of thread.posts) {
      entries.push({
        at: String(p.created_at ?? ""),
        kind: "post",
        ref: String(p.post_id ?? ""),
        summary: String(p.body ?? "").slice(0, 200),
      });
    }
  }

  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// GET /knowledge/timeline/:ref — 読み取り専用横断ビュー(BBS-37)。ref は post_id/thread_id/
// intent_id のいずれでもよい(それぞれのプロジェクションが該当分だけヒットする)。
knowledgeTimelineRoutes.get("/knowledge/timeline/:ref", async (c) => {
  const ref = c.req.param("ref");
  const s = new TruthStore(c.env.TRUTH);
  const timeline = await projectDecisionTimeline(s, ref);
  return c.json({ ref, timeline });
});
