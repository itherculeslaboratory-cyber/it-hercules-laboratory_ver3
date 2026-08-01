// F2(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §4-3): JSON検索条件 →
// ホワイトリスト経由のSQL生成器。「禁止語を弾く」のではなく「生成器がそういう文字列を
// 作れる分岐を持たない」構造にする(design の要求そのもの)。生成できるSQLは
// 1テンプレートのみ:
//
//   SELECT <WL列のみ> FROM manifest WHERE <列 演算子 ?> [AND …] LIMIT <上限>
//
// JOIN / サブクエリ / `;` / 任意SQL は、この生成器のどの分岐からも出力できない
// (禁止リストで弾くのではなく、そもそも作れない)。
import {
  RESEARCH_QUERY_COLUMNS,
  RESEARCH_QUERY_OPERATORS,
  RESEARCH_QUERY_LIMIT_DEFAULT,
  RESEARCH_QUERY_LIMIT_MAX,
  WhitelistViolationError,
} from "./manifest-query-columns";

export interface ResearchQueryCondition {
  column: string;
  operator: string;
  // "=" 等の単値、IN/BETWEENは配列を受け付ける。値は常にパラメータバインドされ、
  // SQL文字列へ直接連結されることはない。
  value: unknown;
}

export interface ResearchQueryJson {
  select?: string[];
  conditions?: ResearchQueryCondition[];
  limit?: number;
}

export interface GeneratedResearchQuery {
  sql: string;
  params: unknown[];
}

function assertColumnWhitelisted(column: string): void {
  if (!RESEARCH_QUERY_COLUMNS.has(column)) {
    throw new WhitelistViolationError(
      `WHITELIST_VIOLATION: column ${JSON.stringify(column)} is not whitelisted for research queries`,
    );
  }
}

function assertOperatorWhitelisted(operator: string): void {
  if (!RESEARCH_QUERY_OPERATORS.has(operator)) {
    throw new WhitelistViolationError(
      `WHITELIST_VIOLATION: operator ${JSON.stringify(operator)} is not whitelisted for research queries`,
    );
  }
}

/** IN/BETWEEN の値配列を "(?, ?, ...)" / "? AND ?" プレースホルダへ展開する。 */
function placeholdersFor(operator: string, value: unknown, params: unknown[]): string {
  if (operator === "IN") {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("IN operator requires a non-empty array value");
    }
    params.push(...value);
    return `(${value.map(() => "?").join(", ")})`;
  }
  if (operator === "BETWEEN") {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error("BETWEEN operator requires a 2-element array value [low, high]");
    }
    params.push(value[0], value[1]);
    return "? AND ?";
  }
  params.push(value);
  return "?";
}

/**
 * JSON検索条件からホワイトリスト経由のSQLを生成する。列名はホワイトリスト集合の
 * メンバをそのまま出力する(ユーザー入力を文字列連結しない)。値は常にパラメータ
 * バインド。LIMIT は必須(既定値・上限は定数で1箇所)。
 */
export function generateResearchQuerySql(query: ResearchQueryJson): GeneratedResearchQuery {
  const selectColumns = query.select && query.select.length > 0 ? query.select : [...RESEARCH_QUERY_COLUMNS];
  for (const col of selectColumns) assertColumnWhitelisted(col);

  const params: unknown[] = [];
  const clauses: string[] = [];
  for (const cond of query.conditions ?? []) {
    assertColumnWhitelisted(cond.column);
    assertOperatorWhitelisted(cond.operator);
    const placeholder = placeholdersFor(cond.operator, cond.value, params);
    if (cond.operator === "BETWEEN") {
      clauses.push(`"${cond.column}" BETWEEN ${placeholder}`);
    } else if (cond.operator === "IN") {
      clauses.push(`"${cond.column}" IN ${placeholder}`);
    } else {
      clauses.push(`"${cond.column}" ${cond.operator} ${placeholder}`);
    }
  }

  const rawLimit = query.limit ?? RESEARCH_QUERY_LIMIT_DEFAULT;
  if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
    throw new Error("limit must be a positive integer");
  }
  const limit = Math.min(rawLimit, RESEARCH_QUERY_LIMIT_MAX);

  const selectList = selectColumns.map((c) => `"${c}"`).join(", ");
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT ${selectList} FROM manifest${where} LIMIT ${limit}`;
  return { sql, params };
}
