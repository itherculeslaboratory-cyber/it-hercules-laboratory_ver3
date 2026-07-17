// V3-AIP-67 GitHub Issues/掲示板 100件蓄積 → AI要約スレッド(design-c5.md §K6 前提の薄い
// 追加コネクタ)。既存基盤を再利用する最小実装:
//   - 収集: github-issues-connector.ts(薄い読み取りコネクタ・repo/labels は
//     config/ai-digest-config.json で管理・ハードコード禁止)。
//   - 要約: ai-kernel.ts の LLMClient(A90)をそのまま使う。実プロバイダは未配線
//     (IHL_AI_PROVIDER 未設定 = 常に AiDisabledError)— 不変条項①(LLM 既定 OFF)。
//     プロンプトは ai-profiles/newspaper.json(BYOK summarize)を再利用し新設しない。
//   - 保存/表示: 新しいイベント型を増やさず ihl.plaza.post.v1 をそのまま使う
//     (channel="knowledge-board"・board_kind="improvement")。これは screen-defs/
//     knowledge-board.json が GET /plaza/channels/knowledge-board/threads で
//     既に描画している「改善の板」そのもの — 掲示板表示は無改造で満たされる。
//   - 同一 issue の再要約は同じ thread_id(gh-issue-<number>)へ新規 post を INSERT
//     ONLY 追記(correction_of で直前バージョンを指す・upsert/削除はしない)。
// 掲示板→GitHub Issue 自動起票(Phase2)はスコープ外(要件本文が明記)。admin 起動は
// POST /ai-digest/sync(requireRole operator/admin)— 定期 cron 配線は人間ゲート
// (常駐トークン消費の開始・PLAN §7)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { requireRole } from "./authz";
import { makeLLMClient, AiDisabledError, type LLMClient } from "./ai-kernel";
import { makeGithubIssuesConnector, type GithubIssue, type GithubIssuesConnector } from "./github-issues-connector";
import { projectThread } from "./plaza-routes";
import digestConfig from "../../../config/ai-digest-config.json";
import newspaperProfile from "../../../ai-profiles/newspaper.json";

const PLAZA_POST_TYPE = "ihl.plaza.post.v1";
const PLAZA_POST_SCHEMA = "schemas/events/plaza-post.schema.json";
const SCHEMA_VERSION = "1";
const DIGEST_CHANNEL = "knowledge-board";
const DIGEST_BOARD_KIND = "improvement";
const SYSTEM_ACTOR = "system:ai-digest";

type DigestConfig = { repo: string; labels: string[]; batch_size: number };
const CONFIG = digestConfig as unknown as DigestConfig;

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}

function threadIdFor(issueNumber: number): string {
  return `gh-issue-${issueNumber}`;
}

// summarize 出力から「keywords: a, b, c」(日本語「キーワード:」も可)行を抜き出す。
// 無ければ空配列(捏造しない)。
export function extractKeywords(text: string): string[] {
  const m = text.match(/^(?:keywords?|キーワード)\s*[:：]\s*(.+)$/im);
  if (!m) return [];
  return m[1]
    .split(/[,、]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

async function appendDigestPost(
  s: TruthStore,
  issue: GithubIssue,
  body: string,
  tags: string[],
  version: number,
  correctionOf: string | undefined,
) {
  const threadId = threadIdFor(issue.number);
  const postId = ulid();
  const data: Record<string, unknown> = {
    post_id: postId,
    actor_id: SYSTEM_ACTOR,
    channel: DIGEST_CHANNEL,
    topic: issue.title,
    board_kind: DIGEST_BOARD_KIND,
    thread_id: threadId,
    body,
    tags,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (correctionOf) data.correction_of = correctionOf;
  const key = `truth/${PLAZA_POST_TYPE}/${DIGEST_CHANNEL}/${threadId}/${postId}.json`;
  const envelope = {
    specversion: "1.0",
    id: postId,
    source: "apps/api",
    type: PLAZA_POST_TYPE,
    time: new Date().toISOString(),
    dataschema: PLAZA_POST_SCHEMA,
    provenance: { generator_kind: "agent", agent_name: "ai-digest", actor_id: SYSTEM_ACTOR },
    data,
  };
  void version; // version は tags(v<n>)に刻む・戻り値としては posts_created の増分のみ使う
  return s.putEventAt(key, envelope);
}

export interface DigestReport {
  repo: string;
  fetched: number;
  considered: number;
  summarized: number;
  posts_created: number;
  ai_disabled: boolean;
}

/** POST /ai-digest/sync の本体(テストが DI 経由で直接叩ける形にも export)。 */
export async function runDigestSync(
  s: TruthStore,
  connector: GithubIssuesConnector,
  client: LLMClient,
): Promise<DigestReport> {
  const issues = await connector.listIssues(CONFIG.repo, CONFIG.labels);
  const considered = issues.slice(0, CONFIG.batch_size);

  let summarized = 0;
  let posts_created = 0;
  let ai_disabled = false;

  for (const issue of considered) {
    let text: string;
    try {
      const result = await client.complete({
        task: "summarize",
        input: { prompt: (newspaperProfile as { prompt: string }).prompt, issue },
      });
      text = result.text;
    } catch (e) {
      if (e instanceof AiDisabledError) {
        ai_disabled = true;
        break; // 既定 OFF・BYOK 未設定は全 issue で同一状態 — 捏造せず打ち切る。
      }
      throw e;
    }
    summarized++;

    const threadId = threadIdFor(issue.number);
    const view = await projectThread(s, threadId);
    const version = view ? view.posts.length + 1 : 1;
    const correctionOf = view ? String(view.posts[view.posts.length - 1].post_id) : undefined;
    const tags = [...issue.labels, threadId, `v${version}`, ...extractKeywords(text)];

    const res = await appendDigestPost(s, issue, text, tags, version, correctionOf);
    if (res.status === "inserted") posts_created++;
  }

  return { repo: CONFIG.repo, fetched: issues.length, considered: considered.length, summarized, posts_created, ai_disabled };
}

// ── route ────────────────────────────────────────────────────────────────────
// DI seam(ai-kernel.ts の createAiRoutes と同型): テストは makeClient/makeConnector に
// モックを注入して AI 有効時の投稿生成・disabled 時の 0 件応答の両方を検証する。
export function createAiDigestRoutes(
  makeClient: (env: Bindings) => LLMClient = makeLLMClient,
  makeConnector: (env: Bindings) => GithubIssuesConnector = makeGithubIssuesConnector,
) {
  const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  // POST /ai-digest/sync — admin 手動即時実行(要件本文どおり・cron 配線は人間ゲート)。
  // ponytail: 唯一の現実的失敗経路は connector.listIssues() の fetch(GitHub API 障害/
  // レート制限)なので広く 502 に丸める。LLM 側は AiDisabledError を runDigestSync 内で
  // 個別処理済み(捏造せず ai_disabled:true を返す)ので、ここに来る throw は fetch 起因の
  // 想定内のみ。要因を分けたくなったら listIssues だけを個別 try に切り出す。
  routes.post("/ai-digest/sync", requireRole("operator", "admin"), async (c) => {
    try {
      const report = await runDigestSync(store(c), makeConnector(c.env), makeClient(c.env));
      return c.json(report, 200);
    } catch {
      return c.json({ error: "GITHUB_FETCH_FAILED" }, 502);
    }
  });

  return routes;
}

export const aiDigestRoutes = createAiDigestRoutes();
