import { configDefaults, defineConfig } from "vitest/config";

// Root-level safety net: apps/api, apps/web and tests/ are each their own npm
// workspace and already scope test discovery to their own directory when run
// via `npm test` (the sanctioned path — see package.json). This file only
// matters for ad-hoc invocations of `vitest`/`npx vitest` from the repo root
// (e.g. an IDE test runner), which would otherwise fall back to Vitest's
// defaults and glob the whole tree — including .claude/worktrees/**, the
// parallel-agent git worktrees checked out under .claude/ that carry their own
// full copies of tests/**, producing duplicate-module collisions.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
