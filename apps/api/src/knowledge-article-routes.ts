// V3-AIP-102 — 技術記事投稿パック。「システム案・思想を複数技術サイトへ投稿できる
// 『コピペ完結』の記事群(サイト別フォーマット済み)を生成する。投稿ボタンの実施=公開は
// 人間ゲート。」(要件本文・第13回ユーザー裁定「いろんな技術サイトに私のシステム案や思想を
// 投稿したい。コピペでできるように作って」)。design35 §A-3が生成物の置き場を knowledge*
// (w1-plaza の glob 内)と判定したためこの艦が実装する。
//
// LLM 既定OFF(不変条項①)のため、既存 BBS-12(draftBoardFromText・plaza-routes.ts)と
// 同型の決定論スキャフォールド: 与えられた title/body/tags をサイトごとのコピペ用
// フォーマット(frontmatter・タグ表記・見出し規約)へ機械的に整形するだけで、本文の
// 要約・書き換え・生成は行わない(記事の中身はユーザーが既に書いたもの=素材の再整形)。
// 「投稿」route(実際の外部API呼び出し)は本ラウンドでは実装しない(公開=人間ゲート・
// V3-AIP-102の要件文自身が投稿ボタンの実施を人間ゲートと明記しているため、生成のみで
// 十分=upgrade path)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";

export const knowledgeArticleRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const ARTICLE_SITE_KINDS = ["zenn", "qiita", "note", "hatena"] as const;
export type ArticleSiteKind = (typeof ARTICLE_SITE_KINDS)[number];

export interface ArticleSourceInput {
  title: string;
  body: string; // Markdown想定(ユーザー既筆・生成しない)
  tags?: string[];
  emoji?: string; // Zenn frontmatterの絵文字(省略時は既定値)
}

export interface ArticlePackEntry {
  site: ArticleSiteKind;
  text: string; // コピペ完結(サイトの投稿画面にそのまま貼れる形)
}

const DEFAULT_ZENN_EMOJI = "📝";

// サイトごとのフォーマッタ(純関数・並び順=ARTICLE_SITE_KINDSと一致)。
function formatZenn(input: ArticleSourceInput): string {
  const topics = (input.tags ?? []).map((t) => `"${t}"`).join(", ");
  const frontmatter = [
    "---",
    `title: "${input.title}"`,
    `emoji: "${input.emoji || DEFAULT_ZENN_EMOJI}"`,
    'type: "idea"', // 技術解説より「アイデア」記事(システム案・思想の投稿という要件に対応)
    `topics: [${topics}]`,
    "published: false", // 公開は人間ゲート(V3-AIP-102要件文どおり・falseのまま渡す)
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${input.body}`;
}

function formatQiita(input: ArticleSourceInput): string {
  const tagLine = (input.tags ?? []).length ? `Tags: ${(input.tags ?? []).join(", ")}` : "";
  return [`# ${input.title}`, tagLine, "", input.body].filter((l) => l !== "").join("\n");
}

function formatNote(input: ArticleSourceInput): string {
  // note はタグUIが投稿後の別操作のため本文にタグ行を混ぜない(サイトの流儀に合わせる)。
  return `${input.title}\n\n${input.body}`;
}

function formatHatena(input: ArticleSourceInput): string {
  const tagLine = (input.tags ?? []).length ? `\n\n[${(input.tags ?? []).join("][")}]` : "";
  return `# ${input.title}\n\n${input.body}${tagLine}`;
}

const FORMATTERS: Record<ArticleSiteKind, (input: ArticleSourceInput) => string> = {
  zenn: formatZenn,
  qiita: formatQiita,
  note: formatNote,
  hatena: formatHatena,
};

/**
 * buildArticlePack — V3-AIP-102 本体(純関数・store非依存でテスト可能)。sites省略時は
 * ARTICLE_SITE_KINDS全件。titleが空ならバリデーションはroute側が担う(この関数はガードなし
 * =他コンテキストからの再利用を妨げない)。
 */
export function buildArticlePack(input: ArticleSourceInput, sites?: ArticleSiteKind[]): ArticlePackEntry[] {
  const targets = sites?.length ? sites : ARTICLE_SITE_KINDS;
  return targets.map((site) => ({ site, text: FORMATTERS[site](input) }));
}

// POST /knowledge/article-pack { title, body, tags?, emoji?, sites? } — コピペ完結の
// サイト別記事パックを生成する(Truth追記なし・純粋な投影)。実際の投稿(公開)は別途
// 人間が各サイトへコピペで行う(このrouteは自動投稿しない=人間ゲート)。
knowledgeArticleRoutes.post("/knowledge/article-pack", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const articleBody = typeof body?.body === "string" ? body.body : "";
  if (!title || !articleBody.trim()) {
    return c.json({ error: "INVALID_ARTICLE", details: ["title and body required"] }, 400);
  }
  const tags = Array.isArray(body?.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string") : undefined;
  const emoji = typeof body?.emoji === "string" ? body.emoji : undefined;
  const sitesRaw = Array.isArray(body?.sites) ? (body.sites as unknown[]).filter((s): s is string => typeof s === "string") : undefined;
  const sites = sitesRaw?.filter((s): s is ArticleSiteKind => (ARTICLE_SITE_KINDS as readonly string[]).includes(s));
  if (sitesRaw && (!sites || sites.length !== sitesRaw.length)) {
    return c.json({ error: "INVALID_ARTICLE", details: [`sites must be a subset of ${ARTICLE_SITE_KINDS.join(",")}`] }, 400);
  }
  const pack = buildArticlePack({ title, body: articleBody, tags, emoji }, sites);
  return c.json({ title, sites: pack.map((p) => p.site), pack });
});
