// V3-KRM-17 称号システム(design19 §T1-5・w-gov3)。3軸(自称×他称×貢献)のうち、本ファイルは
// 「付与イベント(Truth・append・消えない)」側のみを実装する。称号は権限に一切影響しない
// 表示専用(requireRole に一切登場させない・本ファイルは authz.ts を import しない)。
// バッジ表の代わりに定義済みメダル表(静的な閾値定数)からの機械付与にする(AIを呼ばない)。
//
// ★スコープ差し戻し(自称/表示設定): 「表示設定(削除可能ストア)」は既存
// schemas/events/pref-set.schema.json(additionalProperties:false)に新フィールドを追加する
// か、新しい削除可能イベント型を新設しスキーマ登録(codegen-validators.mjs実行)+
// index.ts の SELF_SERVICE_EVENT_TYPES allowlist 追加が要る。いずれも本艦のglob
// (contribution*/gov-routes*のみ)外のファイル(schemas/events/*・settings-routes.ts・
// index.ts)への書込みが必要で、一次資料にも「どちらの経路にするか」の指定が無い
// (V3-GOV-17と同型の glob 外依存)。よって本ファイルは実装せず、報告書 frontmatter の
// 「差し戻し」欄で考える役(lane-think)へ送る。付与(貢献軸/他称軸)は下記の通りglob内で
// 完結するため実装済み。
import { TruthStore, ulid, type PutEventResult } from "@ihl/truth";
import { AXES, type Axis, projectContribution } from "./contribution";
import { projectSocialEval } from "./social-routes";

export const TITLE_TYPE = "ihl.krm.title.v1";
const TITLE_SCHEMA = "schemas/events/krm-title.schema.json";
const SCHEMA_VERSION = "1";

export type TitleGrantedBy = "auto" | "vote";
// axis は krm-title.schema.json 上は自由文字列(自称/他称/貢献のいずれか、または軸名の
// 識別子)。本ファイルは「貢献」軸(axis="contribution")と「他称」軸(axis="external")の
// 機械付与のみ扱う(自称は上記スコープ差し戻し参照)。
export type TitleAxis = "contribution" | "external";

export interface TitleGrantData {
  title_id: string;
  actor_id: string;
  granted_by: TitleGrantedBy;
  axis: string;
  granted_at: string;
  schema_version?: string;
}

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** 称号付与イベントの純書込ヘルパ(route ではない・culture.ts appendTemplateVersion と同型)。 */
export function appendTitleGrant(
  s: TruthStore,
  actorId: string,
  grantedBy: TitleGrantedBy,
  axis: string,
): Promise<PutEventResult> {
  const id = ulid();
  const data: TitleGrantData = {
    title_id: id,
    actor_id: actorId,
    granted_by: grantedBy,
    axis,
    granted_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  return s.putEvent({
    specversion: "1.0",
    id,
    source: "apps/api",
    type: TITLE_TYPE,
    time: new Date().toISOString(),
    dataschema: TITLE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  });
}

/** actor_id に付与された称号を全走査(prefix scan・保存しない・都度再計算)。監査証跡。 */
export async function projectTitles(s: TruthStore, actorId: string): Promise<TitleGrantData[]> {
  return (await s.listEvents(`truth/${TITLE_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId) as unknown as TitleGrantData[];
}

/**
 * 貢献軸(V3-KRM-11 と同じ「称号ライン」)の機械付与。projectContribution が既に計算
 * している axes[axis].title(CONTRIBUTION_TITLE_THRESHOLD 到達フラグ)を再利用し
 * (閾値を重複定義しない・二重計算しない)、まだ「貢献」称号を1度も付与されていなければ
 * 1回だけ append する(Truth・append-only・冪等=同じ actor への2回目以降は何もしない)。
 * 定義済み閾値表(config/github-contribution-weights.jsonと同じ「静的表からの機械付与」の
 * 精神=economy-constants.tsのCONTRIBUTION_TITLE_THRESHOLDが静的表の役割を果たす)からの
 * 機械付与であり、AIは一切呼ばない。
 */
export async function maybeGrantContributionTitle(
  s: TruthStore,
  actorId: string,
): Promise<PutEventResult[]> {
  const { axes } = await projectContribution(s, actorId);
  const existing = await projectTitles(s, actorId);
  const alreadyGranted = existing.some((t) => t.axis === "contribution");
  const results: PutEventResult[] = [];
  // 3軸のうちいずれか1軸でも閾値到達済みなら「貢献」称号を1回だけ付与する(軸別に
  // 個別の称号を作る設計は一次資料に無いため発明しない=穴埋め禁止・単一の「貢献」
  // 称号として扱う)。
  const anyAxisReached = AXES.some((axis: Axis) => axes[axis].title);
  if (anyAxisReached && !alreadyGranted) {
    results.push(await appendTitleGrant(s, actorId, "auto", "contribution"));
  }
  return results;
}

/**
 * 他称(external)軸の票数を数える読み取り専用関数。social-eval(kind:"vote")の累計を
 * 再利用する(projectSocialEval・二重投影を作らない)。★judgment: projectSocialEval は
 * target_node_id(コンテンツノード)単位の集計であり actor 単位の投影ではない。本要件
 * (「他称=social-eval(kind:vote)の累計」)を満たすため、actor_id をそのまま node_id
 * として扱う規約を採用する(一次資料に無い解釈の補完・判断が要った箇所として報告書に
 * 明記)。閾値(何票で称号付与か)は design19/registryのどこにも定義が無いため、本関数は
 * カウントの読み取りのみ提供し、自動付与(maybeGrantContributionTitle 相当)は実装しない
 * (推測で数値を発明しない=穴埋め禁止・「決められなかったこと」として報告)。
 */
export async function countExternalVotes(s: TruthStore, actorId: string): Promise<number> {
  const { counts } = await projectSocialEval(s, actorId);
  return counts.vote;
}
