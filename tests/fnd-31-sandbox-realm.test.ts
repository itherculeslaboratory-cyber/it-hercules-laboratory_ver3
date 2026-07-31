// V3-FND-31 — Personal Sandbox Realm 本体(w-fnd2)。sandbox-routes.ts(V3-SEC-45・
// w1-sec所有)とは無関係の別モジュールなので混同しないこと。
import { describe, expect, it } from "vitest";
import { TruthStore } from "@ihl/truth";
import { FakeR2Bucket } from "./helpers";
import {
  forkRealm,
  listUserRealms,
  writeDiffTemplate,
  previewApply,
  promoteRealm,
  deleteRealm,
  MAX_REALMS_PER_USER,
  RealmLimitExceededError,
  RealmNotFoundError,
  RealmPromoteForbiddenError,
} from "../apps/api/src/sandbox-realm-routes";

describe("V3-FND-31 forkRealm", () => {
  it("forks a realm under sandbox/{user}/{realm}/ and records a 'forked' Truth event", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      forkedFromVersion: "v3",
      worldConfigContent: { flagA: true },
      now: new Date("2026-08-01T00:00:00Z"),
    });
    expect(realm.user_id).toBe("u1");
    expect(realm.active).toBe(true);

    const configKey = [...bucket.objects.keys()].find((k) => k.startsWith(`sandbox/u1/${realm.realm_id}/`));
    expect(configKey).toBe(`sandbox/u1/${realm.realm_id}/config.json`);

    const list = await listUserRealms(s, "u1");
    expect(list).toHaveLength(1);
    expect(list[0].forked_from_version).toBe("v3");
  });

  it("rejects the 6th realm for a non-admin user (5/user cap)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < MAX_REALMS_PER_USER; i++) {
      await forkRealm(s, bucket, {
        userId: "u1",
        isAdmin: false,
        worldConfigKey: "feature-flags",
        worldConfigContent: {},
        now: new Date("2026-08-01T00:00:00Z"),
      });
    }
    await expect(
      forkRealm(s, bucket, {
        userId: "u1",
        isAdmin: false,
        worldConfigKey: "feature-flags",
        worldConfigContent: {},
        now: new Date("2026-08-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(RealmLimitExceededError);
  });

  it("admins are not subject to the 5-realm cap", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    for (let i = 0; i < MAX_REALMS_PER_USER + 2; i++) {
      const realm = await forkRealm(s, bucket, {
        userId: "admin1",
        isAdmin: true,
        worldConfigKey: "feature-flags",
        worldConfigContent: {},
        now: new Date("2026-08-01T00:00:00Z"),
      });
      expect(realm.realm_id).toBeTruthy();
    }
    const list = await listUserRealms(s, "admin1");
    expect(list).toHaveLength(MAX_REALMS_PER_USER + 2);
  });

  it("a deleted realm frees up a cap slot", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realms = [];
    for (let i = 0; i < MAX_REALMS_PER_USER; i++) {
      realms.push(
        await forkRealm(s, bucket, {
          userId: "u1",
          isAdmin: false,
          worldConfigKey: "feature-flags",
          worldConfigContent: {},
          now: new Date("2026-08-01T00:00:00Z"),
        }),
      );
    }
    await deleteRealm(s, realms[0].realm_id, "u1", new Date("2026-08-02T00:00:00Z"));
    const afterDelete = await listUserRealms(s, "u1");
    expect(afterDelete.filter((r) => r.active)).toHaveLength(MAX_REALMS_PER_USER - 1);

    const newRealm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      worldConfigContent: {},
      now: new Date("2026-08-03T00:00:00Z"),
    });
    expect(newRealm.active).toBe(true);
  });
});

describe("V3-FND-31 world/ isolation (blast radius zero)", () => {
  it("forkRealm/writeDiffTemplate/deleteRealm never write to world/ (only promoteRealm may)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      worldConfigContent: { flagA: true },
      now: new Date("2026-08-01T00:00:00Z"),
    });
    await writeDiffTemplate(
      bucket,
      "u1",
      realm.realm_id,
      { diff: { flagA: false }, base_version: "v3", author_id: "u1", schema_version: "1" },
      new Date("2026-08-01T01:00:00Z"),
    );
    await deleteRealm(s, realm.realm_id, "u1", new Date("2026-08-01T02:00:00Z"));

    const worldKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("world/"));
    expect(worldKeys).toEqual([]);
  });

  it("promoteRealm is the only path that writes to world/, and only for role=administrator", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      worldConfigContent: { flagA: true },
      now: new Date("2026-08-01T00:00:00Z"),
    });

    const result = await promoteRealm(s, bucket, {
      realmId: realm.realm_id,
      userId: "u1",
      actorRole: "administrator",
      worldConfigKey: "feature-flags",
      now: new Date("2026-08-02T00:00:00Z"),
    });
    expect(result.world_key.startsWith("world/feature-flags/")).toBe(true);
    const worldKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("world/"));
    expect(worldKeys).toHaveLength(1);

    const list = await listUserRealms(s, "u1");
    expect(list[0].promoted).toBe(true);
  });

  it("rejects promote for a non-administrator role", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      worldConfigContent: {},
      now: new Date("2026-08-01T00:00:00Z"),
    });
    await expect(
      promoteRealm(s, bucket, {
        realmId: realm.realm_id,
        userId: "u1",
        actorRole: "operator",
        worldConfigKey: "feature-flags",
        now: new Date("2026-08-02T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(RealmPromoteForbiddenError);
  });

  it("promote does not overwrite prior world/ versions (history is preserved)", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    const realm = await forkRealm(s, bucket, {
      userId: "u1",
      isAdmin: false,
      worldConfigKey: "feature-flags",
      worldConfigContent: { flagA: true },
      now: new Date("2026-08-01T00:00:00Z"),
    });
    await promoteRealm(s, bucket, {
      realmId: realm.realm_id,
      userId: "u1",
      actorRole: "administrator",
      worldConfigKey: "feature-flags",
      now: new Date("2026-08-02T00:00:00Z"),
    });
    await promoteRealm(s, bucket, {
      realmId: realm.realm_id,
      userId: "u1",
      actorRole: "administrator",
      worldConfigKey: "feature-flags",
      now: new Date("2026-08-03T00:00:00Z"),
    });
    const worldKeys = [...bucket.objects.keys()].filter((k) => k.startsWith("world/"));
    expect(worldKeys).toHaveLength(2); // 2回 promote = 2バージョン、旧版は消えない
  });

  it("promoteRealm throws RealmNotFoundError for an unknown realm", async () => {
    const bucket = new FakeR2Bucket();
    const s = new TruthStore(bucket);
    await expect(
      promoteRealm(s, bucket, {
        realmId: "nope",
        userId: "u1",
        actorRole: "administrator",
        worldConfigKey: "feature-flags",
        now: new Date(),
      }),
    ).rejects.toBeInstanceOf(RealmNotFoundError);
  });
});

describe("V3-FND-31 previewApply (diff preview, pure function)", () => {
  it("returns a shallow-merged preview without writing anything", () => {
    const preview = previewApply({ flagA: true, flagB: false }, { flagA: false });
    expect(preview).toEqual({ flagA: false, flagB: false });
  });
});
