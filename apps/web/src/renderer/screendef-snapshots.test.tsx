// GENERATED FILE — do not edit by hand.
// source: screen-defs/*.json (navigation.json excluded)
// direction: screen-defs/ -> generated (one-way; edit the screen-def, then re-run)
// regenerate: node scripts/gen-screendef-snapshots.mjs
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Renderer } from "./renderer";
import { allScreenDefIds, loadScreenDef } from "@/lib/screendefs";

// Baked from the on-disk screen-def set at generation time. Drift (a screen-def
// added or removed without regenerating) fails codegen:check and the count guard.
const SCREEN_IDS = [
  "ai-profile-settings",
  "bio-card",
  "country-select",
  "cross",
  "data-descriptor",
  "device",
  "economy-status",
  "home",
  "individual-detail",
  "knowledge-board",
  "knowledge-github",
  "knowledge-hub",
  "knowledge-paper",
  "knowledge-thread",
  "language-select",
  "login",
  "market-trade",
  "match",
  "obs-confirm",
  "obs-detail",
  "obs-domain-select",
  "obs-entry",
  "obs-navigator",
  "obs-register",
  "obs-register-batch",
  "obs-register-batch-confirm",
  "obs-register-batch-done",
  "obs-register-clutch",
  "obs-register-confirm",
  "obs-register-done",
  "obs-register-entry",
  "obs-register-new",
  "observation-input",
  "paper-detail",
  "paper-match",
  "platinum-shop",
  "profile",
  "project-hub",
  "qr-resume",
  "research-newspaper",
  "research-search",
  "settings",
  "species",
  "template-market",
  "terms",
  "theme-gallery",
  "ui-templates",
];

afterEach(() => cleanup());

describe("ScreenDef snapshots — every screen-def renders (V3-AIP-50)", () => {
  it("covers exactly the on-disk screen-def set (regenerate on drift)", () => {
    expect(SCREEN_IDS.length).toBe(allScreenDefIds().length);
  });

  it.each(SCREEN_IDS)("renders %s without throwing (heading present)", (id) => {
    const { unmount } = render(<Renderer def={loadScreenDef(id)} onAction={vi.fn()} />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
    unmount();
  });
});
