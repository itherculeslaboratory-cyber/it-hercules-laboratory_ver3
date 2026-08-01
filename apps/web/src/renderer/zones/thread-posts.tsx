"use client";

import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ExecuteCtx, NavigateCtx, ScopeCtx } from "../core/context";
import { formatDateJa } from "../core/scope";
import { registerNode } from "../core/registry";
import type { ScreenNode } from "../types";

// g85-split2a Z4(zones/thread-posts.tsx・renderer.tsx zone「thread-posts」の
// 切り出し・実範囲=renderer.tsx:6167-6449)。差し戻し裁定
// (kits/lane-think/R0802-000233-REPORT-2026-08-02-g85-split2a-ruling.md §2-2)
// に従い、core/context・core/scope・core/registry・@/・reactのいずれにも
// 無い共有シンボル7個(props/Badge/ThreadPost/ThreadView/monogram/
// shortActorId/actorNameCache/ActorLabel)を、元記述を1文字も変えずこの
// ファイルへ複製した(移動ではなく複製 — 元定義は renderer.tsx に残る)。
// これらは zone C(renderer.tsx の共通層・Phase 2a では不触)からも参照される
// ため、Phase 2b のカットオーバー前に lane-think が正本の置き場所を裁定する
// (裁定書§3: props→core/node-view.tsx、Badge/monogram/shortActorId/
// actorNameCache/ActorLabel→core/primitives.tsx、ThreadPost/ThreadView→
// core/thread.ts)。

// 複製元: renderer.tsx:120-121
function props(node: ScreenNode): Record<string, unknown> {
  return node.props ?? {};
}

// 複製元: renderer.tsx:1075-1077
function Badge({ text, tone }: { text: string; tone?: string }) {
  return <ShadcnBadge tone={tone}>{text}</ShadcnBadge>;
}

// 複製元: renderer.tsx:6100-6111
type ThreadPost = {
  post_id: string;
  actor_id: string;
  channel: string;
  topic: string;
  board_kind: string;
  body: string;
  created_at: string;
  reply_to?: string;
  cite_refs?: Array<{ type: string; id: string; label?: string }>;
  tags?: string[];
};
// 複製元: renderer.tsx:6112-6118
type ThreadView = {
  thread_id: string;
  channel: string;
  topic: string;
  posts: ThreadPost[];
  tombstones?: Array<{ ref: { type: string; id: string }; reason: string }>;
};

// 複製元: renderer.tsx:6125-6127
function monogram(actorId: string): string {
  return actorId.trim().slice(0, 1).toUpperCase() || "?";
}

// 複製元: renderer.tsx:6134-6136
function shortActorId(actorId: string): string {
  return actorId.length > 12 ? `${actorId.slice(0, 10)}…` : actorId;
}

// 複製元: renderer.tsx:6144
const actorNameCache = new Map<string, string>();

// 複製元: renderer.tsx:6146-6165
function ActorLabel({ actorId }: { actorId: string }) {
  const execute = useContext(ExecuteCtx);
  const [name, setName] = useState<string>(() => actorNameCache.get(actorId) ?? "");
  useEffect(() => {
    if (!actorId || actorNameCache.has(actorId)) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path: `/api/v1/users/${actorId}/profile` }))
      .then((r) => {
        const dn = String((r as { display_name?: string } | undefined)?.display_name ?? "");
        actorNameCache.set(actorId, dn);
        if (alive) setName(dn);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);
  return <span title={actorId}>{name || shortActorId(actorId)}</span>;
}

// c8 UI磨き第2弾#3(受領10「『…』のなかに畳んで」): a kebab ("⋮") trigger that
// reveals its children on tap and closes again on: (a) selecting a menu item
// (click bubbles from the item up to the wrapping div — this fires AFTER the
// item's own onClick, so the action already ran) or (b) an outside click.
// Renderer primitive, not a declarative NodeType — the one concrete case this
// wave has (knowledge-thread's per-post "この投稿を相談室へ") lives inside a
// dedicated node (ThreadPostsNode), not a JSON screen-def; a table row-actions
// cell is the natural next caller if one shows up (not built speculatively).
function KebabMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);
  return (
    <div className="civ-kebab" ref={ref}>
      <button
        type="button"
        className={cn("civ-interactive", "civ-kebab-trigger")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        ⋮
      </button>
      {open && (
        <div className="civ-kebab-menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// round-16 OQ-PLZ-03 (resolve mark, thread-starter only) rides the EXISTING
// plaza post endpoint as a tag convention (tags:["resolved"|"unresolved"])
// instead of a new Truth event type — the latest such tagged post wins.
// ponytail: OQ-PLZ-01/02/05 (weighted-vote promotion badges + card-issuance
// delegation) need real actor-role Truth data (certified breeder / primary
// observer flags) that does not exist in any schema today — out of scope
// here, not silently faked. See task report.
function resolvedStatus(posts: ThreadPost[]): boolean {
  for (let i = posts.length - 1; i >= 0; i--) {
    const tags = posts[i].tags ?? [];
    if (tags.includes("resolved")) return true;
    if (tags.includes("unresolved")) return false;
  }
  return false;
}

function ThreadPostsNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const navigate = useContext(NavigateCtx);
  const threadId = String(scope.params.thread_id ?? "");
  const [view, setView] = useState<ThreadView | null>(null);
  const [viewerId, setViewerId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [resolving, setResolving] = useState(false);
  // c8磨き第2弾#6(受領10「投稿ごとの投票ボタンに」): per-post Agree/Disagree/
  // Pass — replaces the old screen-def stance-form's manual "対象の投稿 ID"
  // text field entirely (a post's own id was always the thing being voted on;
  // making the visitor type it back was the actual bug). castStance is local
  // session feedback only (no live re-fetch of the sibling consensus table —
  // the pre-c8 stance-form had no such refresh either, so this is parity, not
  // a regression; a full reload already showed the updated tally before and
  // still does).
  const [castStance, setCastStance] = useState<Record<string, "agree" | "disagree" | "pass">>({});
  const [votingId, setVotingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!threadId) {
      setLoaded(true);
      return;
    }
    try {
      const v = (await execute({ kind: "api", method: "GET", path: `/api/v1/plaza/threads/${threadId}` })) as ThreadView;
      setView(v);
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [execute, threadId]);

  useEffect(() => {
    let alive = true;
    void reload();
    // Promise.resolve(...) defensively wraps execute()'s return the same way
    // useSource does — a bare test double (vi.fn() with no implementation)
    // returns undefined synchronously, not a Promise, and .then() on that
    // throws (V3-AIP-50 snapshot sweep caught this).
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/me/profile" }))
      .then((r) => {
        if (alive) setViewerId(String((r as { actor_id?: string } | undefined)?.actor_id ?? ""));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const toggleResolve = useCallback(
    async (root: ThreadPost, next: boolean) => {
      setResolving(true);
      try {
        await execute(
          { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
          {
            channel: root.channel,
            topic: root.topic,
            board_kind: root.board_kind,
            // thread_id is the THREAD's key, not the root post's own post_id —
            // those coincide only when the thread was seeded without an
            // explicit thread_id (projectThread filters posts by exact
            // thread_id match, so getting this wrong silently files the
            // resolve-tag post into a different/new thread bucket).
            thread_id: threadId,
            reply_to: root.post_id,
            body: next ? "スレッドを解決済みにしました。" : "解決を取り消しました。",
            tags: [next ? "resolved" : "unresolved"],
          },
        );
        await reload();
      } finally {
        setResolving(false);
      }
    },
    [execute, reload],
  );

  const castVote = useCallback(
    async (postId: string, value: "agree" | "disagree" | "pass") => {
      setVotingId(postId);
      try {
        await execute({ kind: "api", method: "POST", path: "/api/v1/plaza/stances" }, { statement_id: postId, value });
        setCastStance((m) => ({ ...m, [postId]: value }));
      } finally {
        setVotingId(null);
      }
    },
    [execute],
  );

  if (!loaded) {
    return (
      <p className="civ-text" data-muted="true">
        読み込み中…
      </p>
    );
  }
  if (!view || view.posts.length === 0) {
    return <p className="civ-empty">{String(p.empty_text ?? "まだ投稿がありません。")}</p>;
  }
  const root = view.posts[0];
  const resolved = resolvedStatus(view.posts);
  const isStarter = !!viewerId && viewerId === root.actor_id;
  const tombstoned = new Set((view.tombstones ?? []).map((t) => `${t.ref.type}:${t.ref.id}`));
  // c9 wave1 KNW Slice2(スレッドの生ID撲滅): reply_to was rendered as a raw
  // ULID (">>p1"形式) — unreadable to a human reader. Resolve it to the parent
  // post's own body excerpt instead; a parent outside the loaded post list
  // (should not happen today, but posts is append-only so nothing is ever
  // truly deleted — defensive) falls back to an honest generic phrase, never
  // the raw id.
  const postById = new Map(view.posts.map((pp) => [pp.post_id, pp]));

  return (
    <div className="civ-thread-posts">
      <div className="civ-thread-posts-head">
        <Badge text={resolved ? "✔ 解決済み" : "未解決"} tone={resolved ? "success" : "neutral"} />
        {isStarter && (
          <button
            type="button"
            className={cn("civ-interactive", "civ-button")}
            data-variant="secondary"
            disabled={resolving}
            aria-busy={resolving || undefined}
            onClick={() => void toggleResolve(root, !resolved)}
          >
            {resolved ? "解決を取り消す" : "✔ 解決済みにする"}
          </button>
        )}
      </div>
      <ul className="civ-list civ-thread-post-list">
        {view.posts.map((post) => (
          <li key={post.post_id}>
            <article className="civ-card civ-thread-post" data-post-id={post.post_id}>
              <div className="civ-thread-post-head">
                <span className="civ-avatar-badge" aria-hidden="true">
                  {monogram(post.actor_id)}
                </span>
                <span className="civ-thread-post-actor">
                  <ActorLabel actorId={post.actor_id} />
                </span>
                <span className="civ-text" data-muted="true">
                  {formatDateJa(post.created_at)}
                </span>
                {post.post_id === root.post_id && <Badge text="スレ主" tone="neutral" />}
              </div>
              {post.reply_to &&
                (() => {
                  const parent = postById.get(post.reply_to);
                  if (parent) {
                    const body = parent.body ?? "";
                    const excerpt = body.length > 24 ? `${body.slice(0, 24)}…` : body;
                    return (
                      <p className="civ-text civ-thread-reply-ref" data-muted="true">
                        ↩ 「{excerpt}」への返信
                      </p>
                    );
                  }
                  return (
                    <p className="civ-text civ-thread-reply-ref" data-muted="true">
                      ↩ 以前の投稿への返信
                    </p>
                  );
                })()}
              <p className="civ-text">{post.body}</p>
              {(post.cite_refs ?? []).length > 0 && (
                <div className="civ-card-badges">
                  {(post.cite_refs ?? []).map((ref, i) => {
                    // BBS-20 tombstone: the cite target no longer resolves
                    // (projectThread's citeTargetExists check) — the ref
                    // itself is kept (append-only) but flagged invalid.
                    const invalid = tombstoned.has(`${ref.type}:${ref.id}`);
                    return (
                      <Badge
                        key={i}
                        text={invalid ? `${ref.type}: ${ref.label ?? ref.id}（無効）` : `${ref.type}: ${ref.label ?? ref.id}`}
                        tone={invalid ? "warning" : "neutral"}
                      />
                    );
                  })}
                </div>
              )}
              <div className="civ-thread-post-stance" role="group" aria-label="この投稿への賛否">
                {(["agree", "disagree", "pass"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={cn("civ-interactive", "civ-button")}
                    data-variant={castStance[post.post_id] === v ? "primary" : "secondary"}
                    data-compact
                    disabled={votingId === post.post_id}
                    aria-busy={votingId === post.post_id || undefined}
                    onClick={() => void castVote(post.post_id, v)}
                  >
                    {v === "agree" ? "賛成" : v === "disagree" ? "反対" : "保留"}
                  </button>
                ))}
              </div>
              <KebabMenu label="この投稿の操作">
                <button
                  type="button"
                  className={cn("civ-interactive", "civ-button")}
                  data-variant="ghost"
                  onClick={() =>
                    navigate("dispute", {
                      category: "board",
                      subject_type: "post",
                      subject_id: post.post_id,
                      respondent_id: post.actor_id,
                    })
                  }
                >
                  この投稿を相談室へ
                </button>
              </KebabMenu>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

registerNode("thread-posts", ThreadPostsNode);
