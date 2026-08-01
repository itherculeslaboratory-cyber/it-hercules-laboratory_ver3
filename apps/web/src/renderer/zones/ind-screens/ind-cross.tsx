"use client";

import { useContext } from "react";
import { cn } from "@/lib/cn";
import { ScopeCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet, indPct, indNum } from "./shared";

// ============ 4. 累代分析(cross)= 個体の詳細から開く ============
type IndCross = {
  cohort_size: number;
  weight_by_instar: { first: number | null; second: number | null; third_early: number | null; third_late: number | null };
  size_extremes: { max_weight: number | null; max_length: number | null; min_length: number | null };
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
};
function IndCrossNode() {
  const scope = useContext(ScopeCtx);
  const id = String(scope.params.id ?? "");
  const data = useIndGet<IndCross>(id ? `/api/v1/individuals/${id}/cross` : null);

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
  if (data.cohort_size === 0)
    return empty("まだ子の記録がありません。この個体を親にした子が記録されると、ここに成績が出ます。");

  const r = data.rates;
  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}
          <div className="card">
            <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "14px" }}>
              この親からの子: <b style={{ color: "var(--text)" }}>{data.cohort_size}匹</b> を集計
            </div>
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

            <div className="subhead">令ごとの平均体重</div>
            <div className="instar-row">
              <div className="instar-tile">
                <div className="i-num">{data.weight_by_instar.first == null ? "—" : `${indNum(data.weight_by_instar.first)}g`}</div>
                <div className="i-label">1令</div>
              </div>
              <div className="instar-tile">
                <div className="i-num">{data.weight_by_instar.second == null ? "—" : `${indNum(data.weight_by_instar.second)}g`}</div>
                <div className="i-label">2令</div>
              </div>
              <div className="instar-tile">
                <div className="i-num">
                  {data.weight_by_instar.third_early == null ? "—" : `${indNum(data.weight_by_instar.third_early)}g`}
                </div>
                <div className="i-label">3令 前期</div>
              </div>
              <div className="instar-tile">
                <div className="i-num">
                  {data.weight_by_instar.third_late == null ? "—" : `${indNum(data.weight_by_instar.third_late)}g`}
                </div>
                <div className="i-label">3令 後期</div>
              </div>
            </div>
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
            </div>

            <p className="source-note">
              情報は <code>GET /individuals/{"{id}"}/cross</code> の実データ(生存・完品・羽化不全・孵化・死亡・性比・令別平均体重・サイズ極値・色の再現性はすべて観測から都度計算)。色の再現性は親・子それぞれの色記録(ihl.obs.color.v1)のΔE76(色差)から算出し、色記録が無い個体は集計から除きます。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-cross", IndCrossNode);
