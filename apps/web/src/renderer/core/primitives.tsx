"use client";

import { useContext, useEffect, useState } from "react";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { ExecuteCtx } from "./context";

// renderer分割Phase 2b裁定(g85-split2a-ruling §3 #1/#2)によりここへ一本化。
// 元定義: renderer.tsx:1075-1077(Badge)・:6125-6165(monogram/shortActorId/
// actorNameCache/ActorLabel)。ActorLabelはPhase 2b後もrenderer.tsx zone C
// (button/card内)から使い続けられるため、renderer.tsx側もimportへ置き換える。
// 複製先(解消対象): zones/obs-batch.tsx・search.tsx・ind-profile.tsx・
// thread-posts.tsx・knowledge-chat.tsx。
export function Badge({ text, tone }: { text: string; tone?: string }) {
  return <ShadcnBadge tone={tone}>{text}</ShadcnBadge>;
}

// The avatar monogram is derived FROM the real actor_id (not an invented
// name) — same honesty bar as the short-hash label next to it. A self-
// reported display_name (ihl.actor.display_name.v1, c8 UI磨き第2弾#5) may
// additionally exist now; monogram stays id-derived either way (a stable,
// always-available glyph even before the name has resolved/if never set).
export function monogram(actorId: string): string {
  return actorId.trim().slice(0, 1).toUpperCase() || "?";
}

// actor_id is a 64-char hex hash (deriveActorId) — showing it in full breaks
// mobile (390px) layout (V3-AIP-101 c8 screenshot gate caught this: the raw
// id overflowed the viewport instead of wrapping). Truncate for display; the
// full id still round-trips via the title attribute for anyone who needs to
// copy it (e.g. into the dispute screen's respondent_id field).
export function shortActorId(actorId: string): string {
  return actorId.length > 12 ? `${actorId.slice(0, 10)}…` : actorId;
}

// c8 UI磨き第2弾#5(受領10・actor_id 生ハッシュ露出の解消): actor 表示プリミティブ。
// display_name があればそれを、無ければ shortActorId フォールバックを表示する。
// module-level cache は同一 actor_id が同一画面内で何度も出る(スレの各投稿・
// 入札テーブルの各行等)ため、per-instance に毎回 fetch させない最小の共有(React
// state ではなく素朴な Map ひとつ — 新アーキテクチャは要らない)。"" はキャッシュ
// 済みだが display_name 未設定を意味し、再フェッチしない。
export const actorNameCache = new Map<string, string>();

export function ActorLabel({ actorId }: { actorId: string }) {
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
