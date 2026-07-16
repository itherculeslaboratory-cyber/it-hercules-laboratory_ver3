import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // .claude/worktrees/** (parallel-agent git worktrees) belt-and-braces —
    // include already scopes to src/, so this is redundant defense in depth.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
