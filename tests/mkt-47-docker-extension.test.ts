// V3-MKT-47 Docker観測拡張のフォーク管理(parent_extension_id/lineage_hash/content_hash)。
// 実行基盤(デモ起動)は本要件の対象外(V3-SEC-45裁定待ち)・ここは既存の汎用フォーク基盤
// (plaza-routes.ts POST/GET /plaza/forks・POST/GET /plaza/signals・GET /plaza/ranking)を
// target_type=docker_extension/world_template で再利用できることを検証する(lineage記録のみ)。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { sha256Hex } from "../apps/api/src/plaza-routes";
import { AUTH_HEADERS, FakeR2Bucket, makeEnv } from "./helpers";

function postJson(env: ReturnType<typeof makeEnv>, path: string, body: Record<string, unknown>) {
  return app.request(path, { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) }, env);
}

describe("V3-MKT-47 docker_extension フォーク管理(汎用 plaza-fork 基盤の再利用)", () => {
  it("親拡張(parent_extension_id=forked_from) + content_hash + lineage_hash を append できる", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const contentHash = await sha256Hex("docker-extension-v1-content");
    const lineageHash = await sha256Hex(`GENESIS:${contentHash}`);
    const parent = (
      await (
        await postJson(env, "/api/v1/plaza/forks", {
          target_type: "docker_extension",
          forked_from: "root",
          visibility: "public",
          title: "温度観測拡張(親)",
          content_hash: contentHash,
          lineage_hash: lineageHash,
        })
      ).json()
    ) as { fork_id: string };

    const detail = (
      await (await app.request(`/api/v1/plaza/forks/${parent.fork_id}`, { headers: AUTH_HEADERS }, env)).json()
    ) as { fork: { target_type: string; content_hash: string; lineage_hash: string } };
    expect(detail.fork.target_type).toBe("docker_extension");
    expect(detail.fork.content_hash).toBe(contentHash);
    expect(detail.fork.lineage_hash).toBe(lineageHash);

    // 子フォーク: parent_extension_id は forked_from に親の fork_id を渡す。
    const childContentHash = await sha256Hex("docker-extension-v1-content-fork2");
    const childLineageHash = await sha256Hex(`${lineageHash}:${childContentHash}`);
    const child = (
      await (
        await postJson(env, "/api/v1/plaza/forks", {
          target_type: "docker_extension",
          forked_from: parent.fork_id,
          visibility: "public",
          title: "温度観測拡張(fork)",
          content_hash: childContentHash,
          lineage_hash: childLineageHash,
        })
      ).json()
    ) as { fork_id: string };

    // GET /plaza/forks?target_type=docker_extension&forked_from=<parent> でカード探索できる。
    const listed = (
      await (
        await app.request(
          `/api/v1/plaza/forks?target_type=docker_extension&forked_from=${parent.fork_id}`,
          { headers: AUTH_HEADERS },
          env,
        )
      ).json()
    ) as { forks: { fork_id: string }[] };
    expect(listed.forks.map((f) => f.fork_id)).toContain(child.fork_id);
  });

  it("いいね(signal)+フォーク数がランキングに反映される(target_type=docker_extension)", async () => {
    const bucket = new FakeR2Bucket();
    const env = makeEnv(bucket);
    const parent = (
      await (
        await postJson(env, "/api/v1/plaza/forks", {
          target_type: "docker_extension",
          forked_from: "root",
          visibility: "public",
          title: "湿度観測拡張",
        })
      ).json()
    ) as { fork_id: string };

    await postJson(env, "/api/v1/plaza/signals", {
      target_type: "docker_extension",
      target_id: parent.fork_id,
      signal: "like",
    });
    await postJson(env, "/api/v1/plaza/forks", {
      target_type: "docker_extension",
      forked_from: parent.fork_id,
      visibility: "public",
      title: "湿度観測拡張(fork)",
    });

    const ranking = (
      await (await app.request("/api/v1/plaza/ranking?target_type=docker_extension", { headers: AUTH_HEADERS }, env)).json()
    ) as { ranking: { target_id: string; score: number; breakdown: Record<string, number> }[] };
    const row = ranking.ranking.find((r) => r.target_id === parent.fork_id);
    expect(row).toBeDefined();
    expect(row!.breakdown.like).toBe(1);
  });

  it("world_template も同じ target_type enum で登録できる(デモ起動自体は対象外)", async () => {
    const env = makeEnv(new FakeR2Bucket());
    const res = await postJson(env, "/api/v1/plaza/forks", {
      target_type: "world_template",
      forked_from: "root",
      visibility: "public",
      title: "外部世界テンプレート",
    });
    expect(res.status).toBe(201);
  });
});
