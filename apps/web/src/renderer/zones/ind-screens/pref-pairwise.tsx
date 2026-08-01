"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet, indNum } from "./shared";

// ============ pairwise 好み入力(preference)============
// V3-UIX-22/23/79・uib02think §5-4 の責務5つ:
// 1) GET /match/pair を叩き round/target/左右2件をstateに持つ
// 2) 左右の写真を thumbnail_path から <img> で描く(IndMatchNode の絵文字プレース
//    ホルダ🪲の轍を踏まない — uib02think §5-4②の明示指示)
// 3) 3つの選択(左/右/どちらも×)+ キーボードハンドラ(←/→/↓・pairwise.md §規約)
// 4) 記録後に次ペアへ差し替え(POST /match/pair-choice)。失敗時は round が進まない
//    ため直後の再GETが同じペアを返し、既存のreduce規則(match-routes.tsの
//    「最後の書き込みが勝つ」)そのものがロールバック機構になる(新規機構を作らない・
//    uib02think §5-3「既存の reduce 規則がそのまま訂正機構になっている」の応用)
// 5) round === target で収束サマリに切り替え、GET /match/convergence を1回だけ叩く
type PrefPairItem = {
  item_id: string;
  species: string | null;
  feature_tags: string[];
  latest_size: number | null;
  thumbnail_path: string | null;
  photo_conditions: { temp_c?: number; humidity_pct?: number; captured_at: string } | null;
};
type PrefPairResponse = {
  pair_id: string;
  round: number;
  target: number;
  exhausted: boolean;
  left?: PrefPairItem;
  right?: PrefPairItem;
};

function PrefPhotoCaption({ pc }: { pc: PrefPairItem["photo_conditions"] }) {
  if (!pc) return null;
  const date = pc.captured_at ? pc.captured_at.slice(0, 10) : null;
  const parts = [date, pc.temp_c != null ? `${pc.temp_c}℃` : null].filter((v): v is string => !!v);
  if (parts.length === 0) return null;
  return <p className="pref-cap">撮影: {parts.join(" / ")}</p>;
}

function PrefCard({
  item,
  side,
  onChoose,
  disabled,
  refetching,
}: {
  item: PrefPairItem | undefined;
  side: "left" | "right";
  onChoose: () => void;
  disabled: boolean;
  refetching: boolean;
}) {
  if (!item) {
    return (
      <div className="swipe-card pref-card">
        <p className="civ-empty">個体が見つかりませんでした</p>
      </div>
    );
  }
  return (
    <div className={cn("swipe-card", "pref-card", refetching && "pref-skeleton")}>
      <div className={cn("swipe-photo", side === "left" ? "a" : "b")}>
        {item.thumbnail_path ? (
          <img className="pref-photo-img" src={item.thumbnail_path} alt={item.species ?? "個体の写真"} />
        ) : (
          <span className="pref-photo-empty">写真がまだありません</span>
        )}
      </div>
      <div className="swipe-body">
        <div className="swipe-name">{item.species ?? "この個体"}</div>
        <div className="swipe-traits">
          {item.latest_size != null && <span className="trait-chip">サイズ {indNum(item.latest_size)}</span>}
          {item.feature_tags.slice(0, 3).map((t) => (
            <span className="trait-chip" key={t}>
              {t}
            </span>
          ))}
        </div>
        <PrefPhotoCaption pc={item.photo_conditions} />
      </div>
      <button type="button" className="pref-pick-btn" disabled={disabled} onClick={onChoose}>
        {side === "left" ? "左" : "右"}
      </button>
    </div>
  );
}

function PrefConvergedView({ target }: { target: number }) {
  const conv = useIndGet<{ auc: number | null; converged: boolean; n_events: number }>("/api/v1/match/convergence");
  return (
    <div className="card pref-converged">
      <h3 className="section-title">好みの傾向(暫定)</h3>
      {conv ? (
        <p className="civ-empty">
          {conv.converged ? "好みが固まりました(目安を超えました)。" : "まだ学習中です(目安には未到達)。"}
          これまで{conv.n_events}回の選択から学習しました。回答ラウンド: {target}/{target} 完了。
        </p>
      ) : (
        <p className="civ-empty">集計中…</p>
      )}
      <div className="pref-converged-actions">
        <a className="btn ghost" href="/match">
          検索に反映(好みに近い順を見る)
        </a>
      </div>
    </div>
  );
}

function PrefPairwiseNode() {
  const execute = useContext(ExecuteCtx);
  const [data, setData] = useState<PrefPairResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // g80-uibatch4 T2: 初回取得は loading(カード未着=表示できるものが無い)、
  // 2回目以降(次ペア取得)は refetching(直前のカードを維持したままスケルトン化)。
  // これでE6実測の「次ペア取得中カード全消え」を解消する(順序=完了条件どおり)。
  const fetchPair = useCallback((isInitial: boolean) => {
    if (isInitial) setLoading(true);
    else setRefetching(true);
    Promise.resolve(execute({ kind: "api", method: "GET", path: "/api/v1/match/pair" }))
      .then((v) => setData((v as PrefPairResponse | undefined) ?? null))
      .catch(() => setData(null))
      .finally(() => {
        if (isInitial) setLoading(false);
        else setRefetching(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchPair(true);
  }, [fetchPair]);

  const converged = data != null && !data.exhausted && data.round >= data.target;
  const showingQuestion = data != null && !data.exhausted && !converged && !!data.left && !!data.right;

  const choose = useCallback(
    (choice: "left" | "right" | "neither") => {
      if (!data || !data.left || !data.right || submitting) return;
      setSubmitting(true);
      setErrorMsg(null);
      Promise.resolve(
        execute(
          { kind: "api", method: "POST", path: "/api/v1/match/pair-choice" },
          { pair_id: data.pair_id, left_item_id: data.left.item_id, right_item_id: data.right.item_id, choice },
        ),
      )
        .catch(() => setErrorMsg("記録に失敗しました。もう一度お試しください。"))
        .finally(() => {
          setSubmitting(false);
          fetchPair(false); // 成功=次ラウンドへ進む/失敗=同じラウンドが再取得され自然にロールバックする
        });
    },
    [data, submitting, execute, fetchPair],
  );

  useEffect(() => {
    if (!showingQuestion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") choose("left");
      else if (e.key === "ArrowRight") choose("right");
      else if (e.key === "ArrowDown") choose("neither");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showingQuestion, choose]);

  const SQUARES = 5;
  const filledSquares = data ? Math.min(SQUARES, Math.ceil((Math.min(data.round, data.target) / data.target) * SQUARES)) : 0;

  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          <div className="section-head">
            <span className="screen-tag">好み ・ 画面: 好み</span>
            <h1 className="section-title">好み — どちらが好き?</h1>
            <p className="section-why">
              <b>なぜここに来る?</b> 左右2匹を見くらべて好みを教えると、学習した好みに近い順で個体を探せるようになります。
            </p>
            {data && !data.exhausted && (
              <div className="pref-progress" aria-label={`収束度 ${Math.min(data.round, data.target)}/${data.target}`}>
                {Array.from({ length: SQUARES }, (_, i) => (
                  <span key={i} className={cn("pref-sq", i < filledSquares && "on")} />
                ))}
                <span className="pref-progress-num">
                  {Math.min(data.round, data.target)}/{data.target}
                </span>
              </div>
            )}
          </div>
          <div className="card">
            <p className="w2-mch-sample-note">実データのみ表示します(未接続・欠損データは正直に「未表示」とします)</p>

            {errorMsg && (
              <div className="pref-error" role="alert">
                {errorMsg}
              </div>
            )}

            {loading && <p className="civ-empty">読み込み中…</p>}

            {!loading && !refetching && data?.exhausted && (
              <p className="civ-empty">
                まだ評価できる個体がありません。観測を増やすと、好みくらべに使える個体が増えます。
              </p>
            )}

            {!loading && showingQuestion && data?.left && data?.right && (
              <>
                <div className="swipe-row pref-pair-row">
                  <PrefCard
                    item={data.left}
                    side="left"
                    onChoose={() => choose("left")}
                    disabled={submitting || refetching}
                    refetching={refetching}
                  />
                  <div className="swipe-vs">VS</div>
                  <PrefCard
                    item={data.right}
                    side="right"
                    onChoose={() => choose("right")}
                    disabled={submitting || refetching}
                    refetching={refetching}
                  />
                </div>
                <div className="pass-row">
                  <button
                    type="button"
                    className="pass-btn"
                    disabled={submitting || refetching}
                    onClick={() => choose("neither")}
                  >
                    どちらも ×
                  </button>
                </div>
              </>
            )}

            {!loading && converged && data && <PrefConvergedView target={data.target} />}

            <p className="source-note">
              情報は <code>GET /match/pair</code>(次の2個体)・<code>POST /match/pair-choice</code>(選択の記録)の実データです。
              キーボード: ←=左 / →=右 / ↓=どちらも×。撮影条件はスキーマに実在する撮影日・気温のみ表示します。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

registerNode("list:pref-pairwise", PrefPairwiseNode);
