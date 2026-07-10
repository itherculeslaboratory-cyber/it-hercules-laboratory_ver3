import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// E2E for design-c2 §7. Boots the real worker (wrangler dev, local mode = R2
// simulated) + next dev, then drives the observation lifecycle.
// ponytail: bundled workerd (wrangler 4.86) supports compat dates only up to
// 2026-05-03, so the dev command overrides wrangler.toml's committed 2026-07-01
// FOR THE LOCAL RUN ONLY — the checked-in config is untouched. Upgrade path:
// newer wrangler whose workerd supports 2026-07-01 drops the override.
const dir = dirname(fileURLToPath(import.meta.url));
const API = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: WEB,
    // Pure-local run: never route 127.0.0.1 through any system/WARP proxy.
    launchOptions: { args: ["--no-proxy-server"] },
    screenshot: "off",
  },
  webServer: [
    {
      command: "npm run dev:e2e",
      cwd: resolve(dir, "..", "api"),
      url: `${API}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev -- --port 3000",
      cwd: dir,
      url: `${WEB}/s/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
