"use client";

import { useContext } from "react";
import { cn } from "@/lib/cn";
import { ScopeCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet, indPct, indNum } from "./helpers";

// ============ 4. 累代分析(cross)= 個体の詳細から開く ============
type ClutchLayerRow = {
  clutch_id: string;
  role: "sire" | "dam";
  harvested_at: string | null;
  initial_count: number;
  current_count: number;
  container_label: string | null;
};
type MissingLaneRow = { clutch_id: string; event_id: string; at: string; discrepancy: number };
type IndCross = {
  cohort_size: number;
  weight_by_instar: { first: number | null; second: number | null; third_early: number | null; third_late: number | null };
  // R0807-92d58e w1-small T2: 令(=世代)ごとの最大・最小(既存weight_by_instarの平均とは別枠)。
  weight_by_instar_extremes: {
    first: { min: number | null; max: number | null };
    second: { min: number | null; max: number | null };
    third_early: { min: number | null; max: number | null };
    third_late: { min: number | null; max: number | null };
  };
  size_extremes: {
    max_weight: number | null;
    max_length: number | null;
    min_length: number | null;
    max_horn_length: number | null;
    min_horn_length: number | null;
  };
  rates: {
    mortality: number;
    survival: number;
    completion: number;
    eclosion_failure: number;
    hatch_rate: number;
    sex_ratio: number | null;
    color_reproducibility: number | null;
  };
  color_reproducibility_sample: { parent_has_color: boolean; children_with_color: number };
  clutch_layer: ClutchLayerRow[];
  missing_lane: MissingLaneRow[];
};
type PedigreeNode = {
  individual_id: string;
  known: boolean;
  circular?: boolean;
  truncated?: boolean;
  parent_role?: "sire" | "dam" | "surrogate";
  parents: PedigreeNode[];
};

function PedigreeBranch({ node, depth }: { node: PedigreeNode; depth: number }) {
  const roleLabel = node.parent_role === "sire" ? "父" : node.parent_role === "dam" ? "母" : node.parent_role === "surrogate" ? "代理" : null;
  const statusLabel = node.circular ? "(循環参照)" : node.truncated ? "(これ以上は未取得)" : !node.known ? "(個体記録なし)" : "";
  return (
    <div style={{ marginLeft: depth * 16, marginTop: "4px", fontSize: "12.5px" }}>
      <span style={{ color: "var(--muted)" }}>{roleLabel ? `${roleLabel}: ` : ""}</span>
      <span style={{ color: node.known ? "var(--text)" : "var(--muted)" }}>{node.individual_id}</span>
      {statusLabel && <span style={{ color: "var(--muted)" }}> {statusLabel}</span>}
      {node.parents.map((p, i) => (
        <PedigreeBranch key={`${p.individual_id}-${p.parent_role ?? i}`} node={p} depth={depth + 1} />
      ))}
    </div>
  );
}

function IndCrossNode() {
  const scope = useContext(ScopeCtx);
  const id = String(scope.params.id ?? "");
  const data = useIndGet<IndCross>(id ? `/api/v1/individuals/${id}/cross` : null);
  const pedigree = useIndGet<PedigreeNode>(id ? `/api/v1/individuals/${id}/pedigree` : null);

  const head = (
    <div className="section-head">
      <span className="screen-tag">たどる ・ 画面: 累代分析</span>
      <h1 className="section-title">📈 この親からの子は、どれくらい無事に育つ?</h1>
      <p className="section-why">
        <b>なぜここに来る?</b> 「累代(るいだい)」=この個体を親としてかけ合わせた子たちの成績。次にどの親を使うかの判断材料にします。この画面は<b>個体の詳細から開きます</b>。
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

  if (!id) return empty("個体の詳細から開くと、その個体を親にした子たちの成績を表示します。");
  if (!data) return empty("読み込み中…");
  // clutch_layer/missing_lane はg87-c4crossで追加した投影(既存レスポンス形状には無い
  // 場合がありうる=?? [] で安全側に倒す。データ自体が無いのと0件は区別しない
  // (どちらも「クラッチ記録なし」で正しい)。
  const clutchLayer = data.clutch_layer ?? [];
  const missingLane = data.missing_lane ?? [];
  const hasClutchLayer = clutchLayer.length > 0;
  if (data.cohort_size === 0 && !hasClutchLayer)
    return empty("まだ子の記録がありません。この個体を親にした子が記録されると、ここに成績が出ます。");

  const r = data.rates;
  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}
          <div className="card">
            <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "14px" }}>
              この親からの子(個体化済み): <b style={{ color: "var(--text)" }}>{data.cohort_size}匹</b> を集計
            </div>
            {data.cohort_size > 0 ? (
              <>
                <div className="rate-grid">
                  <div className="rate-tile good">
                    <div className="r-num">{indPct(r.survival)}</div>
                    <div className="r-label">生存率</div>
                    <div className="r-plain">生きている割合</div>
                  </div>
                  <div className="rate-tile good">
                    <div className="r-num">{indPct(r.completion)}</div>
                    <div className="r-label">完品率</div>
                    <div className="r-plain">無事に羽化した割合</div>
                  </div>
                  <div className="rate-tile warn">
                    <div className="r-num">{indPct(r.eclosion_failure)}</div>
                    <div className="r-label">羽化不全率</div>
                    <div className="r-plain">羽化に失敗した割合</div>
                  </div>
                  <div className="rate-tile">
                    <div className="r-num">{indPct(r.hatch_rate)}</div>
                    <div className="r-label">孵化率</div>
                    <div className="r-plain">卵からかえった割合</div>
                  </div>
                  <div className="rate-tile warn">
                    <div className="r-num">{indPct(r.mortality)}</div>
                    <div className="r-label">死亡率</div>
                    <div className="r-plain">亡くなった割合</div>
                  </div>
                  <div className="rate-tile">
                    <div className="r-num">{r.sex_ratio == null ? "—" : r.sex_ratio.toFixed(2)}</div>
                    <div className="r-label">性比(雄の割合)</div>
                    <div className="r-plain">オスの比率</div>
                  </div>
                  <div className={cn("rate-tile", r.color_reproducibility == null ? "prep" : undefined)}>
                    <div className="r-num">{indPct(r.color_reproducibility)}</div>
                    <div className="r-label">色の再現性</div>
                    <div className="r-plain">
                      {r.color_reproducibility == null
                        ? data.color_reproducibility_sample.parent_has_color
                          ? "子の色データがまだありません"
                          : "この親の色データがまだありません"
                        : `色データがある子${data.color_reproducibility_sample.children_with_color}匹の平均`}
                    </div>
                  </div>
                </div>

                <div className="subhead">令(世代)ごとの平均体重</div>
                {(() => {
                  // R0807-92d58e w1-small T2: 「グラフ」要望への最小実装。新規チャートライブラリは
                  // 導入せず(reuse-first)、既存instar-tileへ相対バー(CSS width%)を1本足すだけの
                  // 簡易グラフ。4令分のavgのうち最大値を100%として各バーの幅を決める。
                  const instars = [
                    { key: "first", label: "1令", avg: data.weight_by_instar.first, ex: data.weight_by_instar_extremes?.first },
                    { key: "second", label: "2令", avg: data.weight_by_instar.second, ex: data.weight_by_instar_extremes?.second },
                    { key: "third_early", label: "3令 前期", avg: data.weight_by_instar.third_early, ex: data.weight_by_instar_extremes?.third_early },
                    { key: "third_late", label: "3令 後期", avg: data.weight_by_instar.third_late, ex: data.weight_by_instar_extremes?.third_late },
                  ];
                  const maxAvg = Math.max(0, ...instars.map((i) => i.avg ?? 0));
                  return (
                    <div className="instar-row">
                      {instars.map((i) => (
                        <div className="instar-tile" key={i.key}>
                          <div className="i-num">{i.avg == null ? "—" : `${indNum(i.avg)}g`}</div>
                          {i.avg != null && maxAvg > 0 && (
                            <div style={{ height: "4px", background: "var(--border)", borderRadius: "2px", margin: "4px 0" }}>
                              <div
                                style={{
                                  height: "100%",
                                  width: `${Math.max(4, (i.avg / maxAvg) * 100)}%`,
                                  background: "var(--primary)",
                                  borderRadius: "2px",
                                }}
                              />
                            </div>
                          )}
                          <div className="i-label">{i.label}</div>
                          <div style={{ fontSize: "10.5px", color: "var(--muted)" }}>
                            最大 {i.ex?.max == null ? "—" : `${indNum(i.ex.max)}g`} / 最小 {i.ex?.min == null ? "—" : `${indNum(i.ex.min)}g`}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="extremes">
                  <span>
                    最大体重 <b>{data.size_extremes.max_weight == null ? "—" : `${indNum(data.size_extremes.max_weight)}g`}</b>
                  </span>
                  <span>
                    最大体長 <b>{data.size_extremes.max_length == null ? "—" : `${indNum(data.size_extremes.max_length)}mm`}</b>
                  </span>
                  <span>
                    最小体長 <b>{data.size_extremes.min_length == null ? "—" : `${indNum(data.size_extremes.min_length)}mm`}</b>
                  </span>
                  <span>
                    最大胸角長{" "}
                    <b>{data.size_extremes.max_horn_length == null ? "—" : `${indNum(data.size_extremes.max_horn_length)}mm`}</b>
                  </span>
                  <span>
                    最小胸角長{" "}
                    <b>{data.size_extremes.min_horn_length == null ? "—" : `${indNum(data.size_extremes.min_horn_length)}mm`}</b>
                  </span>
                </div>
              </>
            ) : (
              <p className="civ-empty">まだ個体化(昇格)した子がいません。下のクラッチ(集団)記録のみです。</p>
            )}

            <div className="subhead">クラッチ(集団)層 — 個体化する前の匿名プール</div>
            {hasClutchLayer ? (
              <div className="instar-row">
                {clutchLayer.map((cl) => (
                  <div className="instar-tile" key={cl.clutch_id}>
                    <div className="i-num">
                      {cl.current_count}
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}> / {cl.initial_count}匹</span>
                    </div>
                    <div className="i-label">
                      {cl.role === "sire" ? "父として" : "母として"}{cl.container_label ? `・${cl.container_label}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="civ-empty">この親が sire/dam に指名されたクラッチ(割り出し記録)はゼロです。</p>
            )}

            <div className="subhead">消息不明レーン — 匹数照合の食い違い(行方不明疑い)</div>
            {missingLane.length > 0 ? (
              <div className="extremes" style={{ flexDirection: "column", alignItems: "flex-start", gap: "6px" }}>
                {missingLane.map((m) => (
                  <span key={m.event_id}>
                    クラッチ <b>{m.clutch_id}</b>: 照合で <b style={{ color: "var(--secondary)" }}>{m.discrepancy}匹</b> 想定より少ない({m.at.slice(0, 10)})
                  </span>
                ))}
              </div>
            ) : (
              <p className="civ-empty">ゼロ(行方不明疑いの照合記録はありません)。</p>
            )}

            <div className="subhead">系統(血縁) — わかっている祖先</div>
            {!pedigree ? (
              <p className="civ-empty">読み込み中…</p>
            ) : (pedigree.parents ?? []).length > 0 ? (
              <div>
                {pedigree.parents.map((p, i) => (
                  <PedigreeBranch key={`${p.individual_id}-${p.parent_role ?? i}`} node={p} depth={0} />
                ))}
              </div>
            ) : (
              <p className="civ-empty">この個体の親として記録された血縁はありません。</p>
            )}

            <p className="source-note">
              rates/instar/extremes/クラッチ層/消息不明レーンは <code>GET /individuals/{"{id}"}/cross</code>、系統は{" "}
              <code>GET /individuals/{"{id}"}/pedigree</code> の実データ(生存・完品・羽化不全・孵化・死亡・性比・令別平均体重・サイズ極値・色の再現性・クラッチ匹数はすべて観測/クラッチ記録から都度計算)。色の再現性は親・子それぞれの色記録(ihl.obs.color.v1)のΔE76(色差)から算出し、色記録が無い個体は集計から除きます。
              <br />
              <b>再現できない要素:</b> 産地層別統計はここには載せていません(個体・クラッチいずれのTruthスキーマにも産地/countryフィールドが存在しないため、捏造せず対応を見送っています)。胸角の<b>太さ</b>も同様に見送っています(観測データに太さの計測項目が一件も存在しないため)。系統は個体IDのみの表示で、祖先の名前・種は本画面では解決していません(個体詳細から辿って確認してください)。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-cross", IndCrossNode);
