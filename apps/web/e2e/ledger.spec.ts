import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// V3-AIP-49 — ledger 実 UI E2E. Same harness as market.spec / observation.spec:
// dev-login → ScreenDef Renderer draws the REAL ledger screen-def → the ledger
// view (and any declared entry form) is exercised against the worker's local R2
// (wrangler dev local mode = in-memory R2 = the E2E FakeR2). The ledger is
// append-only Truth (CL-12): a recorded entry never mutates, only accrues.
//
// DEPENDENCY GATE (design-k8 §5 / 批評家 F3): render target is the K4 ledger
// screen-def (screen-defs/ledger.json). K8 owns the harness, not the screen-def.
// Skips + stop-reports until K4 publishes ledger.json — symmetric with
// market.spec.ts / spec-thread.test.ts.

const WEB = "http://127.0.0.1:3000";
const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const LEDGER_DEF = resolve(SPEC_DIR, "..", "..", "..", "screen-defs", "ledger.json");
const READY = existsSync(LEDGER_DEF);

if (!READY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[STOP] ledger.spec.ts skipped: K4 render target screen-defs/ledger.json not produced yet " +
      "(design-k8 §5 dependency gate). Harness + FakeR2 mock ready; wires automatically when K4 lands.",
  );
}

type Node = { id: string; type: string; props?: Record<string, unknown>; action?: Record<string, unknown>; children?: Node[] };

function flatten(def: { nodes: Node[] }): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of def.nodes) walk(n);
  return out;
}

async function devLogin(page: Page): Promise<void> {
  await page.goto(`${WEB}/s/login`);
  await page.getByRole("button", { name: "開発トークンでログイン" }).click();
  await expect(page.getByRole("heading", { name: "観測ホーム" })).toBeVisible();
}

async function fillDeclaredForm(page: Page, form: Node, stamp: string): Promise<void> {
  for (const f of (form.children ?? []).filter((c) => c.type === "field")) {
    const label = (f.props?.label as string) ?? "";
    if (!label) continue;
    const variant = (f.props?.variant as string) ?? "text";
    const control = page.getByLabel(label);
    if (variant === "select") await control.selectOption({ index: 1 });
    else if (variant === "number") await control.fill("1");
    else await control.fill(`${label}-${stamp}`);
  }
}

test("ledger screen-def renders and its append-only entries load through the Renderer", async ({ page }) => {
  test.skip(!READY, "K4 render target screen-defs/ledger.json not produced yet (design-k8 §5)");

  const def = JSON.parse(readFileSync(LEDGER_DEF, "utf8")) as { screen_id: string; route: string; title: string; nodes: Node[] };
  const nodes = flatten(def);
  const form = nodes.find((n) => n.type === "form");
  const list = nodes.find((n) => n.type === "list");
  const stamp = Date.now().toString(36);

  await devLogin(page);

  // 実 UI: Renderer serves screens at /s/<screen_id> (observation.spec convention).
  await page.goto(`${WEB}/s/${def.screen_id}`);
  await expect(page.getByRole("heading", { name: def.title })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // 保存 (read-through): the ledger's own read endpoint returns 200 from real
  // Truth via the same-origin session cookie — the projection recomputes, not a
  // mock. A ledger is primarily a view; the read-back is the invariant.
  expect(list?.props?.source_path, "ledger screen-def must declare a read source").toBeTruthy();
  const src = list!.props!.source_path as string;
  const status = await page.evaluate(async (p: string) => {
    const r = await fetch(p, { credentials: "include" });
    return r.status;
  }, src);
  expect(status).toBe(200);

  // 入力 → 実行: only if the ledger screen-def declares an entry form (some
  // ledgers are read-only). Contract-driven, no hard-coded field names.
  if (form) {
    await fillDeclaredForm(page, form, stamp);
    await page.getByRole("button").filter({ hasText: /記録|保存|計上|登録|発行/ }).first().click();
    const after = await page.evaluate(async (p: string) => (await fetch(p, { credentials: "include" })).status, src);
    expect(after).toBe(200);
  }
});
