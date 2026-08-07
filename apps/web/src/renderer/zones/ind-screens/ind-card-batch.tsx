"use client";

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { IndQr, indNum } from "./helpers";
import { BIO_CARD_BATCH_MAX_WEB } from "./card-batch-limits";

// ============ 個体カード一括出力(ind-card-batch)============
// R0802-a7205d の×20点(逐語「解釈が違います」)の是正。名刺の複製印刷(旧
// biocard-side の 100/500/1000 空ラベル先刷り)ではなく、登録済み個体を可変で
// 選び、それぞれ違うカードを1つのPDFにまとめて「切ってケースに貼る」用途。
// 設計正本: D:\claude\00-hq\kits\lane-think\R0807-d763a2-DESIGN-2026-08-07-biocard-batch.md

type IndRow = {
  individual_id: string;
  label: string;
  name: string | null;
  species: string | null;
  stage: string | null;
};

type ClutchRow = { clutch_id: string; container_label?: string };

type BatchCard = {
  individual_id: string;
  species: string | null;
  latest_size: number | null;
  qr_url: string;
  thumbnail_path: string | null;
  label_text: string | null;
  name: string | null;
};

type CellSize = "meishi" | "small" | "tiny";
type Variant = "compact" | "meishi";

const CELL_LABEL: Record<CellSize, string> = {
  meishi: "名刺 91×55mm",
  small: "小 50×25mm",
  tiny: "極小 30×30mm",
};

// 表示名の優先順位は既存 bio-card 画面(ind-bio-card.tsx)と同じ式(新しい規則を発明しない)。
function labelOf(card: BatchCard): string {
  return card.label_text || card.name || card.individual_id.slice(-6);
}

function IndCardBatchNode() {
  const execute = useContext(ExecuteCtx);

  const [tab, setTab] = useState<"pick" | "blank">("pick");

  const [q, setQ] = useState("");
  const [species, setSpecies] = useState("");
  const [stage, setStage] = useState("");
  const [rows, setRows] = useState<IndRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clutches, setClutches] = useState<ClutchRow[]>([]);
  const [clutchId, setClutchId] = useState("");
  const [clutchPending, setClutchPending] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [variant, setVariant] = useState<Variant>("compact");
  const [compactItems, setCompactItems] = useState({ id: true, species: false, size: false });
  const [cellSize, setCellSize] = useState<CellSize>("meishi");

  const [cards, setCards] = useState<BatchCard[] | null>(null);
  const [cardsPending, setCardsPending] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [selectCapNotice, setSelectCapNotice] = useState<string | null>(null);

  const [batchDone, setBatchDone] = useState<number | null>(null);
  const [batchPending, setBatchPending] = useState<number | null>(null);

  // 個体一覧: 既存 GET /individuals のクエリ(q/species/stage)をそのまま使う
  // (新しい検索を作らない)。15〜数百件規模を想定しページングは無い(現行仕様どおり)。
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadError(null);
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (species) params.set("species", species);
      if (stage) params.set("stage", stage);
      const qs = params.toString();
      try {
        const res = (await execute({
          kind: "api",
          method: "GET",
          path: `/api/v1/individuals${qs ? `?${qs}` : ""}`,
        })) as { individuals?: IndRow[] } | undefined;
        if (alive) setRows(res?.individuals ?? []);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [q, species, stage, execute]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = (await execute({ kind: "api", method: "GET", path: "/api/v1/clutches" })) as
          | { clutches?: ClutchRow[] }
          | undefined;
        if (alive) setClutches(res?.clutches ?? []);
      } catch {
        // best-effort: クラッチが1件も無くても個体選択自体は機能する
      }
    })();
    return () => {
      alive = false;
    };
  }, [execute]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 上限200件(BIO_CARD_BATCH_MAX)で打ち切る(2026-08-08 G-04-1是正)。表示中がそれ以内なら
  // 従来どおり全件を選択し、超える場合は表示中の先頭200件のみを選択してその旨を画面に出す。
  const selectAllVisible = useCallback(() => {
    const visible = rows ?? [];
    const capped = visible.length > BIO_CARD_BATCH_MAX_WEB;
    const toAdd = capped ? visible.slice(0, BIO_CARD_BATCH_MAX_WEB) : visible;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of toAdd) next.add(r.individual_id);
      return next;
    });
    setSelectCapNotice(
      capped
        ? `一度に作れるのは${BIO_CARD_BATCH_MAX_WEB}件までです(表示中の先頭${BIO_CARD_BATCH_MAX_WEB}件を選択しました)。`
        : null,
    );
  }, [rows]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // 割り出し(クラッチ)単位の一括選択 = GET /clutches/{id}/individuals(R3)。
  const addFromClutch = useCallback(
    async (id: string) => {
      setClutchId(id);
      if (!id) return;
      setClutchPending(true);
      try {
        const res = (await execute({
          kind: "api",
          method: "GET",
          path: `/api/v1/clutches/${id}/individuals`,
        })) as { individual_ids?: string[] } | undefined;
        setSelected((prev) => {
          const next = new Set(prev);
          for (const iid of res?.individual_ids ?? []) next.add(iid);
          return next;
        });
      } catch {
        // best-effort
      } finally {
        setClutchPending(false);
      }
    },
    [execute],
  );

  const buildPreview = useCallback(async () => {
    if (selected.size === 0) {
      setCards([]);
      return;
    }
    setCardsPending(true);
    setCardsError(null);
    try {
      const res = (await execute(
        { kind: "api", method: "POST", path: "/api/v1/individuals/bio-card-batch" },
        { individual_ids: [...selected] },
      )) as { cards?: BatchCard[]; missing?: string[]; error?: string; max?: number } | undefined;
      if (res?.error) {
        // サーバは生のエラーコード(例: "TOO_MANY")を返すため、利用者向けには日本語化する
        // (2026-08-08 G-04-1是正。生コードをそのまま画面に出さない)。
        setCardsError(
          res.error === "TOO_MANY"
            ? `選択が多すぎます。一度に作れるのは${res.max ?? BIO_CARD_BATCH_MAX_WEB}件までです。`
            : res.error,
        );
        setCards([]);
        return;
      }
      setCards(res?.cards ?? []);
      if (res?.missing && res.missing.length > 0) {
        setCardsError(`${res.missing.length}件は見つかりませんでした(削除済み等)。`);
      }
    } catch (e) {
      setCardsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCardsPending(false);
    }
  }, [execute, selected]);

  // 空ラベル先刷り(既存 POST /individuals/qr-batch をそのまま呼ぶ・拡張しない)。
  const issueBlankBatch = useCallback(
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

  const speciesValues = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.species).filter((v): v is string => !!v))).sort(),
    [rows],
  );
  const stageValues = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.stage).filter((v): v is string => !!v))),
    [rows],
  );

  const head = (
    <div className="section-head card-batch-controls">
      <span className="screen-tag">たどる ・ 画面: バイオカード一括出力</span>
      <h1 className="section-title">🗂️ 登録済み個体のカードをまとめて印刷</h1>
      <p className="section-why">
        <b>なぜここに来る?</b>{" "}
        複数の飼育個体を管理するため、それぞれ違うバイオカードを必要な分だけ選んで1つのPDFにまとめ、印刷して切ってケースに貼れます(名刺のように同じカードを複製するのとは違います)。
      </p>
    </div>
  );

  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}

          <div className="civ-segmented card-batch-controls" role="tablist" aria-label="カード一括出力のモード">
            <label className="civ-segment">
              <input type="radio" checked={tab === "pick"} onChange={() => setTab("pick")} />
              <span>登録済み個体から選ぶ</span>
            </label>
            <label className="civ-segment">
              <input type="radio" checked={tab === "blank"} onChange={() => setTab("blank")} />
              <span>空ラベル先刷り(100/500/1000)</span>
            </label>
          </div>

          {tab === "blank" ? (
            <div className="card card-batch-controls">
              <p className="civ-text">
                まだ個体が無い段階で、空のQRラベルだけ先に発行できます(後で初回スキャンで個体に束縛されます)。
              </p>
              <div className="batch-opts">
                {[100, 500, 1000].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={"batch-opt" + (batchDone === n ? " chosen" : "")}
                    onClick={() => issueBlankBatch(n)}
                    disabled={batchPending != null}
                  >
                    {n}枚
                  </button>
                ))}
              </div>
              {batchDone != null && <div className="batch-done">{batchDone}枚分のQRラベルを発行しました。</div>}
            </div>
          ) : (
            <>
              <div className="card card-batch-controls">
                <div className="civ-filter-row">
                  <input
                    className="civ-input"
                    placeholder="キーワード(名前・種など)"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <select className="civ-input" value={species} onChange={(e) => setSpecies(e.target.value)}>
                    <option value="">種: すべて</option>
                    {speciesValues.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select className="civ-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">ステージ: すべて</option>
                    {stageValues.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
                    className="civ-input"
                    value={clutchId}
                    onChange={(e) => addFromClutch(e.target.value)}
                    disabled={clutchPending}
                  >
                    <option value="">割り出し(クラッチ)から追加選択…</option>
                    {clutches.map((c) => (
                      <option key={c.clutch_id} value={c.clutch_id}>
                        {c.container_label || c.clutch_id}
                      </option>
                    ))}
                  </select>
                </div>

                {loadError && <p className="civ-empty">読み込みエラー: {loadError}</p>}
                {rows == null ? (
                  <p className="civ-empty">読み込み中…</p>
                ) : rows.length === 0 ? (
                  <p className="civ-empty">条件に一致する個体がいません。</p>
                ) : (
                  <>
                    <div className="civ-row-actions">
                      <button type="button" className="civ-button" data-variant="ghost" onClick={selectAllVisible}>
                        表示中を全選択({rows.length}件)
                      </button>
                      <button type="button" className="civ-button" data-variant="ghost" onClick={clearSelection}>
                        選択解除
                      </button>
                      <span className="civ-text" data-muted="true">
                        選択中 {selected.size}件 / 表示 {rows.length}件
                      </span>
                    </div>
                    {selectCapNotice && <p className="civ-empty">{selectCapNotice}</p>}
                    <ul className="civ-check-list">
                      {rows.map((r) => (
                        <li key={r.individual_id} className="civ-check-row">
                          <label>
                            <input
                              type="checkbox"
                              checked={selected.has(r.individual_id)}
                              onChange={() => toggleSelect(r.individual_id)}
                            />
                            <span className="ccr-name">{r.label || r.name || r.species || r.individual_id}</span>
                            <span className="civ-text" data-muted="true">
                              {[r.species, r.stage].filter(Boolean).join(" / ")}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="card card-batch-controls">
                <div className="civ-segmented" role="radiogroup" aria-label="様式">
                  <label className="civ-segment">
                    <input type="radio" checked={variant === "compact"} onChange={() => setVariant("compact")} />
                    <span>省スペース版(QR+管理番号)</span>
                  </label>
                  <label className="civ-segment">
                    <input type="radio" checked={variant === "meishi"} onChange={() => setVariant("meishi")} />
                    <span>名刺型(フル情報)</span>
                  </label>
                </div>
                {variant === "compact" && (
                  <div className="civ-filter-row">
                    <label>
                      <input
                        type="checkbox"
                        checked={compactItems.id}
                        onChange={(e) => setCompactItems((v) => ({ ...v, id: e.target.checked }))}
                      />{" "}
                      管理番号
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={compactItems.species}
                        onChange={(e) => setCompactItems((v) => ({ ...v, species: e.target.checked }))}
                      />{" "}
                      種
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={compactItems.size}
                        onChange={(e) => setCompactItems((v) => ({ ...v, size: e.target.checked }))}
                      />{" "}
                      最新計測
                    </label>
                  </div>
                )}
                <div className="civ-filter-row">
                  <label>
                    1枚あたりの大きさ:{" "}
                    <select className="civ-input" value={cellSize} onChange={(e) => setCellSize(e.target.value as CellSize)}>
                      {(Object.keys(CELL_LABEL) as CellSize[]).map((k) => (
                        <option key={k} value={k}>
                          {CELL_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {cellSize === "tiny" && (
                  <p className="civ-text" data-muted="true">
                    ※この大きさだとQRコードが読み取れない場合があります。
                  </p>
                )}
                <p className="civ-text" data-muted="true">
                  ※「王_2026_001」形式の自動連番はまだありません。ここに出るのは個体登録時に付けた名前です。
                </p>
              </div>

              <div className="card card-batch-controls">
                <button
                  type="button"
                  className="civ-button"
                  data-variant="primary"
                  onClick={buildPreview}
                  disabled={selected.size === 0 || cardsPending}
                >
                  {cardsPending ? "読み込み中…" : `選択中の${selected.size}件でプレビューを作る`}
                </button>
                {cardsError && <p className="civ-empty">{cardsError}</p>}
              </div>

              {cards && cards.length > 0 && (
                <div className="card">
                  <p className="civ-text card-batch-controls">
                    印刷ダイアログで「PDFに保存」を選ぶとPDFになります。「実際のサイズ(100%)」を選んでください
                    ——「ページに合わせて縮小」だと寸法がずれます。等倍の位置合わせは自動化していません(人の目で確認してください)。
                  </p>
                  <button
                    type="button"
                    className="civ-button card-batch-controls"
                    data-variant="primary"
                    onClick={() => window.print()}
                  >
                    印刷 / PDFで保存
                  </button>
                  <div className={`card-batch-sheet cell-${cellSize}`}>
                    {cards.map((c) => (
                      <div key={c.individual_id} className="card-batch-cell">
                        {variant === "meishi" ? (
                          <div className="meishi">
                            <div className="meishi-top">
                              <div className="meishi-photo">
                                {c.thumbnail_path ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={c.thumbnail_path} alt="" />
                                ) : (
                                  "🪲"
                                )}
                              </div>
                              <div className="meishi-headmeta">
                                <div className="meishi-name">{labelOf(c)}</div>
                                {c.species && <div className="meishi-sp">{c.species}</div>}
                              </div>
                              <IndQr value={c.qr_url} className="meishi-qr" />
                            </div>
                            <div className="meishi-body">
                              <div className="meishi-field">
                                <span className="mf-k">最新サイズ</span>
                                <span className="mf-v">{c.latest_size == null ? "記録なし" : indNum(c.latest_size)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="card-batch-compact">
                            <IndQr value={c.qr_url} className="cbc-qr" />
                            {compactItems.id && <div className="cbc-id">{labelOf(c)}</div>}
                            {compactItems.species && c.species && <div className="cbc-sp">{c.species}</div>}
                            {compactItems.size && c.latest_size != null && <div className="cbc-size">{indNum(c.latest_size)}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

registerNode("list:ind-card-batch", IndCardBatchNode);
