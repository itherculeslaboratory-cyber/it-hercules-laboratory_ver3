"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/cn";
import { ScopeCtx, ExecuteCtx } from "../core/context";
import { formatDateJa } from "../core/scope";
import { registerNode } from "../core/registry";

// ─────────────────────────────────────────────────────────────────────────────
// Z9(g85-split2a) — このファイルは renderer.tsx の以下の範囲を「1文字も改変せず」
// 抜き出したもの(renderer.tsx 側はまだ何も削除していない=Phase 2b で削除)。
// 実測範囲(2026-08-02時点のワーキングツリー): renderer.tsx L8630-L10021
//   L8630 banner「個体・種(IND)ゾーン 5画面」〜 L10021 IndBioCardNode() 終端。
// 登録キー: list:ind-detail / ind-match / pref-pairwise / ind-species / ind-cross / ind-bio-card
// ─────────────────────────────────────────────────────────────────────────────

// ★判断メモ(このファイルの下部・「Z9が自己完結するための重複」節にまとめて記載):
// IndDetailNode/IndGrowthChart は renderer.tsx 上で Z3(zones/ind-profile.tsx 予定,
// L5012〜)の型/関数(IndividualProfile・PedNode・profileLabel・seriesFor 等)を
// 直接参照している。ORDER の import 制限(core/context・core/scope・core/registry
// のみ)により Z3 ファイルを import できないため、Phase 2a(まだ renderer.tsx から
// 何も削除していないスナップショット段階)の間だけ、この下部節で該当の型/関数を
// 「元の記述と1文字も変えずに」複製している。Phase 2b のカットオーバー(重複の
// 解消・どちらか一方の定義に一本化)は考える役の設計判断であり本艦では行わない。

// 1画面 = 1 GET を購読する軽量フック(HomeDashboardNode の useEffect 直配線を1つに
// まとめただけ・常駐キャッシュ無し=不変条項①)。path が null の間は取得しない。
function useIndGet<T>(path: string | null): T | null {
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
function IndQr({ value, className }: { value: string; className?: string }) {
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

const indPct = (r: number | null | undefined): string => (r == null ? "—" : `${Math.round(r * 100)}%`);
const indNum = (n: number | null | undefined): string =>
  n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1);

// 令コード → 表示語(内部語を画面に出さない・語彙辞書方針①)。未知コードは実値を
// そのまま出す(誇張ゼロ: 勝手に翻訳して意味を変えない)。
const IND_STAGE_JA: Record<string, string> = {
  egg: "卵",
  first: "1令",
  L1: "1令",
  second: "2令",
  L2: "2令",
  third: "3令",
  L3: "3令",
  third_early: "3令 前期",
  third_late: "3令 後期",
  pupa: "蛹",
  adult: "成虫",
};
function indStageLabel(stage: string): string {
  return IND_STAGE_JA[stage] ?? stage;
}

function indLifeEventLabel(e: ProfileLifeEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "birth":
      return "誕生(孵化)";
    case "molt":
      return d.to_stage ? `脱皮 → ${indStageLabel(String(d.to_stage))}` : "脱皮";
    case "eclosion":
      return d.success === false ? "羽化(不全)" : "羽化";
    case "death":
      return "死亡";
    case "specimen":
      return "標本にした";
    case "move":
      return "置き場所を移動";
    case "survival_correction":
      return "生存の訂正";
    default:
      return e.kind;
  }
}

// 環境時系列 → metric ごとの最新バケットの平均値(V3-IND-13)。mockup の温度/湿度
// タイル用。単位は metric 名から決める(未知 metric は単位なしで実値のみ)。
function indLatestEnv(readings: EnvReading[] | undefined): { metric: string; label: string; unit: string; value: number; device_id: string }[] {
  if (!readings || readings.length === 0) return [];
  const latest = new Map<string, EnvReading>();
  for (const r of readings) {
    const prev = latest.get(r.metric);
    if (!prev || r.bucket_start_ms > prev.bucket_start_ms) latest.set(r.metric, r);
  }
  const META: Record<string, { label: string; unit: string }> = {
    temperature: { label: "温度(直近の平均)", unit: "℃" },
    humidity: { label: "湿度(直近の平均)", unit: "%" },
  };
  return [...latest.values()].map((r) => ({
    metric: r.metric,
    label: META[r.metric]?.label ?? `${r.metric}(直近の平均)`,
    unit: META[r.metric]?.unit ?? "",
    value: r.mean,
    device_id: r.device_id,
  }));
}

type EnvReading = { device_id: string; metric: string; bucket_start_ms: number; mean: number; count: number };
type IndAuthenticity = {
  continuity_score: number;
  image_chain: { photos: number; with_sha256: number; intact: boolean };
  growth_monotonic: boolean;
  registration: { registered_events: number; evidenced_observations: number; consistent: boolean };
  lineage_conflicts: { type: string; detail?: string }[];
  doubts: unknown[];
};
type IndProfileFull = IndividualProfile & { environment?: EnvReading[] };

// ============ 3. 個体の詳細(individual-detail)= 中心画面 ============
// 構造要約(c8 UI磨きR0801-9d452f-ui13rendererdoc・screen-defs/individual-detail.json
// はnode {type:"individual-profile"} 1個のみでこのコンポーネントに委譲。動作影響なし):
//   ヘッダ(名前/種/ステージ/状態badge・死亡記録/誤記録訂正)+血統健全度・
//   近交リスクチップ+血縁レール(親/子/きょうだいchip・タップで対象個体を差替)+
//   変化点タイムライン(観測+life-eventsマージ・Δ計算・値の訂正)+今の置き場所の
//   環境センサー値+sticky下端の次の一手バー。GET /individuals/{id}/profile +
//   /pedigree を自前取得(GrowthChartNodeと合わせ2重取得=素朴な縮退・既知)。
function IndDetailNode() {
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const id = String(scope.params.id ?? "");
  const [reloadKey, setReloadKey] = useState(0);
  const suffix = reloadKey ? `?_r=${reloadKey}` : "";
  const profile = useIndGet<IndProfileFull>(id ? `/api/v1/individuals/${id}/profile${suffix}` : null);
  const pedigree = useIndGet<PedNode>(id ? `/api/v1/individuals/${id}/pedigree${suffix}` : null);
  const auth = useIndGet<IndAuthenticity>(id ? `/api/v1/individuals/${id}/authenticity${suffix}` : null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrPending, setQrPending] = useState(false);
  const [showAllObs, setShowAllObs] = useState(false);

  const issueQr = useCallback(async () => {
    if (!id) return;
    setQrPending(true);
    try {
      const r = (await execute({ kind: "api", method: "POST", path: `/api/v1/individuals/${id}/qr` })) as
        | { token?: string }
        | undefined;
      if (r?.token) setQrToken(String(r.token));
    } catch {
      // best-effort: 失敗しても画面は壊さない(ボタンは再度押せる)
    } finally {
      setQrPending(false);
    }
  }, [execute, id]);

  const head = (
    <div className="section-head">
      <span className="screen-tag">たどる ・ 画面: 個体の詳細</span>
      <h1 className="section-title">🪲 この子の「今」と「物語」を1画面で</h1>
      <p className="section-why">
        <b>なぜここに来る?</b> 「この子は順調?」「血統は確か?」「近い血どうしのかけ合わせになっていない?」を、開いた瞬間に判断したい時。
      </p>
    </div>
  );

  if (!id) {
    return (
      <div className="ind-zone">
        <div className="wrap">
          <section className="block">
            {head}
            <div className="card">
              <p className="civ-empty">個体を選ぶと、その子の詳細を表示します(個体を探す・観測から開きます)。</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ── 判断3指標(すべて実データ) ──
  const ownWeights = profile ? seriesFor(profile.observations, "weight", false) : [];
  const growth =
    ownWeights.length < 2
      ? { v: "記録が少なめ", sub: "体重の記録が2回以上たまると、増減を判定できます。", warn: false }
      : auth == null
        ? { v: "確認中", sub: "成長のぐあいを計算しています。", warn: false }
        : auth.growth_monotonic
          ? { v: "順調に増加中", sub: "体重が下がらずに伸びています。", warn: false }
          : { v: "増減あり", sub: "体重が一度下がった記録があります(脱皮の前後など)。", warn: true };

  const score = auth?.continuity_score ?? null;
  const dotsOn = score == null ? 0 : Math.round(score * 4);
  const contWord = score == null ? "—" : score >= 0.75 ? "高い" : score >= 0.5 ? "ふつう" : "低め";
  const conflicts = auth?.lineage_conflicts.length ?? 0;
  const doubts = auth?.doubts.length ?? 0;
  const contSub =
    auth == null
      ? "写真の連なりと観測の裏付けから自動で確かめます。"
      : `${auth.image_chain.intact ? "写真の連なりの裏付けあり。" : "写真の連なりは一部のみ。"}矛盾${conflicts}件・疑義${doubts}件。`;

  const fCoef = inbreedingCoefficient(pedigree ?? null);
  const fTone = fCoef != null ? inbreedingTone(fCoef) : null;
  const inbWord = fTone == null ? "計算できません" : fTone.word === "低" ? "低い" : fTone.word === "中" ? "中くらい" : "高め";
  const inbSub =
    fTone == null
      ? "両親の情報がそろうと、近さ(近交)を自動で計算します。"
      : "血統図から自動計算(数値が高いほど近い血どうし)。かけ合わせの参考に。";

  const sire = profile?.parents.sire;
  const dam = profile?.parents.dam;
  const siblings = profile?.siblings ?? [];
  const children = profile?.children ?? [];
  const envTiles = indLatestEnv(profile?.environment);
  const nextObs = profile?.schedule?.next_observation_at;

  // ── これまでの記録(観測) — E3ENTRY-1(○95)。取得済みの profile.observations を
  // 新しい順に描く。buildTimeline/prevValueFn/measureValue は既存の再利用
  // (JSXは再利用しない — TimelineRow は civ-* 系デザイン、この画面は ind-* 系のため)。
  const obsHistory = profile
    ? buildTimeline(profile)
        .filter((e): e is Extract<TimelineEntry, { kind: "capture" }> => e.kind === "capture")
        .reverse()
    : [];
  const prevObsValue = profile ? prevValueFn(profile.observations) : () => null;
  const visibleObs = showAllObs ? obsHistory : obsHistory.slice(0, 5);

  return (
    <div className="ind-zone">
      <div className="wrap">
        <section className="block">
          {head}
          <div className="card">
            {!profile ? (
              <p className="civ-empty">読み込み中…</p>
            ) : (
              <>
                {/* header */}
                <div className="id-head">
                  <div className="id-photo">
                    {profile.thumbnail_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.thumbnail_path} alt="" />
                    ) : (
                      "🪲"
                    )}
                  </div>
                  <div className="id-headmeta">
                    <div className="id-name">{profileLabel(profile)}</div>
                    <div className="id-sub">{profile.species ?? "種は未登録"}</div>
                    <div className="id-statuschips">
                      <span className={cn("st-chip", profile.status === "deceased" ? "deceased" : "alive")}>
                        {profile.status === "deceased" ? "● 亡くなりました" : "● 生きています"}
                      </span>
                      {profile.stage && <span className="st-chip stage">{indStageLabel(profile.stage)}(直近の脱皮から)</span>}
                      {profile.placement_id && <span className="st-chip place">置き場所: {profile.placement_id}</span>}
                    </div>
                  </div>
                </div>

                {/* 3 judgment indicators */}
                <div className="judge-row">
                  <div className={cn("judge", growth.warn && "warn")}>
                    <div className="j-k">成長のぐあい</div>
                    <div className="j-v">{growth.v}</div>
                    <div className="j-sub">{growth.sub}</div>
                  </div>
                  <div className="judge">
                    <div className="j-k">血統の確かさ</div>
                    <div className="j-v">
                      {contWord}
                      <span className="dots">
                        {[0, 1, 2, 3].map((i) => (
                          <span key={i} className={cn("dot", i < dotsOn && "on")} />
                        ))}
                      </span>
                    </div>
                    <div className="j-sub">{contSub}</div>
                  </div>
                  <div className={cn("judge", fTone && fTone.word !== "低" && "warn")}>
                    <div className="j-k">近い血の度合い(近交)</div>
                    <div className="j-v">{inbWord}</div>
                    <div className="j-sub">{inbSub}</div>
                  </div>
                </div>

                {/* pedigree rail */}
                <div className="subhead">血縁レール(親 → 自分 → 子)</div>
                <div className="ped-rail">
                  <div className="ped-tier">
                    <span className="tier-k">親</span>
                    {sire ? (
                      <a className="ped-node" href={`/s/individual-detail?id=${sire.individual_id}`}>
                        ♂ {sire.label} <span className="mark ok">✓</span>
                      </a>
                    ) : (
                      <span className="ped-node missing">♂ 父 わかりません</span>
                    )}
                    {dam ? (
                      <a className="ped-node" href={`/s/individual-detail?id=${dam.individual_id}`}>
                        ♀ {dam.label} <span className="mark ok">✓</span>
                      </a>
                    ) : (
                      <span className="ped-node missing">♀ 母 わかりません</span>
                    )}
                  </div>
                  <div className="ped-tier">
                    <span className="tier-k">自分</span>
                    <span className="ped-node self">🪲 {profileLabel(profile)}</span>
                  </div>
                  <div className="ped-tier">
                    <span className="tier-k">きょうだい</span>
                    {siblings.length === 0 ? (
                      <span className="ped-node missing">まだ確認できません</span>
                    ) : (
                      siblings.map((s) => (
                        <a key={s.individual_id} className="ped-node" href={`/s/individual-detail?id=${s.individual_id}`}>
                          {s.label}
                          {s.dead ? (
                            <span className="mark dead">✝ 死亡</span>
                          ) : s.eclosed ? (
                            <span className="mark ok">羽化</span>
                          ) : null}
                        </a>
                      ))
                    )}
                  </div>
                  <div className="ped-tier">
                    <span className="tier-k">子</span>
                    {children.length === 0 ? (
                      <span className="ped-node missing">まだいません</span>
                    ) : (
                      children.map((c) => (
                        <a key={c.individual_id} className="ped-node" href={`/s/individual-detail?id=${c.individual_id}`}>
                          {c.label}
                        </a>
                      ))
                    )}
                  </div>
                </div>
                {(!sire || !dam) && (
                  <div className="ped-missing-form">
                    ⓘ 親の情報が未登録です(買った個体によくあります)。わかれば後で足せます。空欄のままでも大丈夫、これは正常な状態として扱います。
                  </div>
                )}

                {/* growth chart */}
                <div className="subhead">成長の記録(体重の変化)</div>
                <IndGrowthChart profile={profile} />

                {/* observation history (E3ENTRY-1) */}
                <div className="subhead">これまでの記録(観測)</div>
                {obsHistory.length === 0 ? (
                  <p className="civ-empty">まだ観測の記録がありません。</p>
                ) : (
                  <>
                    <ul className="obs-hist-list">
                      {visibleObs.map((entry) => {
                        const cap = entry.capture;
                        const ms = (cap.measurements ?? [])
                          .map((m) => ({ ...m, value: typeof m.value === "number" ? m.value : Number(m.value) }))
                          .filter((m): m is ProfileMeasurement & { value: number } => Number.isFinite(m.value));
                        return (
                          <li className="obs-hist-row" key={cap.capture_id}>
                            <div className="obs-hist-thumb">
                              {cap.thumbnail_path ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={cap.thumbnail_path} alt="" />
                              ) : (
                                <span aria-hidden="true">📏</span>
                              )}
                            </div>
                            <div className="obs-hist-body">
                              <span className="obs-hist-date">{formatDateJa(entry.atIso)}</span>
                              {ms.length === 0 ? (
                                <span className="obs-hist-vals" data-muted="true">
                                  計測値なし
                                </span>
                              ) : (
                                <span className="obs-hist-vals">
                                  {ms.map((m, i) => {
                                    const prev = prevObsValue(cap.capture_id, m.item);
                                    const delta = prev != null ? m.value - prev : null;
                                    const sign = delta != null ? (delta > 0 ? "+" : delta < 0 ? "" : "±") : "";
                                    return (
                                      <span key={i}>
                                        {m.value}
                                        {m.unit ?? ""}
                                        {delta != null ? ` (${sign}${delta.toFixed(1)}${m.unit ?? ""})` : ""}
                                        {i < ms.length - 1 ? "・" : ""}
                                      </span>
                                    );
                                  })}
                                </span>
                              )}
                            </div>
                            <a className="obs-hist-link" href={`/s/obs-detail?id=${cap.capture_id}`}>
                              くわしく →
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                    {obsHistory.length > 5 && (
                      <button
                        type="button"
                        className="obs-hist-more"
                        onClick={() => setShowAllObs((v) => !v)}
                      >
                        {showAllObs ? "閉じる" : `すべて見る(全${obsHistory.length}件)`}
                      </button>
                    )}
                  </>
                )}

                {/* timeline */}
                <div className="subhead">変わり目のできごと</div>
                {profile.life_events.length === 0 ? (
                  <p className="civ-empty">まだ記録されたできごとはありません。</p>
                ) : (
                  <div className="timeline">
                    {profile.life_events.map((e, i) => (
                      <div key={i} className={cn("tl-item", e.kind === "death" && "death")}>
                        <div className="tl-dot-col">
                          <div className="tl-dot" />
                          {i < profile.life_events.length - 1 && <div className="tl-line" />}
                        </div>
                        <div className="tl-content">
                          <span className="tl-date">{formatDateJa(e.at)}</span>
                          {indLifeEventLabel(e)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* environment */}
                <div className="subhead">今の置き場所の環境(センサーがあれば)</div>
                {envTiles.length === 0 ? (
                  <p className="civ-empty">この置き場所には、つながっているセンサーがまだありません。</p>
                ) : (
                  <div className="env-row">
                    {envTiles.map((t) => (
                      <div className="env-tile" key={t.metric}>
                        <div className="e-num">
                          {indNum(t.value)}
                          {t.unit}
                        </div>
                        <div className="e-label">{t.label}</div>
                        <div className="e-src">{t.device_id} から</div>
                      </div>
                    ))}
                  </div>
                )}

                {nextObs && (
                  <div className="due-note">
                    🗓 次の観測の目安: {formatDateJa(nextObs)} ごろ。<span>※目安です。赤字や催促はしません。</span>
                  </div>
                )}

                {/* action bar (mockup: 画面下端に固定される操作) */}
                <div className="sticky-demo">
                  <span className="sd-label">この子への操作</span>
                  <a className="btn primary" href={`/s/obs-register-entry?id=${id}`}>
                    ＋ 記録を追加
                  </a>
                  <a className="btn ghost" href="/s/obs-register-batch">
                    まとめて記録
                  </a>
                  <button type="button" className="btn blue" onClick={issueQr} disabled={qrPending}>
                    QRラベルを発行
                  </button>
                </div>
                {qrToken && (
                  <div className="qr-inline">
                    <IndQr value={qrToken} />
                    <span className="civ-empty">このラベルを読み取ると、この個体のページが開きます。</span>
                  </div>
                )}

                <p className="source-note">
                  この画面の情報は <code>GET /individuals/{"{id}"}/profile</code>・<code>/pedigree</code>・<code>/authenticity</code> の実データです。
                  親のカーブが無い個体(買った個体)は空のまま表示します(エラーにしません)。次の観測日は「目安」であり予定ではありません。
                  近さ(近交)は血統図から自動計算します。
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// 成長グラフ(mockup .growth-wrap の verbatim・実データ配線)。本個体=実線、
// 親カーブ(♂優先・あれば)=破線、きょうだいの範囲=帯。データ helper は既存
// GrowthChartView と同一(seriesFor/isDegenerate)を再利用。でっち上げの標準帯は
// 描かない(誇張ゼロ)。
function IndGrowthChart({ profile }: { profile: IndividualProfile }) {
  const degenerate = isDegenerate([profile.observations, profile.parent_observations.sire, profile.parent_observations.dam]);
  const own = seriesFor(profile.observations, "weight", degenerate);
  const sireS = seriesFor(profile.parent_observations.sire, "weight", degenerate);
  const damS = seriesFor(profile.parent_observations.dam, "weight", degenerate);
  const parent = sireS.length ? sireS : damS;
  const cohortValues = profile.cohort_observations.map((o) => o.weight_g).filter((v): v is number => v != null);
  const cohortBand: [number, number] | null =
    cohortValues.length >= 3 ? [Math.min(...cohortValues), Math.max(...cohortValues)] : null;

  if (own.length < 2) {
    return (
      <div className="growth-wrap">
        <p className="civ-empty">
          {own.length === 0
            ? "まだ体重の記録がありません。観測を記録すると、ここにカーブが描かれます。"
            : "体重の記録が1回あります。2回目からカーブになります。"}
        </p>
      </div>
    );
  }

  const W = 600;
  const H = 180;
  const PAD_L = 40;
  const PAD_R = 60;
  const PAD_T = 12;
  const PAD_B = 16;
  const pts = [...own, ...parent];
  const maxX = Math.max(1, ...pts.map((p) => p.x));
  const allY = pts.map((p) => p.y).concat(cohortBand ?? []);
  const rawMin = Math.min(...allY);
  const rawMax = Math.max(...allY);
  const yPad = (rawMax - rawMin) * 0.08 || Math.max(1, rawMax * 0.1);
  const yMin = rawMin - yPad;
  const yMax = rawMax + yPad;
  const px = (x: number) => PAD_L + (x / maxX) * (W - PAD_L - PAD_R);
  const py = (y: number) => H - PAD_B - ((y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const ptsStr = (ps: { x: number; y: number }[]) => ps.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");

  return (
    <div className="growth-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="170" preserveAspectRatio="none" role="img" aria-label="体重の折れ線グラフ">
        {cohortBand && (
          <rect
            x={PAD_L}
            y={py(cohortBand[1])}
            width={W - PAD_L - PAD_R}
            height={Math.max(1, py(cohortBand[0]) - py(cohortBand[1]))}
            fill="var(--blue-bg)"
          />
        )}
        {parent.length > 0 && (
          <polyline points={ptsStr(parent)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 5" />
        )}
        <polyline points={ptsStr(own)} fill="none" stroke="var(--primary)" strokeWidth="3" />
        {own.map((p, i) => (
          <circle key={i} cx={px(p.x)} cy={py(p.y)} r={4} fill="var(--primary)" />
        ))}
      </svg>
      <div className="growth-legend">
        <span>
          <span className="lg-swatch" style={{ background: "var(--primary)" }} /> この子
        </span>
        {parent.length > 0 && (
          <span>
            <span className="lg-swatch" style={{ background: "var(--muted)" }} /> 親のカーブ
          </span>
        )}
        {cohortBand && (
          <span>
            <span className="lg-swatch" style={{ background: "var(--blue-bg)", height: "10px", border: "1px solid var(--blue)" }} /> きょうだいの範囲
          </span>
        )}
      </div>
    </div>
  );
}

// ============ 1. マッチング(match)= 好み学習型(気晴らし・寄り道の探索) ============
// fidelity-A5#8: 婚活的な相手探しではなく個体・好み学習に限定。実データ配線:
// GET /match/convergence(好みの固まり具合=auc/converged/n_events)+ GET /match/ranking
// (内積降順の item_id・点数は非公開)。候補は各 bio-card で実フィールド(種/特徴タグ/
// 最新サイズ)に肉付けする。★正直な限界: 左右選択で好みを「教える」往復は、順位API
// が特徴ベクトル(features)を伏せる設計(点数を出さない)のため、この画面からは学習の
// 書き込みまではつなげない。カードは個体詳細への実導線にし、順位=学習済みの
// 「好みに近い順」を正直に見せる(学習自体は観測時に行われる)。
type IndBioCard = {
  individual_id: string;
  species: string | null;
  morph: string | null;
  latest_size: number | null;
  feature_tags: string[];
  qr_url: string;
  thumbnail_path: string | null;
  photo_conditions: { temp_c?: number; humidity_pct?: number; captured_at: string } | null;
};
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

// ═════════════════════════════════════════════════════════════════════════════
// Z9が自己完結するための重複(★判断が要った箇所・報告書に詳細記載)
//
// 下記の型/関数は renderer.tsx 上では Z3(zones/ind-profile.tsx 予定・
// growth-chart/individual-profile。実測でL5012付近から)の側に定義されており、
// Z9(このファイル)の IndDetailNode / IndGrowthChart から直接参照されている。
// ORDER の共通ルール3(import は ../core/context・../core/scope・../core/registry
// のみ)により Z3 側の未作成ファイルを import できないため、Phase 2a の間だけ
// renderer.tsx の元記述を1文字も変えずにこの節へ複製した。renderer.tsx 自体は
// まだ何も削除していない(共通ルール1・4)。Phase 2b のカットオーバーでこの重複を
// 解消する設計判断は本艦の範囲外(考える役)。
// ═════════════════════════════════════════════════════════════════════════════

// renderer.tsx L5020-L5056 verbatim(型定義)
type ProfileMeasurement = { item: string; kind: string; value: number | string; unit?: string };
type ProfileCapture = {
  capture_id: string;
  time: string;
  measurements?: ProfileMeasurement[];
  photo_id?: string | null;
  thumbnail_path?: string | null;
};
type ProfileLifeEvent = { individual_id: string; kind: string; at: string; detail?: Record<string, unknown> };
type ProfileParentRef = { individual_id: string; label: string };
type ProfileSibling = ProfileParentRef & { dead: boolean; eclosed: boolean };
type IndividualProfile = {
  individual_id: string;
  master: { local_label_text?: string; species?: string } | null;
  name: string | null;
  species: string | null;
  stage: string | null;
  status: "alive" | "deceased";
  thumbnail_path: string | null;
  placement_id: string | null;
  schedule: { next_observation_at: string } | null;
  parents: { sire?: ProfileParentRef; dam?: ProfileParentRef };
  siblings: ProfileSibling[];
  children: ProfileParentRef[];
  observations: ProfileCapture[];
  life_events: ProfileLifeEvent[];
  parent_observations: { sire: ProfileCapture[]; dam: ProfileCapture[] };
  cohort_observations: { individual_id: string; capture_id: string; weight_g: number | null; length_mm: number | null }[];
};
type PedNode = {
  individual_id: string;
  known: boolean;
  parent_role?: string;
  circular?: boolean;
  truncated?: boolean;
  parents: PedNode[];
};

// renderer.tsx L2064-L2067 verbatim
const ULID_RE = /^[0-9A-Za-z]{26}$/;
function safeLabel(label: string, species: string | null): string {
  return ULID_RE.test(label) ? species || "無名個体" : label;
}

// renderer.tsx L5058-L5102 の関数本体は不変(説明コメントのみ、要旨をこの節冒頭の
// 判断メモに畳んだため個々には再掲していない)
function profileLabel(profile: IndividualProfile): string {
  const raw = profile.master?.local_label_text || profile.name || profile.individual_id;
  return safeLabel(raw, profile.species);
}

function measureValue(cap: ProfileCapture, item: string): number | null {
  const m = (cap.measurements ?? []).find((mm) => mm.item === item);
  if (!m) return null;
  const n = typeof m.value === "number" ? m.value : Number(m.value);
  return Number.isFinite(n) ? n : null;
}

function seriesFor(
  caps: ProfileCapture[],
  item: string,
  degenerate: boolean,
): { x: number; y: number; iso: string }[] {
  const pts = caps
    .map((c) => ({ t: Date.parse(c.time), y: measureValue(c, item), iso: c.time }))
    .filter((pt): pt is { t: number; y: number; iso: string } => Number.isFinite(pt.t) && pt.y != null)
    .sort((a, b) => a.t - b.t);
  if (pts.length === 0) return [];
  const t0 = pts[0].t;
  return pts.map((pt, i) => ({ x: degenerate ? i : (pt.t - t0) / 86_400_000, y: pt.y, iso: pt.iso }));
}

function isDegenerate(seriesCaps: ProfileCapture[][]): boolean {
  const ts = seriesCaps.flat().map((c) => Date.parse(c.time)).filter((t) => Number.isFinite(t));
  return ts.length > 1 && Math.max(...ts) - Math.min(...ts) < 60_000;
}

// renderer.tsx L5376-L5403 の関数本体は不変(inbreedingTone直前の説明コメントは
// 判断メモに要旨を畳んだため再掲していない)
function collectAncestors(node: PedNode | undefined, depth: number, out: { id: string; depth: number }[]): void {
  if (!node || !node.known) return;
  out.push({ id: node.individual_id, depth });
  if (depth >= 3) return;
  for (const parent of node.parents ?? []) collectAncestors(parent, depth + 1, out);
}
function inbreedingCoefficient(pedigree: PedNode | null): number | null {
  if (!pedigree) return null;
  const sireNode = pedigree.parents?.find((n) => n.parent_role === "sire");
  const damNode = pedigree.parents?.find((n) => n.parent_role === "dam");
  if (!sireNode?.known || !damNode?.known) return null;
  const sireAnc: { id: string; depth: number }[] = [];
  const damAnc: { id: string; depth: number }[] = [];
  collectAncestors(sireNode, 0, sireAnc);
  collectAncestors(damNode, 0, damAnc);
  let f = 0;
  for (const d of damAnc) for (const s of sireAnc) if (s.id === d.id) f += Math.pow(0.5, s.depth + d.depth + 1);
  return f;
}

function inbreedingTone(f: number): { symbol: string; word: string } {
  if (f < 0.0625) return { symbol: "●", word: "低" };
  if (f < 0.125) return { symbol: "▲", word: "中" };
  return { symbol: "⚠", word: "高" };
}

// renderer.tsx L5662-L5703 の関数本体・型定義は不変。同L5665-5682のLIFE_ICON/
// LIFE_LABEL_JA定数はZ9のどの関数からも参照されないため意図的に複製していない
// (Z9のindLifeEventLabelは自前のswitch文で表示語を持つ・renderer.tsx L8704-8724)
type TimelineEntry =
  | { kind: "capture"; at: number; atIso: string; capture: ProfileCapture }
  | { kind: "life"; at: number; atIso: string; event: ProfileLifeEvent };
function buildTimeline(profile: IndividualProfile): TimelineEntry[] {
  const caps: TimelineEntry[] = profile.observations
    .map((c) => ({ kind: "capture" as const, at: Date.parse(c.time), atIso: c.time, capture: c }))
    .filter((e) => Number.isFinite(e.at));
  const life: TimelineEntry[] = profile.life_events
    .map((e) => ({ kind: "life" as const, at: Date.parse(e.at), atIso: e.at, event: e }))
    .filter((e) => Number.isFinite(e.at));
  return [...caps, ...life].sort((a, b) => a.at - b.at);
}
function prevValueFn(observations: ProfileCapture[]) {
  return (captureId: string, item: string): number | null => {
    const idx = observations.findIndex((o) => o.capture_id === captureId);
    for (let i = idx - 1; i >= 0; i--) {
      const v = measureValue(observations[i], item);
      if (v != null) return v;
    }
    return null;
  };
}

// ============ 登録 ============
registerNode("list:ind-detail", IndDetailNode);
registerNode("list:ind-match", IndMatchNode);
registerNode("list:pref-pairwise", PrefPairwiseNode);
registerNode("list:ind-species", IndSpeciesNode);
registerNode("list:ind-cross", IndCrossNode);
registerNode("list:ind-bio-card", IndBioCardNode);
