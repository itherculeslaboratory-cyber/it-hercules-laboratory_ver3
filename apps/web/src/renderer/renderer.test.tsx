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

describe("Renderer — segmented toggle field (V3-OBS-18)", () => {
  it("checks the default option and carries the selected value in the submit body", async () => {
    const onAction = vi.fn(async () => ({}));
    const action: Action = { kind: "api", method: "POST", path: "/api/v1/observation/captures" };
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "f",
            type: "form",
            action,
            children: [
              {
                id: "sex",
                type: "field",
                props: {
                  variant: "segmented",
                  name: "sex",
                  label: "性別",
                  default: "male",
                  options: [
                    { value: "male", label: "雄" },
                    { value: "female", label: "雌" },
                  ],
                },
              },
              { id: "s", type: "button", props: { label: "送信", type: "submit" } },
            ],
          },
        ])}
      />,
    );
    // default paint: 雄 checked, no input event needed
    expect(screen.getByRole("radio", { name: "雄" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "雌" })).not.toBeChecked();
    // pick 雌, then submit — the selected radio value rides the body
    fireEvent.click(screen.getByRole("radio", { name: "雌" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    expect(onAction).toHaveBeenCalledWith(action, { sex: "female" });
  });
});

describe("Renderer — measurement-table node (V3-OBS-18)", () => {
  const tableDef = (): ScreenDef =>
    screenDef([
      {
        id: "f",
        type: "form",
        action: { kind: "api", method: "POST", path: "/api/v1/observation/captures" },
        children: [
          {
            id: "measurements",
            type: "measurement-table",
            props: {
              add_label: "行を追加",
              add_item_label: "＋ 項目を追加",
              item_options: [{ value: "体長", label: "体長" }],
              unit_options: [{ value: "mm", label: "mm" }],
              method_options: [{ value: "手入力", label: "手入力" }],
              rows: [{ item: "体長", unit: "mm" }],
            },
          },
          { id: "s", type: "button", props: { label: "送信", type: "submit" } },
        ],
      },
    ]);

  it("shapes a filled row into measurements[] with kind/unit/method (dotted nesting)", async () => {
    const onAction = vi.fn(async () => ({}));
    render(<Renderer onAction={onAction} def={tableDef()} />);
    fireEvent.change(screen.getByLabelText("数値 1"), { target: { value: "65" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "送信" }));
    });
    const body = onAction.mock.calls[0][1] as { measurements: Array<Record<string, unknown>> };
    expect(body.measurements[0]).toMatchObject({
      item: "体長",
      value: "65",
      unit: "mm",
      method: "手入力",
      kind: "number",
    });
  });

  it("adds a row when 行を追加 is pressed (value inputs grow)", () => {
    render(<Renderer onAction={vi.fn()} def={tableDef()} />);
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "行を追加" }));
    expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  });

  it("reveals a free-item choice builder on ＋ 項目を追加", () => {
    render(<Renderer onAction={vi.fn()} def={tableDef()} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 項目を追加" }));
    expect(screen.getByRole("button", { name: "項目を追加" })).toBeInTheDocument();
  });
});

describe("Renderer — A層 badge/progress (c7 ui-parity-map §2-3/§2-4)", () => {
  it("renders a badge with the requested tone as a data attribute", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([{ id: "b", type: "badge", props: { text: "良好", tone: "success" } }])}
      />,
    );
    const badge = screen.getByText("良好");
    expect(badge).toHaveClass("civ-badge");
    expect(badge).toHaveAttribute("data-tone", "success");
  });

  it("falls back to the neutral tone for an unknown/missing tone", () => {
    render(
      <Renderer onAction={vi.fn()} def={screenDef([{ id: "b", type: "badge", props: { text: "草案" } }])} />,
    );
    expect(screen.getByText("草案")).toHaveAttribute("data-tone", "neutral");
  });

  it("renders a progressbar with the correct aria values and rounded percentage", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          { id: "p", type: "progress", props: { value: 30, max: 40, label: "充足度" } },
        ])}
      />,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "40");
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});

describe("Renderer — A層 table node (c7 ui-parity-map §2-1)", () => {
  it("binds rows via bind_items and dispatches cell type (text/badge/progress)", async () => {
    const onAction = vi.fn(async () => ({
      rows: [{ name: "個体A", state: "良好", tone: "success", pct: 50 }],
    }));
    render(
      <Renderer
        onAction={onAction}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "tbl",
              type: "table",
              props: {
                source_path: "/api/v1/x",
                bind_items: "data.tbl.rows",
                columns: [
                  { key: "name", label: "名前" },
                  { key: "state", label: "状態", cell: "badge", tone_key: "tone" },
                  { key: "pct", label: "進捗", cell: "progress", max: 100 },
                ],
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("個体A")).toBeInTheDocument();
    const badge = screen.getByText("良好");
    expect(badge).toHaveClass("civ-badge");
    expect(badge).toHaveAttribute("data-tone", "success");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders empty_text when the bound array is empty", async () => {
    const onAction = vi.fn(async () => ({ rows: [] }));
    render(
      <Renderer
        onAction={onAction}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "tbl",
              type: "table",
              props: {
                source_path: "/api/v1/x",
                bind_items: "data.tbl.rows",
                columns: [{ key: "name", label: "名前" }],
                empty_text: "まだ記録がありません",
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("まだ記録がありません")).toBeInTheDocument();
  });
});

describe("Renderer — A層 tabs node (c7 ui-parity-map §2-5)", () => {
  it("shows only the default tab's children, switching on click", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          {
            id: "tabs",
            type: "tabs",
            props: { tabs: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
            children: [
              { id: "ca", type: "text", props: { text: "Aの中身", tab_id: "a" } },
              { id: "cb", type: "text", props: { text: "Bの中身", tab_id: "b" } },
            ],
          },
        ])}
      />,
    );
    expect(screen.getByText("Aの中身")).toBeInTheDocument();
    expect(screen.queryByText("Bの中身")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.queryByText("Aの中身")).not.toBeInTheDocument();
    expect(screen.getByText("Bの中身")).toBeInTheDocument();
  });
});

describe("Renderer — A層 image-grid node (c7 ui-parity-map §2-6)", () => {
  it("binds items into thumbnail cards with label/meta/badge", async () => {
    const onAction = vi.fn(async () => ({
      items: [{ url: "/x.jpg", name: "個体A", note: "良好", tone: "success" }],
    }));
    render(
      <Renderer
        onAction={onAction}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "grid",
              type: "image-grid",
              props: {
                source_path: "/api/v1/x",
                bind_items: "data.grid.items",
                item_image: "{{url}}",
                item_alt: "{{name}}",
                item_label: "{{name}}",
                item_meta: "{{note}}",
                item_badge: "{{note}}",
                item_badge_tone: "{{tone}}",
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("個体A")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "個体A" })).toHaveAttribute("src", "/x.jpg");
    const badge = screen.getAllByText("良好").find((el) => el.className.includes("civ-badge"));
    expect(badge).toHaveAttribute("data-tone", "success");
  });
});

describe("Renderer — A層 stepper node (c7 ui-parity-map §2-7)", () => {
  it("marks steps before current as done, the match as current, the rest upcoming", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          {
            id: "s",
            type: "stepper",
            props: {
              current: 1,
              steps: [{ id: "s1", label: "対象確定" }, { id: "s2", label: "計測" }, { id: "s3", label: "確認" }],
            },
          },
        ])}
      />,
    );
    expect(screen.getByText("対象確定").closest(".civ-step")).toHaveAttribute("data-state", "done");
    expect(screen.getByText("計測").closest(".civ-step")).toHaveAttribute("data-state", "current");
    expect(screen.getByText("確認").closest(".civ-step")).toHaveAttribute("data-state", "upcoming");
  });
});

describe("Renderer — A層 kpi-tile node (c7 ui-parity-map §2-8)", () => {
  it("renders a bound value/label and an optional trend badge", async () => {
    const onAction = vi.fn(async () => ({ count: 42 }));
    render(
      <Renderer
        onAction={onAction}
        def={{
          screen_id: "t",
          route: "/t",
          title: "t",
          nodes: [
            {
              id: "kpi",
              type: "kpi-tile",
              props: {
                source_path: "/api/v1/x",
                value: "{{data.kpi.count}}",
                label: "登録数",
                trend: "+12%",
                trend_tone: "success",
              },
            },
          ],
        }}
      />,
    );
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("登録数")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toHaveAttribute("data-tone", "success");
  });
});

describe("Renderer — A層 rich card (c7 ui-parity-map §2-2, upper-compat on 'card')", () => {
  it("renders icon/title/meta/badges and a nav chevron that fires the card's action", async () => {
    const onAction = vi.fn(async () => ({}));
    render(
      <Renderer
        onAction={onAction}
        def={screenDef([
          {
            id: "card1",
            type: "card",
            props: {
              icon: "🐛",
              title: "ヘラクレスオオカブト #12",
              meta: "最終計測: 78mm",
              badges: [{ text: "取引可", tone: "success" }],
            },
            action: { kind: "navigate", to: "individual-detail" },
          },
        ])}
      />,
    );
    expect(screen.getByRole("heading", { name: "ヘラクレスオオカブト #12", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("最終計測: 78mm")).toBeInTheDocument();
    expect(screen.getByText("取引可")).toHaveAttribute("data-tone", "success");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "開く" }));
    });
    expect(onAction).toHaveBeenCalledWith({ kind: "navigate", to: "individual-detail" });
  });

  it("a plain card with none of the rich props still renders exactly as before (upper-compat)", () => {
    render(
      <Renderer
        onAction={vi.fn()}
        def={screenDef([
          {
            id: "card1",
            type: "card",
            children: [{ id: "t", type: "text", props: { text: "本文のみ" } }],
          },
        ])}
      />,
    );
    expect(screen.getByText("本文のみ")).toBeInTheDocument();
    expect(screen.queryByText("開く")).not.toBeInTheDocument();
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
