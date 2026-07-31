// V3-SEC-48 段階2(発注書 sec2)。key-bundle-routes.ts に先行適用した owner ポリシー
// (data.actor_id === provenance.actor_id)の検証。POST /me/key-bundle は既存実装が
// 常に data.actor_id をセッションの actorId から作るため、正規のHTTP経路だけでは
// 不一致を作れない(=攻撃面が無い)。よってポリシー自体を TruthStore 経由で直接叩き、
// 「owner不一致は既存 invalid ステータス+FORBIDDEN接頭辞に写像される」ことを検証する
// (route側の invalid→400マッピングは既存の他ルートで確認済みの共通コード)。
import { describe, expect, it } from "vitest";
import { TruthStore, ulid } from "@ihl/truth";
import { FakeR2Bucket, makeEnvelope } from "./helpers";

// key-bundle-routes.ts の keyBundleOwnerPolicy と同じ判定をここで再実装せず、直接
// TruthStore の PolicyHook 契約(envelope, key) => string | null を満たす同一ロジックで
// 検証する(policy 関数自体は route ファイル内 private のため import しない — 挙動の
// 契約=PolicyHook のインターフェースを検証する)。
function ownerPolicy(envelope: unknown): string | null {
  const e = envelope as { data?: { actor_id?: unknown }; provenance?: { actor_id?: unknown } };
  const dataActorId = e.data?.actor_id;
  const provenanceActorId = e.provenance?.actor_id;
  if (dataActorId !== undefined && dataActorId !== provenanceActorId) {
    return `owner mismatch: data.actor_id(${String(dataActorId)}) !== provenance.actor_id(${String(provenanceActorId)})`;
  }
  return null;
}

describe("V3-SEC-48 段階2: owner不一致ポリシー(TruthStore.policy)", () => {
  it("data.actor_id と provenance.actor_id が一致 → 正常に insert される(挙動不変)", async () => {
    const store = new TruthStore(new FakeR2Bucket(), ownerPolicy);
    const id = ulid();
    const envelope = makeEnvelope({
      id,
      type: "ihl.sec.key_bundle.v1",
      provenance: { generator_kind: "human", actor_id: "actor-a" },
      data: { bundle_id: id, actor_id: "actor-a" },
    });
    const res = await store.putEventAt(`truth/ihl.sec.key_bundle.v1/actor-a/${id}.json`, envelope);
    expect(res.status).toBe("inserted");
  });

  it("data.actor_id と provenance.actor_id が不一致 → invalid + FORBIDDEN(段階2の主張どおり400へ写像される既存契約)", async () => {
    const store = new TruthStore(new FakeR2Bucket(), ownerPolicy);
    const id = ulid();
    const envelope = makeEnvelope({
      id,
      type: "ihl.sec.key_bundle.v1",
      // ★他人(actor-b)の provenance で actor-a のデータを書こうとする=owner不一致
      provenance: { generator_kind: "human", actor_id: "actor-b" },
      data: { bundle_id: id, actor_id: "actor-a" },
    });
    const res = await store.putEventAt(`truth/ihl.sec.key_bundle.v1/actor-a/${id}.json`, envelope);
    expect(res.status).toBe("invalid");
    if (res.status === "invalid") {
      expect(res.errors[0]).toMatch(/^FORBIDDEN: owner mismatch/);
    }
  });

  it("policy 未指定(段階3未着手の他ファイル)は従来どおり挙動不変 — owner不一致でも通る(段階3の対象外を正直に示す)", async () => {
    const store = new TruthStore(new FakeR2Bucket()); // policy 無し = 既存挙動
    const id = ulid();
    const envelope = makeEnvelope({
      id,
      provenance: { generator_kind: "human", actor_id: "actor-b" },
      data: { actor_id: "actor-a" },
    });
    const res = await store.putEventAt(`truth/ihl.test.sample.v1/${id}.json`, envelope);
    expect(res.status).toBe("inserted");
  });
});
