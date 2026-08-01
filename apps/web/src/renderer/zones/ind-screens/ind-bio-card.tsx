"use client";

import { useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";
import { ScopeCtx, ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { type IndividualProfile } from "../../core/individual";
import { useIndGet, IndQr, indNum, type IndBioCard } from "./shared";

// ============ 5. バイオカード(bio-card)============
function IndBioCardNode() {
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const id = String(scope.params.id ?? "");
  const card = useIndGet<IndBioCard>(id ? `/api/v1/individuals/${id}/bio-card` : null);
  // 名刺上部の表示名は個体の記録から差し込む。表示名の出所は個体詳細と同じ
  // master.local_label_text(登録時の呼び名)を第一に、次に命名イベント(projectName)、
  // 種名の順。bio-card 投影は表示名を返さないので profile を1本引く。
  const prof = useIndGet<IndividualProfile>(id ? `/api/v1/individuals/${id}` : null);
  const [batchDone, setBatchDone] = useState<number | null>(null);
  const [batchPending, setBatchPending] = useState<number | null>(null);

  const issueBatch = useCallback(
    async (count: number) => {
      setBatchPending(count);
      try {
        const r = (await execute({ kind: "api", method: "POST", path: "/api/v1/individuals/qr-batch" }, { count })) as
          | { count?: number }
          | undefined;
        setBatchDone(r?.count ?? count);
      } catch {
        // best-effort
      } finally {
        setBatchPending(null);
      }
    },
    [execute],
  );

  const head = (
    <div className="section-head">
      <span className="screen-tag">たどる ・ 画面: バイオカード</span>
      <h1 className="section-title">🪪 見せる・貼る「名刺」</h1>
      <p className="section-why">
        <b>なぜここに来る?</b> 個体を人に見せる時、ケースに貼る時。種・最新サイズ・特徴と、読み取ると個体ページに飛ぶQRを1枚にまとめます。
      </p>
    </div>
  );

  const empty = (msg: string) => (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}
          <div className="card">
            <p className="civ-empty">{msg}</p>
          </div>
        </section>
      </div>
    </div>
  );

  if (!id) return empty("個体を選ぶと、その個体の名刺(バイオカード)を作れます(個体の詳細から開きます)。");
  if (!card) return empty("読み込み中…");

  const displayName = prof?.master?.local_label_text || prof?.name || card.species || id;
  const showSpeciesSub = !!card.species && card.species !== displayName;
  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}
          <div className="card">
            <div className="biocard-preview">
              <div className="meishi">
                <div className="meishi-top">
                  <div>
                    <div className="meishi-name">{displayName}</div>
                    {showSpeciesSub && <div className="meishi-sp">{card.species}</div>}
                  </div>
                  <IndQr value={card.qr_url} className="meishi-qr" />
                </div>
                <div className="meishi-body">
                  <div className="meishi-field">
                    <span className="mf-k">種</span>
                    <span className="mf-v">{card.species ?? "未登録"}</span>
                  </div>
                  <div className="meishi-field">
                    <span className="mf-k">最新サイズ</span>
                    <span className="mf-v">{card.latest_size == null ? "記録なし" : indNum(card.latest_size)}</span>
                  </div>
                  <div className="meishi-field">
                    <span className="mf-k">特徴</span>
                    <span className="meishi-tags">
                      {card.feature_tags.length === 0 ? (
                        <span className="trait-chip">タグはまだありません</span>
                      ) : (
                        card.feature_tags.map((t) => (
                          <span className="trait-chip" key={t}>
                            {t}
                          </span>
                        ))
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="biocard-side">
                <div className="bs-t">まとめて印刷</div>
                <div className="bs-d">ブリード数が多い人向けに、QRラベルを一度にたくさん発行できます。</div>
                <div className="batch-opts">
                  {[100, 500, 1000].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={cn("batch-opt", batchDone === n && "chosen")}
                      onClick={() => issueBatch(n)}
                      disabled={batchPending != null}
                    >
                      {n}枚
                    </button>
                  ))}
                </div>
                {batchDone != null && <div className="batch-done">{batchDone}枚分のQRラベルを発行しました。</div>}
              </div>
            </div>

            <p className="source-note">
              情報は <code>GET /individuals/{"{id}"}/bio-card</code>(種・最新サイズ・特徴タグ・個体URL)の実データ。名刺上部の表示名は個体の記録から差し込みます。発行数は 100 / 500 / 1000 のみ。形態(モルフ)の表示は、個体へのひもづけが入る後の波で対応します。等倍印刷の物理的なズレ確認は人の目で行います。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-bio-card", IndBioCardNode);
