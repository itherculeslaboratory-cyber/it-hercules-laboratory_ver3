"use client";

import { useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet, indNum, type IndBioCard } from "./shared";

// ============ 1. マッチング(match)= 好み学習型(気晴らし・寄り道の探索) ============
// fidelity-A5#8: 婚活的な相手探しではなく個体・好み学習に限定。実データ配線:
// GET /match/convergence(好みの固まり具合=auc/converged/n_events)+ GET /match/ranking
// (内積降順の item_id・点数は非公開)。候補は各 bio-card で実フィールド(種/特徴タグ/
// 最新サイズ)に肉付けする。★正直な限界: 左右選択で好みを「教える」往復は、順位API
// が特徴ベクトル(features)を伏せる設計(点数を出さない)のため、この画面からは学習の
// 書き込みまではつなげない。カードは個体詳細への実導線にし、順位=学習済みの
// 「好みに近い順」を正直に見せる(学習自体は観測時に行われる)。
function IndMatchNode() {
  const execute = useContext(ExecuteCtx);
  const ranking = useIndGet<{ ranking: { item_id: string }[] }>("/api/v1/match/ranking");
  const convergence = useIndGet<{ auc: number | null; converged: boolean; n_events: number }>("/api/v1/match/convergence");
  const [cards, setCards] = useState<Record<string, IndBioCard | null>>({});

  const topTwo = (ranking?.ranking ?? []).slice(0, 2).map((r) => r.item_id);
  const topKey = topTwo.join(",");
  useEffect(() => {
    if (topTwo.length === 0) return;
    let alive = true;
    Promise.all(
      topTwo.map((itemId) =>
        Promise.resolve(execute({ kind: "api", method: "GET", path: `/api/v1/individuals/${itemId}/bio-card` }))
          .then((v) => [itemId, (v as IndBioCard | undefined) ?? null] as const)
          .catch(() => [itemId, null] as const),
      ),
    ).then((entries) => {
      if (alive) setCards(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topKey]);

  const auc = convergence?.auc ?? null;
  const converged = convergence?.converged ?? false;
  const nEvents = convergence?.n_events ?? 0;
  const fillPct = auc != null ? Math.round(auc * 100) : Math.min(60, nEvents * 6);

  const renderCard = (itemId: string, side: "a" | "b", rank: number) => {
    const bc = cards[itemId];
    return (
      <a key={itemId} className={cn("swipe-card", rank === 1 && "chosen")} href={`/s/individual-detail?id=${itemId}`}>
        <div className={cn("swipe-photo", side)}>🪲</div>
        <div className="swipe-body">
          <div className="swipe-name">{bc?.species ?? "この個体"}</div>
          <div className="swipe-traits">
            {bc?.latest_size != null && <span className="trait-chip">サイズ {indNum(bc.latest_size)}</span>}
            {(bc?.feature_tags ?? []).slice(0, 3).map((t) => (
              <span className="trait-chip" key={t}>
                {t}
              </span>
            ))}
            {(!bc || (bc.feature_tags.length === 0 && bc.latest_size == null)) && (
              <span className="trait-chip">特徴タグはまだありません</span>
            )}
          </div>
        </div>
        <div className="swipe-pick">{rank === 1 ? "いま好みに近い(1位)" : "2位"}</div>
      </a>
    );
  };

  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          <div className="section-head">
            <span className="screen-tag">見つける ・ 画面: マッチング</span>
            <h1 className="section-title">💞 好みに近い1匹を選ぶ</h1>
            <p className="section-why">
              <b>なぜここに来る?</b> 数が多くて迷う時の寄り道。あなたがこれまで見てきた個体を、覚えた「好み」に近い順に並べます。
            </p>
          </div>
          <div className="card">
            {topTwo.length < 2 ? (
              <p className="civ-empty">
                好みくらべに使える個体がまだ足りません。個体を観測して記録がたまると、覚えた好みに近い順で2匹をくらべられます。
              </p>
            ) : (
              <>
                <div className="swipe-row">
                  {renderCard(topTwo[0], "a", 1)}
                  <div className="swipe-vs">VS</div>
                  {renderCard(topTwo[1], "b", 2)}
                </div>
                <div className="pass-row">
                  <a className="pass-btn" href="/s/obs-search">
                    ほかの個体も見る
                  </a>
                </div>
              </>
            )}

            <div className="learn-strip">
              <span className="ls-badge">🎯 {converged ? "好みが固まってきました" : "好みを学習中"}</span>
              <span className="ls-bar">
                <span className="ls-fill" style={{ width: `${fillPct}%` }} />
              </span>
              <span className="ls-meta">
                {converged
                  ? "好みが固まりました(目安を超えました)。"
                  : auc != null
                    ? "学習の目安まであと少しです。"
                    : "まだ学習を始めたばかりです。"}
                これまで{nEvents}回の選択から学習・順位の点数は出しません。
              </span>
            </div>

            <p className="source-note">
              情報は <code>GET /match/ranking</code>(好みに近い順・点数は<b>非公開</b>)と <code>GET /match/convergence</code>(好みの固まり具合)の実データです。候補は「あなたが今までに見た個体」から並びます。
              好みを教える往復(左右選択)は観測の時に行われます。全個体を宇宙のように並べる座標表示は後の波です。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-match", IndMatchNode);
