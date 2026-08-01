import { describe, it, expect } from "vitest";
import { generateResearchQuerySql } from "./query-generator";
import { WhitelistViolationError, RESEARCH_QUERY_LIMIT_MAX, RESEARCH_QUERY_LIMIT_DEFAULT } from "./manifest-query-columns";

describe("generateResearchQuerySql (design §4-3 ホワイトリストSQL生成器)", () => {
  it("生成されるSQLは1テンプレートのみ(SELECT ... FROM manifest WHERE ... LIMIT ...)", () => {
    const { sql, params } = generateResearchQuerySql({
      select: ["event_id", "type"],
      conditions: [{ column: "type", operator: "=", value: "obs-capture" }],
      limit: 50,
    });
    expect(sql).toBe('SELECT "event_id", "type" FROM manifest WHERE "type" = ? LIMIT 50');
    expect(params).toEqual(["obs-capture"]);
  });

  it("値は常にパラメータバインドされ、SQL文字列へ直接連結されない", () => {
    const malicious = "'; DROP TABLE manifest; --";
    const { sql, params } = generateResearchQuerySql({
      conditions: [{ column: "subject", operator: "=", value: malicious }],
    });
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).toContain('"subject" = ?');
    expect(params).toEqual([malicious]);
  });

  it("ホワイトリスト外の列名は拒否する(WHITELIST_VIOLATION)", () => {
    expect(() =>
      generateResearchQuerySql({ conditions: [{ column: "actor_id", operator: "=", value: "x" }] }),
    ).toThrow(WhitelistViolationError);
  });

  it("select句にホワイトリスト外の列を指定しても拒否する", () => {
    expect(() => generateResearchQuerySql({ select: ["actor_id"] })).toThrow(WhitelistViolationError);
  });

  it("ホワイトリスト外の演算子は拒否する(join/subquery相当の任意演算子を弾く)", () => {
    expect(() =>
      generateResearchQuerySql({ conditions: [{ column: "type", operator: "DROP", value: "x" }] }),
    ).toThrow(WhitelistViolationError);
  });

  it("生成器の構造上、JOIN・サブクエリ・';'を含む文字列を一切作れない", () => {
    const { sql } = generateResearchQuerySql({
      conditions: [{ column: "type", operator: "LIKE", value: "%obs%" }],
    });
    expect(sql).not.toMatch(/JOIN/i);
    expect(sql).not.toMatch(/SELECT.*SELECT/is);
    expect(sql).not.toContain(";");
  });

  it("LIMITは必須で、既定値が適用される", () => {
    const { sql } = generateResearchQuerySql({});
    expect(sql).toContain(`LIMIT ${RESEARCH_QUERY_LIMIT_DEFAULT}`);
  });

  it("LIMITの上限を超える指定は上限に丸められる", () => {
    const { sql } = generateResearchQuerySql({ limit: RESEARCH_QUERY_LIMIT_MAX + 5000 });
    expect(sql).toContain(`LIMIT ${RESEARCH_QUERY_LIMIT_MAX}`);
  });

  it("limitが0以下または非整数なら例外", () => {
    expect(() => generateResearchQuerySql({ limit: 0 })).toThrow();
    expect(() => generateResearchQuerySql({ limit: -1 })).toThrow();
    expect(() => generateResearchQuerySql({ limit: 1.5 })).toThrow();
  });

  it("IN演算子は配列を展開したプレースホルダを生成する", () => {
    const { sql, params } = generateResearchQuerySql({
      conditions: [{ column: "type", operator: "IN", value: ["obs-capture", "obs-photo"] }],
    });
    expect(sql).toContain('"type" IN (?, ?)');
    expect(params).toEqual(["obs-capture", "obs-photo"]);
  });

  it("BETWEEN演算子は2値のプレースホルダを生成する", () => {
    const { sql, params } = generateResearchQuerySql({
      conditions: [{ column: "payload_bytes", operator: "BETWEEN", value: [100, 200] }],
    });
    expect(sql).toContain('"payload_bytes" BETWEEN ? AND ?');
    expect(params).toEqual([100, 200]);
  });

  it("複数条件はANDで連結される", () => {
    const { sql } = generateResearchQuerySql({
      conditions: [
        { column: "type", operator: "=", value: "obs-capture" },
        { column: "received_at", operator: ">=", value: "2026-01-01" },
      ],
    });
    expect(sql).toBe('SELECT "event_id", "type", "subject", "payload_key", "payload_bytes", "event_hash", "received_at", "claimed_at", "sig_alg", "key_id", "sig", "signed_bytes_sha256", "sig_verified", "text_repr", "text_repr_v" FROM manifest WHERE "type" = ? AND "received_at" >= ? LIMIT 1000');
  });
});
