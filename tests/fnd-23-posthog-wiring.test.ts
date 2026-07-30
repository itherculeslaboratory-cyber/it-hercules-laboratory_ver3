// V3-FND-23(非機能要件) — 監視(PostHog)結線の検証。
//
// 実装本体(apps/web/src/app/posthog-provider.tsx・apps/web/package.json の
// posthog-js 依存)は w0-found の担当(発注書「監視(PostHog)結線は w0-found の担当。
// この艦は重複して作らない」)であり、実測で既に実装済み(2026-07-31時点)。本ラン
// (w2-fnd)は重複実装を避け、その既存実装が §10「係数・閾値・鍵は定数モジュール/
// 環境変数に分離する」の規約(鍵をハードコードしない・env var 経由でのみ読む)を
// 満たしていることを静的検査するテストのみを追加する(ソースファイル自体は
// apps/web 配下=w2-fndのglob外のため編集しない・読むだけ)。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = new URL("../apps/web/src/app/posthog-provider.tsx", import.meta.url);

describe("V3-FND-23 posthog-provider.tsx (既存実装=w0-found・読み取り検査のみ)", () => {
  const source = readFileSync(SOURCE_PATH, "utf8");

  it("reads the PostHog key from an env var name, never a hardcoded literal", () => {
    expect(source).toContain("process.env.NEXT_PUBLIC_POSTHOG_KEY");
    // no plausible hardcoded PostHog project key literal (phc_ prefix) in source
    expect(source).not.toMatch(/phc_[A-Za-z0-9]{20,}/);
  });

  it("no-ops (does not call posthog.init) when the key env var is unset", () => {
    expect(source).toMatch(/if\s*\(\s*!key/);
  });

  it("posthog-js is declared as a dependency (V3-FND-28 凍結: 追加は posthog-js のみ許可)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../apps/web/package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies?.["posthog-js"] ?? pkg.devDependencies?.["posthog-js"]).toBeTruthy();
  });
});
