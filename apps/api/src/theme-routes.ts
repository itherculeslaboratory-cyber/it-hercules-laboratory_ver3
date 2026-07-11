// テーマパック / UI テンプレ route(design-k4 §1.1 routes 046-049)。パック/テンプレは
// append-only(ihl.theme.pack.v1 / ihl.ui.template.v1)を Truth へ追記、一覧/系譜/投票
// 集計は投影で都度再計算(常駐 DB 禁止＝不変条項①)。全 route PROTECTED(index.ts が
// gate・actorId を set)。書込 data.actor_id はセッション principal で強制刻印(V3-AUT-17)。
// 投票は新 route を作らず既存 POST /events(ihl.ui.vote.v1)へ投げる(matrix 57 行凍結)。
// 冪等は本モジュールの projectTemplateVotes 側 distinct(actor,target,kind) dedup で担保
// (storage 409 に依存しない＝批評家修正2)。
import { Hono } from "hono";
import { TruthStore, ulid } from "@ihl/truth";
import type { Bindings, Variables } from "./env";
import { ADOPTION_PLATINUM_THRESHOLD, ADOPTION_USAGE_THRESHOLD } from "./ui-constants";
import minimalLight from "../../../theme-packs/minimal-light.json";
import minimalDark from "../../../theme-packs/minimal-dark.json";

const PACK_TYPE = "ihl.theme.pack.v1";
const PACK_SCHEMA = "schemas/events/theme-pack.schema.json";
const TEMPLATE_TYPE = "ihl.ui.template.v1";
const TEMPLATE_SCHEMA = "schemas/events/ui-template.schema.json";
const VOTE_TYPE = "ihl.ui.vote.v1";
const PREF_TYPE = "ihl.pref.set.v1";
const SCHEMA_VERSION = "1";

// built-in 2 パックは JSON ファイル直配信(envelope 検証外・lineage 終端)。
const BUILTIN_PACKS = [minimalLight, minimalDark] as unknown as Record<string, unknown>[];

export const themeRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function store(c: { env: Bindings }): TruthStore {
  return new TruthStore(c.env.TRUTH);
}
function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

// 一覧投影: built-in 2 + ユーザー fork(ihl.theme.pack.v1 prefix scan)。
// ponytail: pack-type 全走査 O(n)。MVP 量なら十分(design-c2 §3.1)。
export async function listThemePacks(store: TruthStore): Promise<Record<string, unknown>[]> {
  const forks = (await store.listEvents(`truth/${PACK_TYPE}/`)).map(dataOf);
  return [...BUILTIN_PACKS, ...forks];
}

// 系譜投影: parent_pack_id を built-in 到達まで辿り lineage[](自身→…→built-in)を返す。
// cycle は seen で防御(壊れた parent 参照でも無限ループしない)。
export async function packLineage(store: TruthStore, packId: string): Promise<string[]> {
  const all = await listThemePacks(store);
  const byId = new Map(all.map((p) => [String(p.pack_id), p]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: Record<string, unknown> | undefined = byId.get(packId);
  while (cur && !seen.has(String(cur.pack_id))) {
    seen.add(String(cur.pack_id));
    chain.push(String(cur.pack_id));
    const parent = typeof cur.parent_pack_id === "string" ? cur.parent_pack_id : undefined;
    if (!parent) break;
    const next = byId.get(parent);
    if (!next) {
      // parent が一覧に無い(dangling slug)場合も系譜終端として記録。
      chain.push(parent);
      break;
    }
    cur = next;
  }
  return chain;
}

// 投票集計投影: target_id 一致の ihl.ui.vote.v1 を distinct(actor,target,kind) へ dedup
// してから vote_kind 別に集計。usage_count は当該 template を選んだ distinct actor 数。
// 二重投票(同一 actor/target/kind)は 1 票に畳まれる(storage 409 に依存しない＝批評家修正2)。
// 投票者の同一性は POST /events が強制刻印する provenance.actor_id(セッション principal・
// un-forgeable)で判定する。data.actor_id は client 提供で偽装可能なため、採用昇格を左右する
// 票の水増しを防ぐ意図(provenance 空なら data.actor_id へ fallback)。
export async function projectTemplateVotes(store: TruthStore, templateId: string) {
  const votes = (await store.listEvents(`truth/${VOTE_TYPE}/`)).filter(
    (e) => dataOf(e).target_id === templateId,
  );
  const seen = new Set<string>();
  let likes = 0;
  let platinum = 0;
  for (const e of votes) {
    const d = dataOf(e);
    const prov = (e.provenance ?? {}) as Record<string, unknown>;
    const actor = typeof prov.actor_id === "string" ? prov.actor_id : String(d.actor_id);
    const key = [actor, d.target_id, d.vote_kind].join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    if (d.vote_kind === "like") likes++;
    else if (d.vote_kind === "platinum") platinum++;
  }
  // usage の actor も vote ループ(line 82)と同じく偽装不能な provenance.actor_id 優先で数える
  // (data.actor_id は client 提供 — 採用昇格閾値の水増し防止・批評家指摘反映)。
  const usageActors = new Set(
    (await store.listEvents(`truth/${PREF_TYPE}/`))
      .filter((e) => dataOf(e).template_id === templateId)
      .map((e) => {
        const prov = (e.provenance ?? {}) as Record<string, unknown>;
        return typeof prov.actor_id === "string" ? prov.actor_id : String(dataOf(e).actor_id);
      }),
  );
  const usage_count = usageActors.size;
  const adoption_candidate =
    platinum >= ADOPTION_PLATINUM_THRESHOLD || usage_count >= ADOPTION_USAGE_THRESHOLD;
  return { likes, platinum, usage_count, adoption_candidate };
}

function envelope(id: string, type: string, dataschema: string, actorId: string, data: Record<string, unknown>) {
  return {
    specversion: "1.0",
    id,
    source: "apps/api",
    type,
    time: new Date().toISOString(),
    dataschema,
    provenance: { generator_kind: "human", actor_id: actorId },
    data,
  };
}

// GET /theme-packs(046)— built-in 2 + user fork。
themeRoutes.get("/theme-packs", async (c) => {
  return c.json({ theme_packs: await listThemePacks(store(c)) });
});

// GET /theme-packs/{pack_id}(047)— tokens + 継承チェーン lineage[]。
themeRoutes.get("/theme-packs/:pack_id", async (c) => {
  const packId = c.req.param("pack_id");
  const pack = (await listThemePacks(store(c))).find((p) => String(p.pack_id) === packId);
  if (!pack) return c.json({ error: "NOT_FOUND" }, 404);
  return c.json({ pack, lineage: await packLineage(store(c), packId) });
});

// POST /theme-packs(049)— fork 含むパック作成を append。pack_id は client 任意 ULID
// (envelope.id・省略時 ulid())・同一 ULID 再 POST は put-if-absent で storage 409。
// body を通す: mode enum 外・tokens 欠落・余剰キーは schema 検証で 400(批評家修正3)。
themeRoutes.post("/theme-packs", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ error: "INVALID_THEME_PACK", details: ["body required"] }, 400);
  }
  const actorId = c.get("actorId");
  const packId = typeof body.pack_id === "string" && body.pack_id ? body.pack_id : ulid();
  const data: Record<string, unknown> = {
    ...body,
    pack_id: packId,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent(envelope(packId, PACK_TYPE, PACK_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_THEME_PACK", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_THEME_PACK", key: res.key }, 409);
  return c.json({ pack_id: packId }, 201);
});

// POST /builder/canvas(048)— UI/OS テンプレを node として保存/fork(ihl.ui.template.v1)。
// template_id は client 任意 ULID(省略時 ulid())・同一 ULID 再 POST は storage 409。
// social 未指定は {} 既定。level enum 外・余剰キーは schema 検証で 400。
themeRoutes.post("/builder/canvas", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return c.json({ error: "INVALID_TEMPLATE", details: ["body required"] }, 400);
  }
  const actorId = c.get("actorId");
  const templateId = typeof body.template_id === "string" && body.template_id ? body.template_id : ulid();
  const data: Record<string, unknown> = {
    social: {},
    ...body,
    template_id: templateId,
    actor_id: actorId,
    created_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
  };
  const res = await store(c).putEvent(envelope(templateId, TEMPLATE_TYPE, TEMPLATE_SCHEMA, actorId, data));
  if (res.status === "invalid") return c.json({ error: "INVALID_TEMPLATE", details: res.errors }, 400);
  if (res.status === "conflict") return c.json({ error: "DUPLICATE_TEMPLATE", key: res.key }, 409);
  return c.json({ template_id: templateId }, 201);
});
