// renderer分割Phase 2b裁定(g85-split2a-ruling §3 #3)によりここへ一本化。
// 元定義: renderer.tsx:6100-6118。Phase 2b後の利用者はzones/thread-posts.tsx
// (Z4)とzones/knowledge-chat.tsx(Z8)の2ファイルのみ(renderer.tsxは不要)。
// 複製先(解消対象): zones/thread-posts.tsx・knowledge-chat.tsx。

// V3-AIP-101 c8 knowledge-thread — per-post avatar/handle/body/cite/action row
// (Path B dedicated node: catalog c8-ui-asset-catalog.md 【最優先2】 — the
// generic `list` node's item_text is text+image only and cannot express a
// per-post avatar + inline actions). Self-fetches its own thread (same
// convention as individual-profile/search-navigator) instead of depending on
// a sibling list node's source_path.
export type ThreadPost = {
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
export type ThreadView = {
  thread_id: string;
  channel: string;
  topic: string;
  posts: ThreadPost[];
  tombstones?: Array<{ ref: { type: string; id: string }; reason: string }>;
};
