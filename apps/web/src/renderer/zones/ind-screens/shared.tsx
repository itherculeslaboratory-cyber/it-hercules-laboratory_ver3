"use client";

import { useContext, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ExecuteCtx } from "../../core/context";

// ─────────────────────────────────────────────────────────────────────────────
// Z9(g85-split2a) — このファイルは renderer.tsx の以下の範囲を「1文字も改変せず」
// 抜き出したもの(renderer.tsx 側はまだ何も削除していない=Phase 2b で削除)。
// 実測範囲(2026-08-02時点のワーキングツリー): renderer.tsx L8630-L10021
//   L8630 banner「個体・種(IND)ゾーン 5画面」〜 L10021 IndBioCardNode() 終端。
// 登録キー: list:ind-detail / ind-match / pref-pairwise / ind-species / ind-cross / ind-bio-card
// ─────────────────────────────────────────────────────────────────────────────

// Phase 2b(g85-split2a-ruling §3)で一本化済み: IndDetailNode/IndGrowthChart が
// 使うIndividualProfile/PedNode/profileLabel/seriesFor等はcore/individual.ts
// からimportする(旧: renderer.tsx/zones/ind-profile.tsxとの複製)。

// g87-indsplit(2026-08-02・ORDER-2026-08-02-g87-indsplit): zones/ind-screens.tsx
// (6画面variant)を6ファイルへ移動分割(移動のみ・改修禁止)。この shared.ts は
// 6ノード間で共有されるヘルパー(useIndGet/IndQr/indPct/indNum)と型(IndBioCard)の
// 退避先(移動のみ・本文は元の1文字も変えていない。export化のみ追加)。

// 1画面 = 1 GET を購読する軽量フック(HomeDashboardNode の useEffect 直配線を1つに
// まとめただけ・常駐キャッシュ無し=不変条項①)。path が null の間は取得しない。
export function useIndGet<T>(path: string | null): T | null {
  const execute = useContext(ExecuteCtx);
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    Promise.resolve(execute({ kind: "api", method: "GET", path }))
      .then((v) => {
        if (alive) setData((v as T | undefined) ?? null);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return data;
}

// 実データの QR(mockup の ▦ プレースホルダを本物の QR に置換)。QrNode と同じ
// qrcode ライブラリ(既存依存)を使う。value は個体URL/発行トークン。
export function IndQr({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value || " ", { type: "svg", margin: 0 })
      .then((s) => {
        if (alive) setSvg(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);
  return <div className={className} role="img" aria-label={`QRコード: ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const indPct = (r: number | null | undefined): string => (r == null ? "—" : `${Math.round(r * 100)}%`);
export const indNum = (n: number | null | undefined): string =>
  n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1);

export type IndBioCard = {
  individual_id: string;
  species: string | null;
  morph: string | null;
  latest_size: number | null;
  feature_tags: string[];
  qr_url: string;
  thumbnail_path: string | null;
  photo_conditions: { temp_c?: number; humidity_pct?: number; captured_at: string } | null;
};

// Phase 2b裁定(g85-split2a-ruling §3 #4/#6)によりProfile*/IndividualProfile/
// PedNode/ULID_RE/safeLabel/profileLabel/measureValue/seriesFor/isDegenerate/
// collectAncestors/inbreedingCoefficient/inbreedingTone/TimelineEntry/
// buildTimeline/prevValueFnはcore/individual.ts・core/scope.tsへ一本化済み
// (importは各ファイル冒頭)。旧「Z9が自己完結するための重複」節はこれで解消。
