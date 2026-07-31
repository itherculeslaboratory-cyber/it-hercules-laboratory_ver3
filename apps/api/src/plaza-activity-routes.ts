// V3-BBS-18 — 文明のあらゆる行動(カルマ変動・プラチナ付与・貢献度・称号・レビュー・取引・
// DM・司法・スレッド更新・観測・AI新聞・マーケット中止・生体関連)を単一の統合通知システムに
// 統合し、Follow・Event・Streamの3層で構成する要件。design35 §A-5(BBS-18行)の分業指示:
// 「発火元は各ドメイン艦が1行、集約はこの艦(w-plaza2)が担当」。本ファイルは集約(Stream)側
// のみを実装する。
//
// ★スコープの正直な注記(何が実装済みで何が未着手か・KIT-TEMPLATE「穴埋めを残すな」準拠):
// 1. Stream(実装済み・本ファイル) — 既存の実在する Truth ストリーム(下記
//    ACTIVITY_DOMAINS)を横断 prefix scan して時系列マージする読み取り専用投影。新規
//    ストレージ・新規スキーマは0(reuse-first)。
// 2. Follow(部分実装) — 既存 ihl.social.eval.v1 kind="follow"(social-routes.ts の
//    EVAL_KINDS に元々含まれる)をそのまま再利用可能(新規スキーマ不要)。ただし要件が
//    求める「フォロー後にどのタグ(観測/フォーク/種族/OS)で通知するかを設定できる」は
//    既存 social-eval スキーマに対応フィールドが無く、そのフィールド追加には
//    schemas/events/social-eval.schema.json の変更が要る。この発注の書いてよい場所は
//    MODULE-MAP.md「w1-plaza」行(apps/api/src 配下のみ)で schemas/events/** を含まない
//    ため、本ラウンドでは実装しない(越境しない・GOV-10/IND-23と同型の判断)。
// 3. Event(既読管理・未実装) — 「R2にJSONで既読管理する」には新規イベント型
//    (既読カーソルの append-only ログ、または現在値スナップショット)が要るが、これも
//    schemas/events/** の新設を要するため同じ理由で本ラウンドでは実装しない。
// 4. 「称号」「AI新聞」「マーケット中止」の3行動に対応する既存 Truth ストリームは
//    grep で実在確認できなかった(0件)。該当ドメイン艦が発火点(1行)を追加するまで
//    このStreamには現れない(発注書の指示どおりHQへ申し送る・下記報告書「他艦への依頼」参照)。
import { Hono } from "hono";
import { TruthStore } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

export const plazaActivityRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface ActivityDomain {
  key: string;
  type: string; // Truth event type(prefix scan対象)
  label: string; // 要件文の行動カテゴリ名
}

// 実在確認済み(grep実測・apps/api/src の const XXX_TYPE = "ihl...." 定義を根拠とする)の
// ストリームのみを列挙する。存在しないものを「ある」かのように書かない。
export const ACTIVITY_DOMAINS: readonly ActivityDomain[] = [
  { key: "karma", type: "ihl.economy.karma_event.v1", label: "カルマ変動" },
  { key: "platinum", type: "ihl.economy.coin_event.v1", label: "プラチナ付与" },
  { key: "contribution", type: "ihl.economy.contribution_event.v1", label: "貢献度" },
  { key: "review", type: "ihl.mkt.rating.v1", label: "レビュー" },
  { key: "transaction", type: "ihl.mkt.transaction_event.v1", label: "取引" },
  { key: "dm", type: "ihl.plaza.dm_message.v1", label: "DM" },
  { key: "judicial", type: "ihl.gov.dispute.v1", label: "司法" },
  { key: "thread_update", type: "ihl.plaza.post.v1", label: "スレッド更新" },
  { key: "observation", type: "ihl.obs.capture.v1", label: "観測" },
  { key: "creature", type: "ihl.ind.life_event.v1", label: "生体関連" },
] as const;

export interface ActivityRow {
  domain: string;
  label: string;
  actor_id: string;
  created_at: string;
  data: Record<string, unknown>;
}

/**
 * projectActivityStream — 指定ドメイン(省略時は全ドメイン)を横断して actor_id でフィルタし、
 * created_at 降順でマージする(V3-BBS-18 Stream層)。「推し作者はマイページへ飛べる」の
 * 最小実装として actor_id 単位のフィルタを主軸にする(フォロー対象=特定actorの活動一覧)。
 * 常駐DB無し・都度再計算(不変条項①)。created_at を持たないイベントは末尾に落ちるよう
 * 空文字扱い(欠落を無視して落とさない=正直な表示)。
 */
export async function projectActivityStream(
  s: TruthStore,
  actorId?: string,
  domainKeys?: string[],
): Promise<ActivityRow[]> {
  const domains = domainKeys?.length ? ACTIVITY_DOMAINS.filter((d) => domainKeys.includes(d.key)) : ACTIVITY_DOMAINS;
  const rows = await Promise.all(
    domains.map(async (d) => {
      const events = (await s.listEvents(`truth/${d.type}/`)).map(dataOf);
      return events
        .filter((e) => !actorId || str(e.actor_id) === actorId)
        .map((e): ActivityRow => ({ domain: d.key, label: d.label, actor_id: str(e.actor_id), created_at: str(e.created_at), data: e }));
    }),
  );
  return rows.flat().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

// GET /plaza/activity-stream?actor_id=<optional>&domains=karma,review(optional) —
// V3-BBS-18 Stream層投影(読み取り専用)。actor_id 省略時は全ドメイン全actorの直近行動
// (運用上は大きくなりうるため呼び出し側で domains を絞ることを推奨)。
plazaActivityRoutes.get("/plaza/activity-stream", async (c) => {
  const actorId = c.req.query("actor_id") || undefined;
  const domainsParam = c.req.query("domains");
  const domainKeys = domainsParam ? domainsParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const rows = await projectActivityStream(store(c), actorId, domainKeys);
  return c.json({ actor_id: actorId ?? null, domains: (domainKeys ?? ACTIVITY_DOMAINS.map((d) => d.key)), rows });
});

// GET /plaza/activity-domains — Stream層が実際に対応しているドメイン一覧(UIが動的に
// フィルタチップを出すための投影。「称号」「AI新聞」「マーケット中止」がここに出ない
// ことがそのまま「未配線」の正直な表示になる)。
plazaActivityRoutes.get("/plaza/activity-domains", (c) => {
  return c.json({ domains: ACTIVITY_DOMAINS });
});
