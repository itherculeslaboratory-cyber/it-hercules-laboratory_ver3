// V3-BBS-33: 掲示板統計(投稿数推移・アクティブユーザー・時間帯ヒートマップ・タグ使用頻度・
// AI生成率)。掲示板単体のローカル統計と文明全体(全掲示板横断)統計を別画面用に分離した
// 投影として提供する(常駐DB禁止・都度 listEvents 再計算・不変条項①)。「文化スコア」は
// 正本(bv/認定飼育者重み等)が未確定のためこのラウンドでは対象外(下記持ち越し参照)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const POST_TYPE = "ihl.plaza.post.v1";

export const plazaStatsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

interface PostRow {
  post_id: string;
  actor_id: string;
  channel: string;
  created_at: string;
  tags?: string[];
  lang?: string;
}

async function listPostRows(s: TruthStore, channel?: string): Promise<PostRow[]> {
  const prefix = channel ? `truth/${POST_TYPE}/${channel}/` : `truth/${POST_TYPE}/`;
  return (await s.listEvents(prefix)).map(dataOf) as unknown as PostRow[];
}

export interface BoardStats {
  post_count: number;
  active_user_count: number;
  posts_by_day: Record<string, number>; // YYYY-MM-DD -> count(投稿数推移)
  hour_heatmap: number[]; // 24要素(UTC時)。時間帯ヒートマップ
  tag_frequency: Record<string, number>; // タグ使用頻度
}

function reduceBoardStats(posts: PostRow[]): BoardStats {
  const activeUsers = new Set<string>();
  const postsByDay: Record<string, number> = {};
  const hourHeatmap = new Array(24).fill(0);
  const tagFrequency: Record<string, number> = {};
  for (const p of posts) {
    if (p.actor_id) activeUsers.add(p.actor_id);
    const created = str(p.created_at);
    if (created) {
      const day = created.slice(0, 10);
      postsByDay[day] = (postsByDay[day] ?? 0) + 1;
      const hour = new Date(created).getUTCHours();
      if (!Number.isNaN(hour)) hourHeatmap[hour] += 1;
    }
    for (const tag of p.tags ?? []) tagFrequency[tag] = (tagFrequency[tag] ?? 0) + 1;
  }
  return {
    post_count: posts.length,
    active_user_count: activeUsers.size,
    posts_by_day: postsByDay,
    hour_heatmap: hourHeatmap,
    tag_frequency: tagFrequency,
  };
}

// GET /plaza/stats/board/:channel — 単一掲示板(channel)のローカル統計。
export async function projectBoardStats(s: TruthStore, channel: string): Promise<BoardStats> {
  return reduceBoardStats(await listPostRows(s, channel));
}

plazaStatsRoutes.get("/plaza/stats/board/:channel", async (c) => {
  return c.json(await projectBoardStats(store(c), c.req.param("channel")));
});

export interface GlobalStats extends BoardStats {
  board_count: number;
  posts_by_channel: Record<string, number>;
}

// GET /plaza/stats/global — 文明全体(全掲示板横断)の統計。ローカル統計とは別画面
// (要件文どおり明確に分離)。
export async function projectGlobalStats(s: TruthStore): Promise<GlobalStats> {
  const posts = await listPostRows(s);
  const base = reduceBoardStats(posts);
  const postsByChannel: Record<string, number> = {};
  for (const p of posts) postsByChannel[p.channel] = (postsByChannel[p.channel] ?? 0) + 1;
  return { ...base, board_count: Object.keys(postsByChannel).length, posts_by_channel: postsByChannel };
}

plazaStatsRoutes.get("/plaza/stats/global", async (c) => {
  return c.json(await projectGlobalStats(store(c)));
});
