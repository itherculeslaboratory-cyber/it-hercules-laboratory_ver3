"use client";

import { useCallback, useContext, useState } from "react";
import { ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet, indNum } from "./shared";

// ============ 2. 種の管理(species)============
type IndSpeciesRow = {
  species_id: string;
  name?: string;
  forked_from?: string;
  lineage?: string;
  stats: { sample_count: number; avg_size: number | null; avg_weight: number | null; avg_market_price: number | null };
};
function IndSpeciesNode() {
  const execute = useContext(ExecuteCtx);
  const [reloadKey, setReloadKey] = useState(0);
  const data = useIndGet<{ species: IndSpeciesRow[] }>(`/api/v1/species${reloadKey ? `?_r=${reloadKey}` : ""}`);
  const [name, setName] = useState("");
  const [forkedFrom, setForkedFrom] = useState("");
  const [pending, setPending] = useState(false);
  const [alias, setAlias] = useState<{ name: string; score: number } | null>(null);

  const list = data?.species ?? [];

  const onNameChange = useCallback(
    async (value: string) => {
      setName(value);
      if (value.trim().length < 2) {
        setAlias(null);
        return;
      }
      try {
        const r = (await execute({
          kind: "api",
          method: "GET",
          path: `/api/v1/species/alias-candidates?name=${encodeURIComponent(value.trim())}`,
        })) as { candidates?: { name: string; score: number }[] } | undefined;
        const top = r?.candidates?.[0];
        setAlias(top && top.score >= 0.6 ? { name: top.name, score: top.score } : null);
      } catch {
        setAlias(null);
      }
    },
    [execute],
  );

  const submit = useCallback(async () => {
    if (!name.trim() || pending) return;
    setPending(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (forkedFrom.trim()) body.forked_from = forkedFrom.trim();
      await execute({ kind: "api", method: "POST", path: "/api/v1/species" }, body);
      setName("");
      setForkedFrom("");
      setAlias(null);
      setReloadKey((k) => k + 1);
    } finally {
      setPending(false);
    }
  }, [name, forkedFrom, pending, execute]);

  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          <div className="section-head">
            <span className="screen-tag">見つける ・ 画面: 種の管理</span>
            <h1 className="section-title">🌿 扱う種の基礎データ</h1>
            <p className="section-why">
              <b>なぜここに来る?</b> 「この種って平均どのくらい育つの?」を知りたい時、新しい種を登録したい時。数字はみんなの観測から自動で計算します。
            </p>
          </div>
          <div className="card">
            <div className="sp-list">
              <div className="sp-row head">
                <div>種</div>
                <div className="sp-stat">観測数</div>
                <div className="sp-stat">平均体長</div>
                <div className="sp-stat">平均体重</div>
                <div />
              </div>
              {list.length === 0 ? (
                <p className="civ-empty">まだ種が登録されていません。下のフォームから追加できます。</p>
              ) : (
                list.map((sp) => (
                  <div className="sp-row" key={sp.species_id}>
                    <div className="sp-name">
                      {sp.name ?? sp.species_id}
                      {sp.forked_from && <span className="fork-tag">🍴 ほかの種から派生</span>}
                    </div>
                    <div className="sp-stat">
                      {sp.stats.sample_count}
                      <span>件</span>
                    </div>
                    <div className="sp-stat">
                      {sp.stats.avg_size == null ? "—" : `${indNum(sp.stats.avg_size)}mm`}
                      <span>{sp.stats.avg_size == null ? "記録なし" : "自動計算"}</span>
                    </div>
                    <div className="sp-stat">
                      {sp.stats.avg_weight == null ? "—" : `${indNum(sp.stats.avg_weight)}g`}
                      <span>{sp.stats.avg_weight == null ? "記録なし" : "自動計算"}</span>
                    </div>
                    <div className="sp-open">›</div>
                  </div>
                ))
              )}
            </div>

            <div className="sp-add">
              <div className="add-t">＋ 種を追加する</div>
              <input
                className="add-field"
                type="text"
                placeholder="例: Dynastes hercules(学名か通称)"
                aria-label="種名"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
              />
              <div className="add-actions">
                <input
                  className="add-field"
                  type="text"
                  placeholder="派生元の種ID(あれば)"
                  aria-label="派生元の種ID"
                  value={forkedFrom}
                  onChange={(e) => setForkedFrom(e.target.value)}
                  style={{ maxWidth: "220px" }}
                />
                <button type="button" className="btn primary" onClick={submit} disabled={pending || !name.trim()}>
                  追加する
                </button>
              </div>
              {alias && (
                <div className="alias-hint">
                  ⚠ 似た名前が既にあります:「{alias.name}」。同じものなら統合を提案できます(統合は人の承認後のみ)。
                </div>
              )}
            </div>

            <p className="source-note">
              情報は <code>GET /species</code> の実データ(観測数・平均体長・平均体重は観測から都度再計算)。市場平均価格は、市場の出品と種のひもづけがまだ無いため出せません(後の波)。統合(alias)は必ず人の承認後だけ行います。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-species", IndSpeciesNode);
