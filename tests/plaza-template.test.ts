// V3-WIK-32 — テンプレートFork(公開・進化対象)/コピー(個人・非公開)+ 系譜可視化。
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { plazaTemplateRoutes } from "../apps/api/src/plaza-template-routes";
import { makeEnv } from "./helpers";

function appAs(actorId: string) {
  const app = new Hono<{ Bindings: ReturnType<typeof makeEnv>; Variables: { actorId: string } }>();
  app.use("*", async (c, next) => { c.set("actorId", actorId); await next(); });
  app.route("/api/v1", plazaTemplateRoutes);
  return app;
}
function post(app: Hono, path: string, body: Record<string, unknown>, env: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
}

describe("V3-WIK-32 template fork/copy", () => {
  it("rejects an unknown kind", async () => {
    const env = makeEnv();
    const res = await post(appAs("alice"), "/api/v1/plaza/templates", { kind: "not_a_kind", title: "t" }, env);
    expect(res.status).toBe(400);
  });

  it("creates a root template (public by default)", async () => {
    const env = makeEnv();
    const res = await post(appAs("alice"), "/api/v1/plaza/templates", { kind: "research_note", title: "研究ノート雛形" }, env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { operation: string; visibility: string };
    expect(body.operation).toBe("root");
    expect(body.visibility).toBe("public");
  });

  it("fork stays public and links forked_from; copy is private", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const root = (await (await post(alice, "/api/v1/plaza/templates", { kind: "qr_label", title: "QR雛形" }, env)).json()) as { template_id: string };

    const bob = appAs("bob");
    const forked = (await (await post(bob, `/api/v1/plaza/templates/${root.template_id}/fork`, {}, env)).json()) as {
      operation: string; visibility: string; forked_from: string;
    };
    expect(forked.operation).toBe("fork");
    expect(forked.visibility).toBe("public");
    expect(forked.forked_from).toBe(root.template_id);

    const copied = (await (await post(bob, `/api/v1/plaza/templates/${root.template_id}/copy`, {}, env)).json()) as {
      operation: string; visibility: string;
    };
    expect(copied.operation).toBe("copy");
    expect(copied.visibility).toBe("private");
  });

  it("lineage walks the fork chain (root -> fork -> fork) but is unaffected by copies", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const root = (await (await post(alice, "/api/v1/plaza/templates", { kind: "scale_paper", title: "root" }, env)).json()) as { template_id: string };
    const f1 = (await (await post(alice, `/api/v1/plaza/templates/${root.template_id}/fork`, { title: "f1" }, env)).json()) as { template_id: string };
    const f2 = (await (await post(alice, `/api/v1/plaza/templates/${f1.template_id}/fork`, { title: "f2" }, env)).json()) as { template_id: string };

    const lineage = (await (await alice.request(`/api/v1/plaza/templates/${f2.template_id}/lineage`, {}, env)).json()) as {
      chain: { template_id: string }[];
    };
    expect(lineage.chain.map((t) => t.template_id)).toEqual([root.template_id, f1.template_id, f2.template_id]);
  });

  it("public listing excludes private copies", async () => {
    const env = makeEnv();
    const alice = appAs("alice");
    const root = (await (await post(alice, "/api/v1/plaza/templates", { kind: "ai_settings_pack", title: "pack" }, env)).json()) as { template_id: string };
    await post(alice, `/api/v1/plaza/templates/${root.template_id}/copy`, {}, env);
    const list = (await (await alice.request("/api/v1/plaza/templates", {}, env)).json()) as { templates: { visibility: string }[] };
    expect(list.templates.every((t) => t.visibility === "public")).toBe(true);
  });
});
