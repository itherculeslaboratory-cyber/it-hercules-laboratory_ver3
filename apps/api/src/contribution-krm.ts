// V3-KRM-22②③(design19 §T1-1・w-gov3)。取引に紐づかない一般ユーザー評価(krm-feedback)と
// 価値観テンプレート(krm-preference-template)。①(取引評価4カウント投影)は w-mkt2 が別途持つ
// (mkt-rating.schema.json・本ファイルとは別ドメイン=混同しない)。
//
// krm-feedback の「自動更新」は外部AIを一切呼ばない純関数。match-preference.schema.json の
// 学習率つき重みベクトル更新 w←w+α·y·x(match-routes.ts projectPreferenceWeights)をそのまま
// 横展開する。krm-feedback には features 配列が無い(スキーマにその設計意図が無い=単一の
// 総合評価であって「decision/creation/style」を分けた複数モデルではない)ため x=[1] の
// スカラー特徴として扱う(判断が要った箇所・報告書参照)。
//
// カルマ(grantKarmaCountIncrease)は一切呼ばない。V3-KRM-08「カルマが下がるのは問題行為の
// みタグで判定」の制約は krm-feedback にはタグ項目自体が無い(schemas/events/krm-feedback.schema.json
// に tags フィールド無し)ため、カルマ経路に一切接続しないことで安全側に満たす
// (mkt-rating.ts 側の①は tags 判定込みで別途カルマに接続済み=市場取引評価と混同しない)。
//
// krm-preference-template の fork 作法は culture.ts の appendTemplateVersion と同型
// (envelope.id===version_id 規約・forked_from で fork 元記録・append のみ)。新規 route は
// 作らない(culture.ts と同じく route ではない純書込ヘルパ)。
import { TruthStore, ulid, type PutEventResult } from "@ihl/truth";
import { LEARNING_RATE } from "./observation-constants";

// ── krm-feedback(V3-KRM-22②)────────────────────────────────────────────
export const FEEDBACK_TYPE = "ihl.krm.feedback.v1";
const FEEDBACK_SCHEMA = "schemas/events/krm-feedback.schema.json";
const SCHEMA_VERSION = "1";

export type FeedbackGrade = "bad" | "normal" | "good";

export interface FeedbackData {
  feedback_id: string;
  actor_id: string;
  target_actor_id: string;
  grade: FeedbackGrade;
  reason?: string; // grade=bad のとき必須(schema if/then で強制)
  created_at: string;
  schema_version: string;
}

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** grade→教師信号 y(match-preference と同じ ±1 語彙。normal は中立=0で重みへ寄与しない)。 */
export function feedbackGradeToY(grade: FeedbackGrade): number {
  if (grade === "good") return 1;
  if (grade === "bad") return -1;
  return 0;
}

/**
 * krm-feedback イベントの純書込ヘルパ(route ではない・culture.ts appendTemplateVersion と
 * 同型)。actor_id はセッション principal を呼び出し側が渡す(V3-AUT-17 は呼び出し元の
 * route 側の責務)。grade=bad で reason 未指定は schema 層の if/then が invalid を返す。
 */
export function appendFeedback(
  s: TruthStore,
  actorId: string,
  targetActorId: string,
  grade: FeedbackGrade,
  reason?: string,
): Promise<PutEventResult> {
  const id = ulid();
  const data: FeedbackData = {
    feedback_id: id,
    actor_id: actorId,
    target_actor_id: targetActorId,
    grade,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  if (reason) data.reason = reason;
  return s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: FEEDBACK_TYPE,
    time: new Date().toISOString(),
    dataschema: FEEDBACK_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
}

/** target_actor_id 宛の krm-feedback を全走査(prefix scan・保存しない・都度再計算)。 */
export async function listFeedbackFor(
  s: TruthStore,
  targetActorId: string,
): Promise<FeedbackData[]> {
  return (await s.listEvents(`truth/${FEEDBACK_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.target_actor_id === targetActorId) as unknown as FeedbackData[];
}

/**
 * target_actor_id の総合評価重み(w←w+α·y·x, x=[1] のスカラー特徴・match-routes.ts
 * projectPreferenceWeights と同じ更新式の横展開)。created_at 昇順→feedback_id で
 * 決定的に畳み込む。AIは一切呼ばない純関数。
 */
export async function projectFeedbackWeight(
  s: TruthStore,
  targetActorId: string,
): Promise<{ target_actor_id: string; weight: number; count: number }> {
  const rows = (await listFeedbackFor(s, targetActorId)).sort(
    (a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.feedback_id).localeCompare(String(b.feedback_id)),
  );
  let w = 0;
  for (const d of rows) {
    w += LEARNING_RATE * feedbackGradeToY(d.grade);
  }
  return { target_actor_id: targetActorId, weight: w, count: rows.length };
}

// ── krm-preference-template(V3-KRM-22③)────────────────────────────────
export const PREFERENCE_TEMPLATE_TYPE = "ihl.krm.preference_template.v1";
const PREFERENCE_TEMPLATE_SCHEMA = "schemas/events/krm-preference-template.schema.json";

export interface PreferenceTemplateItem {
  tag: string;
  value: -1 | 0 | 1;
}

export interface PreferenceTemplateData {
  template_id: string;
  version_id: string; // envelope.id と一致(culture.ts と同じ規約)
  author_actor_id: string;
  items: PreferenceTemplateItem[];
  order?: string[];
  forked_from?: string | null;
  created_at: string;
  schema_version: string;
}

/**
 * 価値観テンプレート版の純書込ヘルパ(culture.ts appendTemplateVersion と同型)。
 * envelope.id===version_id 規約をここで単一設定。version_id 二重 append は
 * put-if-absent で conflict。
 */
export function appendPreferenceTemplateVersion(
  s: TruthStore,
  actorId: string,
  data: Omit<PreferenceTemplateData, "author_actor_id" | "created_at" | "schema_version"> & {
    created_at?: string;
  },
): Promise<PutEventResult> {
  const full: PreferenceTemplateData = {
    template_id: data.template_id,
    version_id: data.version_id,
    author_actor_id: actorId,
    items: data.items,
    ...(data.order ? { order: data.order } : {}),
    ...(data.forked_from !== undefined ? { forked_from: data.forked_from } : {}),
    created_at: data.created_at ?? new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const envelope = {
    specversion: "1.0",
    id: full.version_id,
    source: "apps/api",
    type: PREFERENCE_TEMPLATE_TYPE,
    time: new Date().toISOString(),
    dataschema: PREFERENCE_TEMPLATE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data: full,
  };
  return s.putEvent(envelope);
}

/** version_id → data の索引を版イベント列から都度再計算(culture.ts indexByVersion と同型)。 */
async function indexPreferenceTemplateByVersion(
  s: TruthStore,
): Promise<Map<string, PreferenceTemplateData>> {
  const events = await s.listEvents(`truth/${PREFERENCE_TEMPLATE_TYPE}/`);
  const m = new Map<string, PreferenceTemplateData>();
  for (const e of events) {
    const d = dataOf(e) as unknown as PreferenceTemplateData;
    if (typeof d.version_id === "string") m.set(d.version_id, d);
  }
  return m;
}

/** 指定版の内容を版列の投影から都度取得。版未存在は null。 */
export async function projectPreferenceTemplateVersion(
  s: TruthStore,
  versionId: string,
): Promise<PreferenceTemplateData | null> {
  const idx = await indexPreferenceTemplateByVersion(s);
  return idx.get(versionId) ?? null;
}

/**
 * template_id 系列の最新版(fork チェーンの先頭)を求める:同一 template_id を持つ全版から
 * created_at 最大を返す(culture.ts に無い機能だが同じ prefix-scan+reduce 方式)。版が
 * 無ければ null。
 */
export async function projectPreferenceTemplateLatest(
  s: TruthStore,
  templateId: string,
): Promise<PreferenceTemplateData | null> {
  const idx = await indexPreferenceTemplateByVersion(s);
  let latest: PreferenceTemplateData | null = null;
  for (const d of idx.values()) {
    if (d.template_id !== templateId) continue;
    if (!latest || String(d.created_at) > String(latest.created_at)) latest = d;
  }
  return latest;
}
