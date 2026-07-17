// V3-SEC-20(仕上げ): 利用規約(ToS)機能の残余。既存で満たされている部分は本ファイルに
// 含めない(コードでなく設計の再確認): (a)未認証ユーザーの /onboarding/terms 全文閲覧は
// apps/web にルーターレベルの認証ガードが無く screen-defs/terms.json 自体も API 呼び出しを
// 持たないため既に成立(no code change)。(b)ログインリンク送信前の同意チェック必須(未同意
// 時disabled)は screen-defs/login.json の required checkbox("terms")を renderer.tsx の
// V3-AUT-06 ゲート(anyField(...,isRequiredCheckbox) → 送信ボタン disabled)が既に担保
// (no code change)。
//
// 本ファイルが埋める残余ギャップ: 「初回オンボーディングで利用規約とプライバシー両方への
// 同意をAPIで検証(MUST_AGREE_TO_TERMS)し、同意状態を永続化する」というオンボーディング
// API 側ゲートが未実装だった(grep 該当0件)。CL-05 consent-record(frozen・INSERT ONLY)を
// append-only で記録し、投影(常駐 DB を持たない都度再計算)で agreedTerms/agreedPrivacy を
// 判定する。login.json の単一 "terms" チェックボックスは1文書(利用規約)相当のため、本
// route は1回の POST でその両方(利用規約+プライバシー)への同意を一括記録する設計とした
// (UI側が別々のプライバシー同意チェックボックスを持つ運びになった場合は別イベントとして
// 追記すればよい・append-only なので後方互換)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";

const CONSENT_TYPE = "ihl.legal.agree.v1";
const CONSENT_SCHEMA = "schemas/frozen/consent-record.schema.json";
// ver2 現行の草案版(consent-record.schema.json の description 参照)。最終法務確定
// (HUMAN-02-LEGAL)前は is_draft_terms=true 固定。
const TERMS_VERSION_BASE = "draft-2026-06";
const LEGAL_GATE = "HUMAN-02-LEGAL";

export const consentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** agree_<12桁16進> — consent-record.schema.json の agree_id パターンに合わせる。 */
function agreeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "agree_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ConsentProjection {
  agreedTerms: boolean;
  agreedPrivacy: boolean;
}

/**
 * 本人の同意状態投影(都度再計算・常駐 DB 禁止)。terms/privacy それぞれの最新同意
 * レコードが1件でもあれば true。撤回イベントは無い(利用規約同意の性質上、一度
 * 同意した記録を無効化する概念を持たない=append-only の記録そのものが正)。
 */
export async function projectConsent(s: TruthStore, actorId: string): Promise<ConsentProjection> {
  const events = (await s.listEvents(`truth/${CONSENT_TYPE}/`))
    .map(dataOf)
    .filter((d) => d.actor_id === actorId);
  return {
    agreedTerms: events.some((d) => d.terms_version === `terms-${TERMS_VERSION_BASE}`),
    agreedPrivacy: events.some((d) => d.terms_version === `privacy-${TERMS_VERSION_BASE}`),
  };
}

// GET /me/consent — 本人の同意状態投影。
consentRoutes.get("/me/consent", async (c) => {
  return c.json(await projectConsent(store(c), c.get("actorId")));
});

// POST /onboarding/agree — 初回オンボーディングの MUST_AGREE_TO_TERMS ゲート。body の
// agreedTerms/agreedPrivacy が両方 true でなければ 400 MUST_AGREE_TO_TERMS(要件文言どおり
// のエラーコード)。両方 true なら CL-05 consent-record を2件(terms/privacy)append し、
// 同意状態を永続化する。再呼び出しは冪等に近い形で許容(新規 agree_id で追記=法務証跡は
// 都度残る・append-only の性質上「同意済みなら弾く」必要はない)。
consentRoutes.post("/onboarding/agree", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { agreedTerms?: unknown; agreedPrivacy?: unknown }
    | null;
  const agreedTerms = body?.agreedTerms === true;
  const agreedPrivacy = body?.agreedPrivacy === true;
  if (!agreedTerms || !agreedPrivacy) {
    return c.json(
      { error: "MUST_AGREE_TO_TERMS", details: ["agreedTerms and agreedPrivacy must both be true"] },
      400,
    );
  }
  const actorId = c.get("actorId");
  const s = store(c);
  for (const doc of ["terms", "privacy"] as const) {
    const agreeIdValue = agreeId();
    const envelopeId = ulid(); // CloudEvents envelope.id must stay a ULID; agree_id is the frozen-schema key.
    const data = {
      schema: "legal_agree_v1",
      agree_id: agreeIdValue,
      actor_id: actorId,
      terms_version: `${doc}-${TERMS_VERSION_BASE}`,
      is_draft_terms: true,
      legal_gate: LEGAL_GATE,
      created_at: new Date().toISOString(),
    };
    const res = await s.putEventAt(`truth/${CONSENT_TYPE}/${agreeIdValue}.json`, {
      specversion: "1.0",
      id: envelopeId,
      source: "apps/api",
      type: CONSENT_TYPE,
      time: new Date().toISOString(),
      dataschema: CONSENT_SCHEMA,
      provenance: { generator_kind: "human", actor_id: actorId },
      data,
    });
    if (res.status === "invalid") return c.json({ error: "INVALID_CONSENT", details: res.errors }, 500);
    if (res.status === "conflict") return c.json({ error: "CONSENT_CONFLICT", key: res.key }, 409);
  }
  return c.json(await projectConsent(s, actorId), 201);
});
