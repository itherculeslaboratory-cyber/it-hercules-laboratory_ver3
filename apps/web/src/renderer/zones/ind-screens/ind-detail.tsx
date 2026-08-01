"use client";

import { useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";
import { ScopeCtx, ExecuteCtx } from "../../core/context";
import { formatDateJa } from "../../core/scope";
import { registerNode } from "../../core/registry";
import {
  type IndividualProfile,
  type PedNode,
  type ProfileLifeEvent,
  type ProfileMeasurement,
  type TimelineEntry,
  buildTimeline,
  inbreedingCoefficient,
  inbreedingTone,
  isDegenerate,
  prevValueFn,
  profileLabel,
  seriesFor,
} from "../../core/individual";
import { useIndGet, IndQr, indNum } from "./shared";

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

registerNode("list:ind-detail", IndDetailNode);
