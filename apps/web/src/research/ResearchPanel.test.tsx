import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import ResearchPanel from "./ResearchPanel";

afterEach(() => cleanup());

describe("ResearchPanel — 正直表示(design §4-4④・§4-4末尾)", () => {
  it("manifest未生成環境では「まだ生成されていません」を表示する", () => {
    render(<ResearchPanel manifestInfo={{ generation: null, generated_at: null }} onRunQuery={vi.fn()} />);
    expect(screen.getByTestId("research-panel-empty").textContent).toContain("まだ生成されていません");
    expect(screen.queryByTestId("research-panel")).toBeNull();
  });
});

describe("ResearchPanel — generation表示・SQLプレビュー・実行", () => {
  it("generation番号と生成時刻を画面に表示する", () => {
    render(
      <ResearchPanel
        manifestInfo={{ generation: 3, generated_at: "2026-08-01T00:00:00+09:00" }}
        onRunQuery={vi.fn()}
      />,
    );
    const info = screen.getByTestId("manifest-generation-info").textContent ?? "";
    expect(info).toContain("3");
    expect(info).toContain("2026-08-01T00:00:00+09:00");
  });

  it("既定の検索条件からSQLプレビューが生成される", () => {
    render(<ResearchPanel manifestInfo={{ generation: 1, generated_at: "t" }} onRunQuery={vi.fn()} />);
    const sql = screen.getByTestId("sql-preview").textContent ?? "";
    expect(sql).toMatch(/^SELECT .* FROM manifest WHERE "type" = \? LIMIT 100$/);
  });

  it("ホワイトリスト外の列を条件に書くとSQLプレビューが消え、エラーが表示される", () => {
    render(<ResearchPanel manifestInfo={{ generation: 1, generated_at: "t" }} onRunQuery={vi.fn()} />);
    const textarea = screen.getByTestId("condition-json-input");
    fireEvent.change(textarea, {
      target: { value: JSON.stringify({ conditions: [{ column: "actor_id", operator: "=", value: "x" }] }) },
    });
    expect(screen.getByTestId("sql-preview").textContent).toBe("");
    expect(screen.getByTestId("query-error").textContent).toContain("WHITELIST_VIOLATION");
  });

  it("実行ボタンでonRunQueryが生成SQL+paramsとともに呼ばれ、結果件数が表示される", async () => {
    const onRunQuery = vi.fn().mockResolvedValue([{ event_id: "e1" }, { event_id: "e2" }]);
    render(<ResearchPanel manifestInfo={{ generation: 1, generated_at: "t" }} onRunQuery={onRunQuery} />);
    fireEvent.click(screen.getByTestId("run-button"));
    await waitFor(() => expect(screen.getByTestId("results-count").textContent).toBe("2件"));
    expect(onRunQuery).toHaveBeenCalledWith(
      'SELECT "event_id", "type", "subject", "payload_key", "payload_bytes", "event_hash", "received_at", "claimed_at", "sig_alg", "key_id", "sig", "signed_bytes_sha256", "sig_verified", "text_repr", "text_repr_v" FROM manifest WHERE "type" = ? LIMIT 100',
      ["obs-capture"],
    );
  });

  it("onRunQueryが失敗したら実行エラーを表示する(結果は表示しない)", async () => {
    const onRunQuery = vi.fn().mockRejectedValue(new Error("boom"));
    render(<ResearchPanel manifestInfo={{ generation: 1, generated_at: "t" }} onRunQuery={onRunQuery} />);
    fireEvent.click(screen.getByTestId("run-button"));
    await waitFor(() => expect(screen.getByTestId("run-error").textContent).toBe("boom"));
    expect(screen.queryByTestId("results-block")).toBeNull();
  });
});
