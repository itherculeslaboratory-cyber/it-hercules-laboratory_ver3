// FND-21 AI kernel TC (design-k7 §3). Proves the DI seam: a mock LLMClient injected
// via the createAiRoutes factory is reached through the A90 route (POST /ai/:task),
// and the default (env-driven, no provider) reports 501 AI_DISABLED. LLM stays OFF —
// no real provider is called (invariant ①). ASCII test names.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAiRoutes, AI_TASKS, type LLMClient } from "../apps/api/src/ai-kernel";
import type { Bindings, Variables } from "../apps/api/src/env";

const JSON_HEADERS = { "content-type": "application/json" };

function mount(makeClient?: (env: Bindings) => LLMClient) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.route("/api/v1", makeClient ? createAiRoutes(makeClient) : createAiRoutes());
  return app;
}
function post(app: Hono<{ Bindings: Bindings; Variables: Variables }>, path: string, body: unknown, env: object = {}) {
  return app.request(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }, env);
}

describe("FND-21 A90 AI task route", () => {
  it("injected mock LLMClient is reached via A90 (DI seam)", async () => {
    // The mock captures the request and returns a deterministic string; if the route
    // reached the injected client, we see that string echoed as output.
    let seen: { task: string; input: unknown } | null = null;
    const mockClient: LLMClient = {
      complete: async (req) => {
        seen = req;
        return { text: `mock:${req.task}` };
      },
    };
    const app = mount(() => mockClient);

    const res = await post(app, "/api/v1/ai/translate", { q: "hello" }, { IHL_AI_PROVIDER: "mock" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task: "translate", output: "mock:translate" });
    expect(seen).toEqual({ task: "translate", input: { q: "hello" } });
  });

  it("default (no provider) returns 501 AI_DISABLED, never a fabricated answer", async () => {
    const app = mount(); // real makeLLMClient, IHL_AI_PROVIDER unset -> disabled
    for (const task of AI_TASKS) {
      const res = await post(app, `/api/v1/ai/${task}`, { q: "x" });
      expect(res.status, task).toBe(501);
      expect(await res.json()).toEqual({ error: "AI_DISABLED", task });
    }
  });

  it("unknown task -> 404 (routing error, distinct from disabled)", async () => {
    const app = mount(() => ({ complete: async () => ({ text: "should not be called" }) }));
    const res = await post(app, "/api/v1/ai/bogus", { q: "x" }, { IHL_AI_PROVIDER: "mock" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "UNKNOWN_AI_TASK", task: "bogus" });
  });
});
