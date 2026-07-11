import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { Renderer } from "./renderer";
import { ApiError } from "@/lib/error-messages";
import type { Action, ScreenDef } from "./types";
import { allScreenDefs, loadScreenDef } from "@/lib/screendefs";
// GATE logic under test (color discipline). Imported for the negative case.
import { scanColors } from "../../../../scripts/check-ui-tokens.mjs";

afterEach(() => cleanup());

function screenDef(nodes: ScreenDef["nodes"]): ScreenDef {
  return { screen_id: "t", route: "/t", title: "t", nodes };
}

describe("Renderer — screen-defs", () => {
  // The single Renderer must draw EVERY screen-def (design-c5 §3, UIX-17). The
  // count is derived from the on-disk set (all *.json minus navigation) rather
  // than a frozen literal, so it neither goes red when a cluster adds a def
  // (K4 adds settings/theme-gallery/ui-templates via P5) nor silently drops
  // one — deviation from the "hardcode 25" note, which would be red until P5's
  // three defs land. The completeness guard is preserved two ways below.
  it("renders every screen-def on disk (navigation.json excluded), matching the loader", () => {
    const dir = join(process.cwd(), "..", "..", "screen-defs");
    const onDisk = readdirSync(dir).filter(
      (f) => f.endsWith(".json") && f !== "navigation.json",
    ).length;
    const defs = allScreenDefs();
    // loader neither drops nor duplicates relative to the on-disk set…
    expect(defs.length).toBe(onDisk);
    // …and the core screens are never silently excluded.
    const ids = defs.map((d) => d.screen_id);
    for (const req of ["home", "login", "obs-detail", "individual-detail", "qr-resume"]) {
      expect(ids).toContain(req);
    }
    for (const def of defs) {
      const { unmount } = render(<Renderer def={def} onAction={vi.fn()} />);
      // each screen has an h1 heading node -> title text is on screen
      expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe("Renderer — button state + keyboard (V3-UIX-81)", () => {
  it("carries the common interactive class (focus-visible/44px come from it)", () => {
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "押す" }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "押す" });
    expect(btn).toHaveClass("civ-interactive");
  });

  it("fires the action on keyboard activation (Enter/Space via click)", async () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "実行" }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "実行" });
    btn.focus();
    expect(btn).toHaveFocus(); // keyboard-reachable
    // native button: Enter/Space dispatch a click; action executor is async
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onAction).toHaveBeenCalledWith({ kind: "navigate", to: "home" });
  });

  it("renders disabled state (aria-disabled + disabled, no action)", () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          { id: "b", type: "button", props: { label: "無効", disabled: true }, action: { kind: "navigate", to: "home" } },
        ])}
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: "無効" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(btn);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders loading state (aria-busy + data-loading)", () => {
    render(
      <Renderer
        def={screenDef([{ id: "b", type: "button", props: { label: "送信中", loading: true } }])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "送信中" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("data-loading", "true");
  });

  it("renders error state (aria-invalid + alert text)", () => {
    render(
      <Renderer
        def={screenDef([{ id: "b", type: "button", props: { label: "失敗", error: "送信に失敗しました" } }])}
        onAction={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: "失敗" });
    expect(btn).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("送信に失敗しました");
  });
});

describe("Renderer — form aria-invalid (field regime)", () => {
  it("marks a declaratively-invalid field with aria-invalid/data-invalid", () => {
    render(
      <Renderer
        def={screenDef([
          {
            id: "f",
            type: "form",
            children: [
              { id: "email", type: "field", props: { variant: "text", name: "email", label: "メール", invalid: true } },
            ],
          },
        ])}
        onAction={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("メール");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("data-invalid", "true");
  });

  it("marks required-empty fields invalid on submit and blocks the action", () => {
    const onAction = vi.fn();
    render(
      <Renderer
        def={screenDef([
          {
            id: "f",
            type: "form",
            action: { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
            children: [
              { id: "item", type: "field", props: { variant: "text", name: "item", label: "項目", required: true } },
              { id: "s", type: "button", props: { label: "保存", type: "submit" } },
            ],
          },
        ])}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByLabelText(/項目/)).toHaveAttribute("aria-invalid", "true");
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe("Renderer — terms consent checkbox reactive submit (V3-AUT-06)", () => {
  it("keeps the login submit disabled from first paint until email + terms agreed", () => {
    render(<Renderer def={loadScreenDef("login")} onAction={vi.fn()} onNavigate={vi.fn()} />);
    const submit = screen.getByRole("button", { name: "ログインリンクを送る" });
    // initial paint: no input has fired, terms unchecked -> disabled synchronously
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/メールアドレス/), {
      target: { value: "you@example.com" },
    });
    expect(submit).toBeDisabled(); // terms still unchecked
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
    // unchecking terms re-disables the submit
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeDisabled();
  });
});

describe("Renderer runtime — body-shaping, transitions, data-binding", () => {
  it("shapes the form body to the API contract (static inject + dotted nesting)", async () => {
    const onAction = vi.fn(async () => ({}));
    const action: Action = { kind: "api", method: "POST", path: "/api/v1/observation/captures" };
    render(
      <Renderer
        onAction={onAction}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "capture-form",
              type: "form",
              action,
              props: { static: { "measurements.0.kind": "number", "species_confirmed_by": "user" } },
              children: [
                { id: "domain", type: "field", props: { variant: "text", name: "domain", label: "ドメイン", required: true } },
                { id: "mi", type: "field", props: { variant: "text", name: "measurements.0.item", label: "項目", required: true } },
                { id: "mv", type: "field", props: { variant: "number", name: "measurements.0.value", label: "値", required: true } },
                { id: "submit", type: "button", props: { label: "記録する", type: "submit" } },
              ],
            },
          ],
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/ドメイン/), { target: { value: "biology" } });
    fireEvent.change(screen.getByLabelText(/項目/), { target: { value: "体長" } });
    fireEvent.change(screen.getByLabelText(/値/), { target: { value: "65" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "記録する" }));
    });
    expect(onAction).toHaveBeenCalledWith(action, {
      domain: "biology",
      species_confirmed_by: "user",
      measurements: [{ kind: "number", item: "体長", value: "65" }],
    });
  });

  // The WITH-photo two-stage upload is verified in the real browser
  // (e2e/observation.spec.ts): jsdom's FormData(form) can't carry a real file
  // input, so the photo round-trip is asserted there (photo decodes on
  // obs-detail + photo Truth key enumerated). Here we only guard the no-file
  // branch — the upload step must be skipped when no photo is attached.
  it("submits without a photo (upload step is skipped)", async () => {
    const onAction = vi.fn(async () => ({ capture_id: "C0" }));
    render(
      <Renderer
        onAction={onAction}
        onNavigate={vi.fn()}
        def={{
          screen_id: "obs-entry",
          route: "/observe/entry",
          title: "t",
          nodes: [
            {
              id: "capture-form",
              type: "form",
              action: { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
              children: [
                { id: "item", type: "field", props: { variant: "text", name: "measurements.0.item", label: "項目", required: true } },
                { id: "photo", type: "field", props: { variant: "photo", name: "photo", label: "写真" } },
                { id: "submit", type: "button", props: { label: "記録する", type: "submit" } },
              ],
            },
          ],
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/項目/), { target: { value: "体長" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "記録する" }));
    });
    expect(onAction).toHaveBeenCalledTimes(1); // capture only, no upload
  });

  it("consumes transitions[] on a successful api action (carries the response id)", async () => {
    const onAction = vi.fn(async () => ({ capture_id: "C1" }));
    const onNavigate = vi.fn();
    render(
      <Renderer
        onAction={onAction}
        onNavigate={onNavigate}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "capture-form",
              type: "form",
              action: { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
              children: [{ id: "submit", type: "button", props: { label: "記録する", type: "submit" } }],
            },
          ],
          transitions: [{ from: "capture-form", to_screen_id: "obs-detail" }],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "記録する" }));
    });
    expect(onNavigate).toHaveBeenCalledWith("obs-detail", { id: "C1" });
  });

  it("binds a list to mount-fetched data via {{params.id}} + interpolated items", async () => {
    const onAction = vi.fn(async (a: Action) => {
      if (a.kind === "api" && a.path === "/api/v1/individuals/ind-1/observations") {
        return { observations: [{ measurements: [{ item: "体長", value: 65 }] }] };
      }
      return undefined;
    });
    render(
      <Renderer
        onAction={onAction}
        params={{ id: "ind-1" }}
        def={{
          screen_id: "individual-detail",
          route: "/individuals/detail",
          title: "t",
          nodes: [
            {
              id: "history",
              type: "list",
              props: {
                source_path: "/api/v1/individuals/{{params.id}}/observations",
                bind_items: "data.history.observations",
                item_text: "{{measurements.0.item}} {{measurements.0.value}}",
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("体長 65")).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith({
      kind: "api",
      method: "GET",
      path: "/api/v1/individuals/ind-1/observations",
    });
  });

  it("interpolates {{params.id}} into an action path and binds the result into a qr-code", async () => {
    const onAction = vi.fn(async () => ({ token: "TK123" }));
    const onNavigate = vi.fn();
    render(
      <Renderer
        onAction={onAction}
        onNavigate={onNavigate}
        params={{ id: "ind-1" }}
        def={{
          screen_id: "individual-detail",
          route: "/individuals/detail",
          title: "t",
          nodes: [
            {
              id: "issue-qr",
              type: "button",
              props: { label: "QR 発行" },
              action: { kind: "api", method: "POST", path: "/api/v1/individuals/{{params.id}}/qr" },
            },
            { id: "qr", type: "qr-code", props: { value: "{{result.token}}" } },
          ],
          transitions: [{ from: "issue-qr", to_screen_id: "qr-resume" }],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "QR 発行" }));
    });
    expect(onAction).toHaveBeenCalledWith({
      kind: "api",
      method: "POST",
      path: "/api/v1/individuals/ind-1/qr",
    });
    expect(onNavigate).toHaveBeenCalledWith("qr-resume", { token: "TK123" });
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("aria-label", "QRコード: TK123"),
    );
  });
});

describe("Renderer — text_key i18n resolution (V3-I18-08)", () => {
  it("resolves text_key/label_key via the injected resolver, falling back to literal", () => {
    const catalog: Record<string, string> = {
      "t.head.title": "設定",
      "t.save.label": "保存する",
    };
    render(
      <Renderer
        resolveMessage={(k) => catalog[k]}
        onAction={vi.fn()}
        def={screenDef([
          { id: "h", type: "heading", props: { text_key: "t.head.title", text: "FALLBACK" } },
          { id: "b", type: "button", props: { label_key: "t.save.label", label: "FALLBACK" } },
          // unknown key -> literal fallback (never renders the raw key)
          { id: "t2", type: "text", props: { text_key: "t.missing.x", text: "そのまま" } },
        ])}
      />,
    );
    expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存する" })).toBeInTheDocument();
    expect(screen.getByText("そのまま")).toBeInTheDocument();
    expect(screen.queryByText("t.missing.x")).not.toBeInTheDocument();
    expect(screen.queryByText("FALLBACK")).not.toBeInTheDocument();
  });
});

describe("Renderer — empty state (V3-UIX-03)", () => {
  it("renders empty_text for a data-bound list that resolves to zero items", async () => {
    const onAction = vi.fn(async () => ({ observations: [] }));
    render(
      <Renderer
        onAction={onAction}
        params={{ id: "ind-1" }}
        def={{
          screen_id: "individual-detail",
          route: "/individuals/detail",
          title: "t",
          nodes: [
            {
              id: "history",
              type: "list",
              props: {
                source_path: "/api/v1/individuals/{{params.id}}/observations",
                bind_items: "data.history.observations",
                item_text: "{{measurements.0.item}}",
                empty_text: "まだ写真はありません",
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("まだ写真はありません")).toBeInTheDocument();
    expect(screen.getByText("まだ写真はありません")).toHaveClass("civ-empty");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("Renderer — draft badge (V3-UIX-45)", () => {
  it("renders a 草案 badge on a draft heading without disturbing the heading role", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          { id: "h", type: "heading", props: { text: "私のテンプレ", draft: true } },
        ])}
      />,
    );
    const heading = screen.getByRole("heading", { name: /私のテンプレ/ });
    expect(heading).toBeInTheDocument();
    const badge = screen.getByText("草案");
    expect(badge).toHaveClass("civ-draft-badge");
  });
});

describe("Renderer — API error copy (V3-UIX-03)", () => {
  it.each([
    ["401", "ログイン"],
    ["403", "権限"],
    ["409", "競合"],
  ])("shows Japanese copy for %s (never the raw 'api <n>')", async (code, needle) => {
    const onAction = vi.fn(async () => {
      throw new ApiError(code);
    });
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "b",
            type: "button",
            props: { label: "実行" },
            action: { kind: "api", method: "POST", path: "/api/v1/x" },
          },
        ])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "実行" }));
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(needle);
    expect(alert.textContent ?? "").not.toMatch(/api\s*\d/i);
  });
});

describe("Renderer — UGC on-device translate affordance (V3-I18-06)", () => {
  it("offers 翻訳 only when the viewer locale differs from the content lang", () => {
    const ugc = (): ScreenDef =>
      screenDef([
        { id: "u", type: "text", props: { text: "こんにちは", ugc: true, lang: "ja" } },
      ]);
    // same language (ja viewer, ja content): original text, no affordance
    const same = render(<Renderer def={ugc()} onAction={vi.fn()} viewerLocale="ja" />);
    expect(screen.getByText("こんにちは")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "翻訳" })).not.toBeInTheDocument();
    same.unmount();
    // different language (en viewer, ja content): original shown + 翻訳 offered
    render(<Renderer def={ugc()} onAction={vi.fn()} viewerLocale="en" />);
    expect(screen.getByText(/こんにちは/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "翻訳" })).toBeInTheDocument();
  });

  it("keeps the original text after pressing 翻訳 (no server translation runs)", async () => {
    render(
      <Renderer
        onAction={vi.fn()}
        viewerLocale="en"
        def={screenDef([
          { id: "u", type: "text", props: { text: "原文のまま", ugc: true, lang: "ja" } },
        ])}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "翻訳" }));
    });
    // on-device hook returns the original until a device translator exists (I18-06)
    expect(screen.getByText(/原文のまま/)).toBeInTheDocument();
  });
});

describe("ThemePack — prefers-reduced-motion + token discipline", () => {
  const css = readFileSync(
    join(process.cwd(), "src", "app", "globals.css"),
    "utf8",
  );

  it("stops transitions/animations under prefers-reduced-motion", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("raw color GATE detects a violation (negative)", () => {
    // built by concatenation so the literal does not sit in this .tsx file
    // (the GATE scans .tsx too — it must stay clean of raw color).
    const badHex = "color:" + "#" + "0d0d0d";
    const badClass = "bg-" + "blue-500";
    expect(scanColors(badHex).length).toBeGreaterThan(0);
    expect(scanColors(badClass).length).toBeGreaterThan(0);
    expect(scanColors("class='civ-button' style='color:var(--civ-text)'")).toHaveLength(0);
  });
});
