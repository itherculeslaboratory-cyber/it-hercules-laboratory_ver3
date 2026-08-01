"use client";

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ExecuteCtx, ScopeCtx } from "../core/context";
import { registerNode } from "../core/registry";
import type { ScreenNode } from "../types";

// g85-split2a Z8(zones/knowledge-chat.tsx・renderer.tsx zone
// 「list:knowledge-thread-chat」の切り出し・実範囲=renderer.tsx:8426-8628)。
// 差し戻し裁定(kits/lane-think/R0802-000233-REPORT-2026-08-02-g85-split2a-
// ruling.md §2-3)に従い、core/context・core/scope・core/registry・@/・react
// のいずれにも無い共有シンボル6個(props/ThreadPost/ThreadView/monogram/
// shortActorId/actorNameCache/ActorLabel)を、元記述を1文字も変えずこの
// ファイルへ複製した(移動ではなく複製 — 元定義は renderer.tsx に残る。
// Badge はこのゾーンの範囲内では未使用のため複製していない)。これらは
// zone C(renderer.tsx の共通層・Phase 2a では不触)・zones/thread-posts.tsx
// (Z4)からも参照される3重共有シンボルのため、Phase 2b のカットオーバー前に
// lane-think が正本の置き場所を裁定する(裁定書§3: props→core/node-view.tsx、
// monogram/shortActorId/actorNameCache/ActorLabel→core/primitives.tsx、
// ThreadPost/ThreadView→core/thread.ts)。

// 複製元: renderer.tsx:120-121
function props(node: ScreenNode): Record<string, unknown> {
  return node.props ?? {};
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

// T-71 KNW wave1(スレッド=みんなのグループチャット — 承認モックアップ section3
// の verbatim 採用・R94「既存を捨てる」): 旧 ThreadPostsNode(投稿ごとの賛否
// Agree/Disagree/Pass ボタン + Polis型合意可視化テーブル + テキストエリア返信
// フォーム + 引用ref + スレ主限定解決マーク)は削除対象 — オーナーモデルは
// 「投票スレ」ではなくグループチャットなので、その UI をこの画面から撤去する
// (提案ベース撤去・関数自体/他画面からの参照は残置=最小diff)。バックエンド
// (GET /plaza/threads/:thread_id・POST /plaza/posts)は第一級資産としてそのまま
// 再利用する。ctx-chips(🌡26℃/💧60%/🧬系統/令 — mockup section3 のヘッダー
// チップ)は実装前に schemas/events/plaza-post.schema.json を確認したが、
// temperature/humidity/lineage/stage に相当するフィールドは存在せず
// additionalProperties:false のため今後も投稿へ紛れ込めない。捏造しない
// (誇張ゼロ)ため、このチップ列と .ctx-note は丸ごと省略する(タスク報告に記載)。
// 同様に .photo-block(写真添付)に対応するフィールドも plaza-post スキーマに
// 存在しないため、投機的な分岐コードを足さず丸ごと省略する。
type KnwChatPost = ThreadPost;

// avatar の背景色 — mockup はユーザーごとに固定色の実例(青/緑/橙/灰の4色、
// 値は .knw-thread の --blue/--primary/--secondary/--muted トークンと同一)を
// 示すのみで正本カラーパレットは無い。ui-tokens GATE(raw hex 禁止・design-c2
// §4.4)に従い、raw hex を書かずトークン var() 経由で再利用する(speciesColorVar
// と同じ「決定論ハッシュ→固定パレット選択」の流儀・per-user Truth フィールド
// は新設しない・見た目は毎回同じ actor_id で安定)。
const KNW_CHAT_AVATAR_VARS = ["var(--blue)", "var(--primary)", "var(--secondary)", "var(--muted)"];
function knwChatAvatarColor(actorId: string): string {
  let h = 0;
  for (let i = 0; i < actorId.length; i++) h = (h * 31 + actorId.charCodeAt(i)) >>> 0;
  return KNW_CHAT_AVATAR_VARS[h % KNW_CHAT_AVATAR_VARS.length];
}

// formatDateJa(renderer 唯一の日付整形)は "YYYY-MM-DD" 専用 — チャットの
// msg-meta は mockup 通り時刻(HH:MM)なので別関数にする(既存を再利用できない
// 唯一の理由=フォーマットの粒度そのものが違う)。
function knwChatTime(value: unknown): string {
  const d = new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function KnwChatMessage({ post, me }: { post: KnwChatPost; me: boolean }) {
  const time = knwChatTime(post.created_at);
  // own posts: mockup section3's .msg.me demo shows avatar "あ" + name "あなた"
  // literally, not the viewer's own actor_id/ActorLabel lookup — showing the
  // raw actor_id hash for yourself is a needless ID leak (owner report).
  return (
    <div className={cn("msg", me && "me")} data-post-id={post.post_id}>
      <div className="avatar" style={{ background: knwChatAvatarColor(post.actor_id) }} aria-hidden="true">
        {me ? "あ" : monogram(post.actor_id)}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          {me ? "あなた" : <ActorLabel actorId={post.actor_id} />}
          {time && ` ・ ${time}`}
        </div>
        <div className="bubble">{post.body}</div>
        {/* .photo-block omitted — no photo/attachment field exists on
            ihl.plaza.post.v1 (see comment above); not fabricated. */}
      </div>
    </div>
  );
}

// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/knowledge-thread.json
// はnode {type:"list", props:{variant:"knowledge-thread-chat"}} 1個のみでこの
// コンポーネントに委譲。動作影響なし):
//   投稿バブル一覧(avatar/handle+本文+引用badge)+発言フォーム+スレ主のみの
//   解決マーク。送信後は同画面内で5秒ポーリングのreload()により即時反映
//   (画面遷移なし=navigate()を呼ばない自己完結コンポーネント)。
function KnowledgeThreadChatNode({ node }: { node: ScreenNode }) {
  const p = props(node);
  const execute = useContext(ExecuteCtx);
  const scope = useContext(ScopeCtx);
  const threadId = String(scope.params.thread_id ?? "");
  const basePath = String(p.source_path ?? "/api/v1/plaza/threads");
  const [view, setView] = useState<ThreadView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [viewerId, setViewerId] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    if (!threadId) {
      setLoaded(true);
      return;
    }
    try {
      const v = (await execute({ kind: "api", method: "GET", path: `${basePath}/${threadId}` })) as ThreadView;
      setView(v);
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [execute, basePath, threadId]);

  useEffect(() => {
    let alive = true;
    void reload();
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

  // リアルタイム = クライアントポーリング(5秒ごと)。websocket/常駐サーバー
  // ではない(不変条項①10年ランニングコスト最小 — マウント中のみ・アンマウ
  // ントで確実に clearInterval)。
  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(() => {
      void reload();
    }, 5000);
    return () => clearInterval(timer);
  }, [threadId, reload]);

  const posts = view?.posts ?? [];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [posts.length]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !view || sending) return;
    setSending(true);
    try {
      await execute(
        { kind: "api", method: "POST", path: "/api/v1/plaza/posts" },
        {
          channel: view.channel,
          topic: view.topic,
          board_kind: view.posts[0]?.board_kind,
          thread_id: threadId,
          body,
        },
      );
      setDraft("");
      await reload();
    } finally {
      setSending(false);
    }
  }, [draft, view, sending, execute, threadId, reload]);

  // view 未取得(thread_id 未指定 or フェッチ失敗)でも見出しは常に非空にする
  // — 空だと .thread-title が視覚的に潰れ、画面が「空白」に見える(screen-sweep が
  //   「見出しなし=空白ページ」として検出)。空スレ状態でも topic の器を見せる。
  const title = !loaded ? "読み込み中…" : (view?.topic || "スレッド");

  return (
    <div className="knw-thread">
      <div className="card thread-card">
        <div className="thread-header">
          <h3 className="thread-title">{title}</h3>
          {/* .ctx-chips/.ctx-note omitted — no real breeding-context data
              (temp/humidity/lineage/stage) attaches to a plaza post today;
              see comment above. Not fabricated (誇張ゼロ). */}
        </div>
        <div className="chat-scroll" ref={scrollRef}>
          {!loaded ? (
            <p className="civ-text" data-muted="true">
              読み込み中…
            </p>
          ) : posts.length === 0 ? (
            <p className="civ-empty">まだ投稿がありません。最初のメッセージを送ってみましょう。</p>
          ) : (
            posts.map((post) => <KnwChatMessage key={post.post_id} post={post} me={!!viewerId && post.actor_id === viewerId} />)
          )}
        </div>
        <div className="chat-input-bar">
          <input
            className="chat-input"
            type="text"
            placeholder="メッセージを送る…"
            aria-label="メッセージを送る"
            value={draft}
            disabled={sending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="send-btn"
            aria-label="送信"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

registerNode("list:knowledge-thread-chat", KnowledgeThreadChatNode);
