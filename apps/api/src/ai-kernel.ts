// FND-21 AI kernel (design-k7 §1.3/§1.5). LLM stays OFF by default (invariant ①):
// with IHL_AI_PROVIDER unset the client is DISABLED and every task returns 501
// AI_DISABLED — a real disabled state, NOT a "未実装" placeholder. Wiring a real
// provider (LocalAI/OpenAI) needs a real key, which is a human gate; this module
// never calls one.
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";

// Recognized AI task verbs (design §1.5). :task outside this set → 404 unknown task
// (a routing error), distinct from 501 AI_DISABLED (a recognized task, provider off).
export const AI_TASKS = ["translate", "summarize", "search", "generate", "classify"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export type LLMRequest = { task: AiTask; input: unknown };
export interface LLMClient {
  complete(req: LLMRequest): Promise<{ text: string }>;
}

// Thrown by a disabled client; the A90 route maps it to 501 AI_DISABLED.
export class AiDisabledError extends Error {
  constructor() {
    super("AI_DISABLED");
    this.name = "AiDisabledError";
  }
}

// DI factory (default). Only state today: DISABLED. IHL_AI_PROVIDER may name a
// provider but a real key is a human gate (invariant ①: LLM OFF) — no real client
// is wired, so complete() throws AI_DISABLED rather than fabricate output. Real
// provider dispatch is defer; the upgrade path is this factory + a client class.
export function makeLLMClient(_env: Bindings): LLMClient {
  return { complete: async () => { throw new AiDisabledError(); } };
}

function isAiTask(t: string): t is AiTask {
  return (AI_TASKS as readonly string[]).includes(t);
}

// A90 route factory. `makeClient` is the DI seam: index.ts mounts the default
// (env-driven, disabled); tests mount a mock factory to prove function-level swap.
export function createAiRoutes(makeClient: (env: Bindings) => LLMClient = makeLLMClient) {
  const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  // POST /api/v1/ai/:task — run one AI task. Protected (deny-by-default in index.ts).
  ai.post("/ai/:task", async (c) => {
    const task = c.req.param("task");
    if (!isAiTask(task)) return c.json({ error: "UNKNOWN_AI_TASK", task }, 404);
    const input = await c.req.json().catch(() => ({}));
    try {
      const { text } = await makeClient(c.env).complete({ task, input });
      return c.json({ task, output: text });
    } catch (e) {
      if (e instanceof AiDisabledError) return c.json({ error: "AI_DISABLED", task }, 501);
      throw e;
    }
  });
  return ai;
}

// Default instance wired in index.ts (env-driven → disabled until human gate).
export const aiRoutes = createAiRoutes();
