// 意図台帳(V3-AIP-35/36 / design-k8 §1.4)。設計意図を append-only で Truth に打つ
// 純書込ヘルパ + 純投影。route ハンドラではない(K8 は新 route 0 本 — ネットワーク経路は
// 既存の汎用 POST /events を再利用)。
//
// append パス一本化(批評家 F1・案 A): envelope.id === data.intent_id(両者 ULID)を
// ヘルパ内で単一設定する。これで汎用 putEvent が truth/ihl.process.intent.v1/<intent_id>.json
// に収束し、同一 intent_id の二重 append は put-if-absent で 409(UPDATE/DELETE 経路は
// TruthStore に非存在 = 追記のみ)。POST /events 経由でも同じ envelope.id 規約で同一キーへ収束。
import { TruthStore, type PutEventResult } from "@ihl/truth";

export const INTENT_TYPE = "ihl.process.intent.v1";
const INTENT_SCHEMA = "schemas/events/intent.schema.json";

/** intent イベントの data 形状(schemas/events/intent.schema.json)。 */
export interface IntentData {
  intent_id: string; // ULID — envelope.id と一致させる
  spec_version: string;
  intent_summary: string;
  problem_statement: string;
  expected_effect: string;
  created_at: string; // RFC3339
  schema_version: string;
  rejected_alternatives?: string[];
  decision_source?: string;
  commit_id?: string | null;
  post_id?: string | null;
}

/**
 * 意図イベントの純書込ヘルパ。envelope を構築し s.putEvent を呼ぶだけ(route ではない)。
 * envelope.id = data.intent_id 規約をここで単一設定し、provenance.actor_id を stamp する。
 * 戻り値: inserted / conflict(同一 intent_id 二重) / invalid(envelope/data 検証失敗)。
 */
export function appendIntent(
  s: TruthStore,
  actorId: string,
  data: IntentData,
): Promise<PutEventResult> {
  const envelope = {
    specversion: "1.0",
    id: data.intent_id, // envelope.id === intent_id(§1.1 規約)
    source: "apps/api",
    type: INTENT_TYPE,
    time: new Date().toISOString(),
    dataschema: INTENT_SCHEMA,
    // 意図の作者は人間 actor(session principal)。envelope 契約は generator_kind 必須。
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
  return s.putEvent(envelope);
}

export interface IntentChain {
  intent_id: string;
  spec_version: string;
  commit_id: string | null;
  post_id: string | null;
}

/**
 * intent_id → spec_version → commit_id → post_id の一意チェーンを都度再計算(prefix scan・
 * 保存しない)。Truth キーが intent_id 単位のため一致は高々 1 件。未存在は null。
 */
export async function projectIntentChain(
  s: TruthStore,
  intentId: string,
): Promise<IntentChain | null> {
  const events = await s.listEvents(`truth/${INTENT_TYPE}/`);
  for (const e of events) {
    const d = (e.data ?? {}) as Partial<IntentData>;
    if (d.intent_id === intentId) {
      return {
        intent_id: intentId,
        spec_version: d.spec_version ?? "",
        commit_id: d.commit_id ?? null,
        post_id: d.post_id ?? null,
      };
    }
  }
  return null;
}
