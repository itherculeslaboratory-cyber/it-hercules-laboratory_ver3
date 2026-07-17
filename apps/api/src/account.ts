// アカウント行(V3-AUT-09)+ オンボーディング状態(V3-AUT-10/I18-02)。
// 独立サインアップ画面は持たず、ログイン初回検証(magic-link/数字コード/dev-login)
// 成功時にオープン登録として R2 へ put-if-absent する(2回目以降はキー衝突=idempotent
// no-op・disputed の判定・再送は不要=事故らない)。PII は持たない(actor_id のみ)。
import { TruthStore, ulid } from "@ihl/truth";

const ACCOUNT_TYPE = "ihl.aut.account.v1";
const ACCOUNT_SCHEMA = "schemas/events/aut-account.schema.json";
const SCHEMA_VERSION = "1";
const PREF_TYPE = "ihl.pref.set.v1";
// V3-AUT-08: handle-routes.ts と共有(circular import 回避のためこちらを正本にする)。
export const HANDLE_TYPE = "ihl.aut.handle.v1";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/** 本人が既に handle を確定済みなら its handle、未確定なら null。 */
export async function findOwnHandle(s: TruthStore, actorId: string): Promise<string | null> {
  const events = (await s.listEvents(`truth/${HANDLE_TYPE}/`)).map(dataOf);
  const mine = events.find((d) => d.actor_id === actorId);
  return mine ? String(mine.handle) : null;
}

/** ログイン成功時に一度だけ呼ぶ。既にアカウント行が有れば無視(open registration)。 */
export async function ensureAccount(s: TruthStore, actorId: string): Promise<void> {
  const id = ulid();
  await s.putEventAt(`truth/${ACCOUNT_TYPE}/${actorId}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: ACCOUNT_TYPE,
    time: new Date().toISOString(),
    dataschema: ACCOUNT_SCHEMA,
    provenance: { generator_kind: "human", actor_id: actorId },
    data: { actor_id: actorId, created_at: new Date().toISOString(), schema_version: SCHEMA_VERSION },
  });
  // put-if-absent の結果(inserted/conflict/invalid)は問わない: 2回目以降は
  // conflict(既存アカウント=通常のログイン)であり、それ自体は正常系。
}

// I18-02: onboardingComplete は「locale を明示選択した(既定 ja へのフォールバックで
// なく、pref-set イベントに locale フィールドが実在する)」ことを要求する。
// projectPreferences の投影値だけでは「未設定→既定ja」と「本人がjaを選んだ」が
// 区別できないため、生イベントを直接見る。
async function hasExplicitLocale(s: TruthStore, actorId: string): Promise<boolean> {
  const events = await s.listEvents(`truth/${PREF_TYPE}/`);
  return events.some((e) => {
    const d = (e.data ?? {}) as Record<string, unknown>;
    return d.actor_id === actorId && typeof d.locale === "string" && d.locale !== "";
  });
}

export interface OnboardingStatus {
  onboarding_complete: boolean;
  handle: string | null;
  locale_set: boolean;
}

// V3-AUT-10/V3-I18-02: 必須2ゲート(handle + locale)が両方満たされて初めて
// onboardingComplete=true。V3-AUT-45(usecase-driven-design.md)により表示名/
// タイムゾーン/テーマは既定を通せる可変項目でゲートしない。
export async function projectOnboardingStatus(s: TruthStore, actorId: string): Promise<OnboardingStatus> {
  const [handle, localeSet] = await Promise.all([findOwnHandle(s, actorId), hasExplicitLocale(s, actorId)]);
  return { onboarding_complete: handle !== null && localeSet, handle, locale_set: localeSet };
}
