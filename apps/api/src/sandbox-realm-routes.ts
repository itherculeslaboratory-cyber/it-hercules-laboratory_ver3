// V3-FND-31 — Personal Sandbox Realm 本体(design19 §T1-9・発注書 w-fnd2)。
// ★同名の sandbox-routes.ts(V3-SEC-45 隔離実行の認可ゲート・w1-sec所有)とは中身が
// 無関係の別要件 — このファイルには実行ランタイムは一切含まれない。fork するのは
// 本番の設定(FeatureNode config)であって任意コードではない(design19本文)。
//
// ★判断が要った箇所(正直に明記): 「本番FeatureNode config」を持つ具体的な既存
// レジストリはこのリポジトリに存在しない(config/*.json・screen-defs等はあるが
// 「world/ 配下の canonical config」という概念自体が本要件で初めて導入されている)。
// そのためこのモジュールは config の中身(ドメイン意味論)には関与せず、
// 「world/{configKey}/ 配下の任意JSONを sandbox/{user}/{realm}/ へ fork し、
// 差分を持ち、明示的Promoteでのみ world/ へ新バージョンとして書き戻す」という
// R2キー操作の骨格だけを提供する(要件本文が求める部分=キー空間分離・INSERT ONLY・
// upper上限・fork/promote/delete の事実記録は全て実装済み)。
import { Hono } from "hono";
import { TruthStore, ulid, type R2BucketLite } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { requireRole } from "./authz";

export const SANDBOX_REALM_TYPE = "ihl.fnd.sandbox_realm.v1";
export const MAX_REALMS_PER_USER = 5;

export class RealmLimitExceededError extends Error {
  constructor(userId: string) {
    super(`REALM_LIMIT_EXCEEDED: user ${userId} already has ${MAX_REALMS_PER_USER} active realms`);
    this.name = "RealmLimitExceededError";
  }
}
export class RealmNotFoundError extends Error {
  constructor(realmId: string) {
    super(`REALM_NOT_FOUND: ${realmId}`);
    this.name = "RealmNotFoundError";
  }
}
export class RealmPromoteForbiddenError extends Error {
  constructor() {
    super("REALM_PROMOTE_FORBIDDEN: promote requires role=administrator");
    this.name = "RealmPromoteForbiddenError";
  }
}
// world/ への書き込みは promoteRealm 経由のみ許される。forkRealm/writeDiffTemplate/
// deleteRealm がこの禁止を破ろうとした場合に投げる(通常到達しない防御的アサート)。
export class WorldWriteForbiddenError extends Error {
  constructor(key: string) {
    super(`WORLD_WRITE_FORBIDDEN: sandbox operations may not write to world/ (key=${key})`);
    this.name = "WorldWriteForbiddenError";
  }
}

export interface SandboxRealmSummary {
  realm_id: string;
  user_id: string;
  forked_from_version?: string;
  created_at: string;
  active: boolean; // true = forked かつ、その後 deleted されていない
  promoted: boolean; // true = 少なくとも1回 promoted された
}

function sandboxConfigKey(userId: string, realmId: string): string {
  return `sandbox/${userId}/${realmId}/config.json`;
}
function sandboxDiffKey(userId: string, realmId: string): string {
  return `sandbox/${userId}/${realmId}/diff.sbx.json`;
}

async function assertNotWorldKey(key: string): Promise<void> {
  if (key.startsWith("world/")) throw new WorldWriteForbiddenError(key);
}

/** userId の Realm 一覧(realm_id ごとに最新状態へ畳んだサマリ)。 */
export async function listUserRealms(s: TruthStore, userId: string): Promise<SandboxRealmSummary[]> {
  const events = await s.listEvents(`truth/${SANDBOX_REALM_TYPE}/`);
  const byRealm = new Map<string, SandboxRealmSummary>();
  const sorted = events
    .map((e) => e.data as { realm_id: string; user_id: string; action: string; forked_from_version?: string; at: string })
    .filter((d) => d.user_id === userId)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  for (const d of sorted) {
    const existing = byRealm.get(d.realm_id);
    if (d.action === "forked") {
      byRealm.set(d.realm_id, {
        realm_id: d.realm_id,
        user_id: d.user_id,
        forked_from_version: d.forked_from_version,
        created_at: d.at,
        active: true,
        promoted: existing?.promoted ?? false,
      });
    } else if (d.action === "promoted" && existing) {
      existing.promoted = true;
    } else if (d.action === "deleted" && existing) {
      existing.active = false;
    }
  }
  return [...byRealm.values()];
}

export interface ForkRealmOptions {
  userId: string;
  isAdmin: boolean;
  /** world/ 側の config を指す識別子(例: "feature-flags")。ドメイン意味論には関与しない。 */
  worldConfigKey: string;
  /** fork 元の本番 config バージョン(任意・記録のみ)。 */
  forkedFromVersion?: string;
  /** fork するconfigの中身(JSON化可能な任意値。本モジュールは中身を解釈しない)。 */
  worldConfigContent: unknown;
  now: Date;
}

/**
 * 本番 config を fork して Realm を開始する(5個/user上限・管理者は無制限)。
 * R2 sandbox prefix への書き込みは INSERT ONLY(同じ realm_id は ulid() で新規採番
 * するため通常衝突しないが、writeOnce と同じ put-if-absent で防御する)。
 */
export async function forkRealm(
  s: TruthStore,
  bucket: R2BucketLite,
  opts: ForkRealmOptions,
): Promise<SandboxRealmSummary> {
  if (!opts.isAdmin) {
    const active = (await listUserRealms(s, opts.userId)).filter((r) => r.active).length;
    if (active >= MAX_REALMS_PER_USER) throw new RealmLimitExceededError(opts.userId);
  }

  const realmId = ulid();
  const configKey = sandboxConfigKey(opts.userId, realmId);
  await assertNotWorldKey(configKey);
  const putRes = await bucket.put(configKey, JSON.stringify(opts.worldConfigContent), {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (putRes === null) throw new Error(`SANDBOX_KEY_CONFLICT: ${configKey}`); // ulid衝突は実質起きない防御

  const id = ulid();
  await s.putEventAt(`truth/${SANDBOX_REALM_TYPE}/${realmId}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: SANDBOX_REALM_TYPE,
    time: opts.now.toISOString(),
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data: {
      realm_id: realmId,
      user_id: opts.userId,
      action: "forked",
      forked_from_version: opts.forkedFromVersion,
      at: opts.now.toISOString(),
    },
  });

  return {
    realm_id: realmId,
    user_id: opts.userId,
    forked_from_version: opts.forkedFromVersion,
    created_at: opts.now.toISOString(),
    active: true,
    promoted: false,
  };
}

export interface DiffTemplate {
  diff: Record<string, unknown>;
  base_version: string;
  author_id: string;
  schema_version: string;
  created_at: string;
}

/**
 * 変更差分を改善テンプレート(.sbx.json)として R2 に保存する(Truth イベントではない
 * — design19 §T1-9「.sbx.json は R2オブジェクトであってイベントではない」)。
 */
export async function writeDiffTemplate(
  bucket: R2BucketLite,
  userId: string,
  realmId: string,
  template: Omit<DiffTemplate, "created_at">,
  now: Date,
): Promise<DiffTemplate> {
  const key = sandboxDiffKey(userId, realmId);
  await assertNotWorldKey(key);
  const full: DiffTemplate = { ...template, created_at: now.toISOString() };
  await bucket.put(key, JSON.stringify(full));
  return full;
}

/**
 * 他Realmへの適用プレビュー(純関数・書き込みなし。fork5秒/diff preview2秒以内の
 * 受入条件のうち、I/Oを伴わない純関数であるためこの制約は構造的に満たす)。
 * 浅いマージ(diffのキーがベースを上書きする)を返すのみで、実際の書き込みは行わない。
 */
export function previewApply(baseConfig: unknown, diff: Record<string, unknown>): Record<string, unknown> {
  const base = (baseConfig ?? {}) as Record<string, unknown>;
  return { ...base, ...diff };
}

export interface PromoteRealmOptions {
  realmId: string;
  userId: string;
  actorRole: "operator" | "administrator";
  worldConfigKey: string;
  now: Date;
}

/**
 * 本番Merge(role=administratorのみ)。world/ への書き込みはこの関数だけが行う。
 * R2 INSERT ONLY(旧バージョンを上書きしない)= 新しい ULID バージョンキーへ append し、
 * 履歴は全件保持される。改善は明示的Promoteまで本番に波及しない。
 */
export async function promoteRealm(
  s: TruthStore,
  bucket: R2BucketLite,
  opts: PromoteRealmOptions,
): Promise<{ world_key: string }> {
  if (opts.actorRole !== "administrator") throw new RealmPromoteForbiddenError();

  const configKey = sandboxConfigKey(opts.userId, opts.realmId);
  const obj = await bucket.get(configKey);
  if (!obj) throw new RealmNotFoundError(opts.realmId);
  const content = await obj.text();

  const versionId = ulid();
  const worldKey = `world/${opts.worldConfigKey}/${versionId}.json`;
  const putRes = await bucket.put(worldKey, content, { onlyIf: { etagDoesNotMatch: "*" } });
  if (putRes === null) throw new Error(`WORLD_KEY_CONFLICT: ${worldKey}`); // ulid衝突は実質起きない防御

  const id = ulid();
  await s.putEventAt(`truth/${SANDBOX_REALM_TYPE}/${opts.realmId}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: SANDBOX_REALM_TYPE,
    time: opts.now.toISOString(),
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data: {
      realm_id: opts.realmId,
      user_id: opts.userId,
      action: "promoted",
      forked_from_version: opts.worldConfigKey,
      at: opts.now.toISOString(),
    },
  });

  return { world_key: worldKey };
}

/** Realm を削除する(Truth append-onlyのため実体は「削除された」という事実の記録。 */
export async function deleteRealm(s: TruthStore, realmId: string, userId: string, now: Date): Promise<void> {
  const id = ulid();
  await s.putEventAt(`truth/${SANDBOX_REALM_TYPE}/${realmId}-${id}.json`, {
    specversion: "1.0",
    id,
    source: "apps/api",
    type: SANDBOX_REALM_TYPE,
    time: now.toISOString(),
    provenance: { generator_kind: "agent", agent_name: "claude-code" },
    data: { realm_id: realmId, user_id: userId, action: "deleted", at: now.toISOString() },
  });
}

// ── HTTP ルーター(未マウント) ────────────────────────────────────────────
// index.ts への mount 行は艦が直接書かない規約(docs/MODULE-MAP.md)のため、この
// ルーターは作成のみで未マウント。マウントする場合の推奨 base path は
// "/api/v1/sandbox-realm"(HQ検収時に index.ts へ追加する行として報告書に明記)。
// worldConfigKey/worldConfigContent の受け渡し方(どの本番configをforkするか)は
// 呼び出し側ドメインが決める領域のため、ボディでそのまま受け取る素通し実装に留める。
export function createSandboxRealmRoutes() {
  const routes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

  routes.get("/sandbox-realm", async (c) => {
    const actorId = c.get("actorId");
    const s = new TruthStore(c.env.TRUTH);
    const realms = await listUserRealms(s, actorId);
    return c.json({ realms });
  });

  routes.post("/sandbox-realm/fork", async (c) => {
    const actorId = c.get("actorId");
    const roles = c.get("roles") ?? [];
    const body = (await c.req.json().catch(() => null)) as {
      world_config_key?: unknown;
      forked_from_version?: unknown;
      world_config_content?: unknown;
    } | null;
    if (!body || typeof body.world_config_key !== "string") {
      return c.json({ error: "INVALID_REQUEST", details: ["world_config_key is required"] }, 400);
    }
    const s = new TruthStore(c.env.TRUTH);
    try {
      const realm = await forkRealm(s, c.env.TRUTH, {
        userId: actorId,
        isAdmin: roles.includes("administrator"),
        worldConfigKey: body.world_config_key,
        forkedFromVersion: typeof body.forked_from_version === "string" ? body.forked_from_version : undefined,
        worldConfigContent: body.world_config_content ?? {},
        now: new Date(),
      });
      return c.json({ realm }, 201);
    } catch (e) {
      if (e instanceof RealmLimitExceededError) return c.json({ error: "REALM_LIMIT_EXCEEDED" }, 409);
      throw e;
    }
  });

  routes.delete("/sandbox-realm/:realm_id", async (c) => {
    const actorId = c.get("actorId");
    await deleteRealm(new TruthStore(c.env.TRUTH), c.req.param("realm_id"), actorId, new Date());
    return c.json({ deleted: true });
  });

  // Promote は role=administrator のみ(第20回裁定の語彙どおり)。
  routes.post("/sandbox-realm/:realm_id/promote", requireRole("administrator"), async (c) => {
    const actorId = c.get("actorId");
    const body = (await c.req.json().catch(() => null)) as { world_config_key?: unknown; realm_user_id?: unknown } | null;
    if (!body || typeof body.world_config_key !== "string") {
      return c.json({ error: "INVALID_REQUEST", details: ["world_config_key is required"] }, 400);
    }
    const s = new TruthStore(c.env.TRUTH);
    try {
      const result = await promoteRealm(s, c.env.TRUTH, {
        realmId: c.req.param("realm_id"),
        userId: typeof body.realm_user_id === "string" ? body.realm_user_id : actorId,
        actorRole: "administrator",
        worldConfigKey: body.world_config_key,
        now: new Date(),
      });
      return c.json(result);
    } catch (e) {
      if (e instanceof RealmNotFoundError) return c.json({ error: "REALM_NOT_FOUND" }, 404);
      throw e;
    }
  });

  return routes;
}

export const sandboxRealmRoutes = createSandboxRealmRoutes();
