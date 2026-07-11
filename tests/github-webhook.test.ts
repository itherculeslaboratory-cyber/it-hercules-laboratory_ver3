// KRM-13 GitHub webhook TC（design-k3 §4）。HMAC 不正署名拒否・同一 delivery_id 再送
// べき等（409）・config weights が換算に反映（ハードコードでない）。session 層 public
// （認証ヘッダなし）+ HMAC self-gate。
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import { TruthStore } from "@ihl/truth";
import { weightForEvent } from "../apps/api/src/github-webhook-routes";
import { FakeR2Bucket, makeEnv } from "./helpers";

const SECRET = "whsec_test";
const weightsConfig = JSON.parse(
  readFileSync(new URL("../config/github-contribution-weights.json", import.meta.url), "utf8"),
) as { weights: Record<string, { pt: number; axis: string }> };

function sign(body: string): string {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}
function env(bucket: FakeR2Bucket) {
  return { ...makeEnv(bucket), GITHUB_WEBHOOK_SECRET: SECRET };
}
function post(bucket: FakeR2Bucket, body: string, headers: Record<string, string>) {
  return app.request("/api/v1/github/webhook", { method: "POST", headers, body }, env(bucket));
}

const PR_BODY = JSON.stringify({ sender: { login: "octocat" }, repository: { full_name: "ihl/comp" } });

describe("KRM-13 weightForEvent（config 換算・ゆらぎ吸収）", () => {
  it("既知イベントは config の pt/axis を返す・未登録は null", () => {
    const w = weightForEvent("pull_request");
    expect(w).not.toBeNull();
    expect(w!.pt).toBe(weightsConfig.weights.pull_request.pt);
    expect(w!.axis).toBe(weightsConfig.weights.pull_request.axis);
    expect(weightForEvent("issues")!.pt).toBe(weightsConfig.weights.issue.pt); // alias
    expect(weightForEvent("ping")).toBeNull();
  });
});

describe("POST /api/v1/github/webhook", () => {
  it("署名不正は 401（何も保存しない）", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, PR_BODY, {
      "content-type": "application/json",
      "X-Hub-Signature-256": "sha256=deadbeef",
      "X-GitHub-Delivery": "d1",
      "X-GitHub-Event": "pull_request",
    });
    expect(res.status).toBe(401);
    expect(bucket.objects.size).toBe(0);
  });

  it("署名欠如は 401", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, PR_BODY, {
      "content-type": "application/json",
      "X-GitHub-Delivery": "d1",
      "X-GitHub-Event": "pull_request",
    });
    expect(res.status).toBe(401);
  });

  it("正署名 pull_request → 201・contribution.delta は config の pt を反映", async () => {
    const bucket = new FakeR2Bucket();
    const res = await post(bucket, PR_BODY, {
      "content-type": "application/json",
      "X-Hub-Signature-256": sign(PR_BODY),
      "X-GitHub-Delivery": "deliv-1",
      "X-GitHub-Event": "pull_request",
    });
    expect(res.status).toBe(201);
    const stored = await new TruthStore(bucket).readEvent(
      "truth/ihl.economy.contribution_event.v1/gh-deliv-1.json",
    );
    const data = (stored!.data ?? {}) as Record<string, unknown>;
    expect(data.delta).toBe(weightsConfig.weights.pull_request.pt); // 換算が config 由来
    expect(data.axis).toBe(weightsConfig.weights.pull_request.axis);
    expect(data.actor_id).toBe("github:octocat");
    expect(data.source).toBe("github");
  });

  it("同一 delivery_id 再送はべき等（409・二重加算しない）", async () => {
    const bucket = new FakeR2Bucket();
    const headers = {
      "content-type": "application/json",
      "X-Hub-Signature-256": sign(PR_BODY),
      "X-GitHub-Delivery": "dup-1",
      "X-GitHub-Event": "pull_request",
    };
    expect((await post(bucket, PR_BODY, headers)).status).toBe(201);
    expect((await post(bucket, PR_BODY, headers)).status).toBe(409); // 再送
    // contribution イベントは 1 件のみ。
    const evs = [...bucket.objects.keys()].filter((k) => k.startsWith("truth/ihl.economy.contribution_event.v1/"));
    expect(evs).toHaveLength(1);
  });

  it("ping/未換算イベントは 200 ignored（保存しない）", async () => {
    const bucket = new FakeR2Bucket();
    const body = JSON.stringify({ zen: "keep it simple" });
    const res = await post(bucket, body, {
      "content-type": "application/json",
      "X-Hub-Signature-256": sign(body),
      "X-GitHub-Delivery": "ping-1",
      "X-GitHub-Event": "ping",
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ignored: boolean }).toMatchObject({ ignored: true });
    expect(bucket.objects.size).toBe(0);
  });
});
