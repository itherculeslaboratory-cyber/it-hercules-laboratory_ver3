// 文化テンプレの版(V3-AIP-76 / design-k8 §1.4)。テンプレ版を append-only で Truth に
// 打つ純書込ヘルパ + 版イベント列の投影(diff/restore)。fork は forked_from を持つ新版の
// append。route ではない(K8 は新 route 0 本 — ネットワーク経路は既存 POST /events 再利用)。
//
// append パス一本化(批評家 F1・案 A): envelope.id === data.version_id 規約をヘルパ内で
// 単一設定。汎用 putEvent が truth/ihl.culture.template.v1/<version_id>.json に収束し、
// 同一 version_id の二重 append は put-if-absent で 409。diff/restore は版列の純投影で都度導出。
import { TruthStore, type PutEventResult } from "@ihl/truth";

export const CULTURE_TEMPLATE_TYPE = "ihl.culture.template.v1";
const CULTURE_TEMPLATE_SCHEMA = "schemas/events/culture-template.schema.json";

/** culture-template イベントの data 形状(schemas/events/culture-template.schema.json)。 */
export interface CultureTemplateData {
  template_id: string;
  version_id: string; // ULID — envelope.id と一致させる
  kind: "ui_theme" | "board_structure" | "eval_axis";
  body: Record<string, unknown>;
  author_actor_id: string;
  created_at: string; // RFC3339
  schema_version: string;
  forked_from?: string | null; // 親版の version_id(fork 元)
  note?: string;
}

/**
 * テンプレ版の純書込ヘルパ。envelope.id = data.version_id 規約をここで単一設定し、
 * provenance.actor_id を stamp する。戻り値: inserted / conflict(version_id 二重) / invalid。
 */
export function appendTemplateVersion(
  s: TruthStore,
  actorId: string,
  data: CultureTemplateData,
): Promise<PutEventResult> {
  const envelope = {
    specversion: "1.0",
    id: data.version_id, // envelope.id === version_id(§1.1 規約)
    source: "apps/api",
    type: CULTURE_TEMPLATE_TYPE,
    time: new Date().toISOString(),
    dataschema: CULTURE_TEMPLATE_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
  return s.putEvent(envelope);
}

/** version_id → data の索引を版イベント列から都度再計算(prefix scan・保存しない)。 */
async function indexByVersion(
  s: TruthStore,
): Promise<Map<string, CultureTemplateData>> {
  const events = await s.listEvents(`truth/${CULTURE_TEMPLATE_TYPE}/`);
  const m = new Map<string, CultureTemplateData>();
  for (const e of events) {
    const d = (e.data ?? {}) as CultureTemplateData;
    if (typeof d.version_id === "string") m.set(d.version_id, d);
  }
  return m;
}

export interface BodyDiff {
  [key: string]: { a: unknown; b: unknown };
}

/**
 * 版 verA と verB の body の key 差分を都度再計算。両版の body の全 key を走査し、値が
 * 異なる key を { a, b } で返す(片方にしか無い key は他方 undefined)。版未存在は throw。
 */
export async function projectTemplateDiff(
  s: TruthStore,
  verA: string,
  verB: string,
): Promise<BodyDiff> {
  const idx = await indexByVersion(s);
  const a = idx.get(verA);
  const b = idx.get(verB);
  if (!a) throw new Error(`template version not found: ${verA}`);
  if (!b) throw new Error(`template version not found: ${verB}`);
  const diff: BodyDiff = {};
  const keys = new Set([...Object.keys(a.body), ...Object.keys(b.body)]);
  for (const k of keys) {
    if (JSON.stringify(a.body[k]) !== JSON.stringify(b.body[k])) {
      diff[k] = { a: a.body[k], b: b.body[k] };
    }
  }
  return diff;
}

/** 指定版の body を版列の投影から都度取得(restore)。版未存在は null。 */
export async function projectTemplateRestore(
  s: TruthStore,
  versionId: string,
): Promise<Record<string, unknown> | null> {
  const idx = await indexByVersion(s);
  return idx.get(versionId)?.body ?? null;
}
