// F2(design §4-3「CSV/JSON出力」・§4-4)。DuckDBがクエリ結果をブラウザ側に持っているため、
// サーバ関与ゼロでクライアント変換のみ行う。
export function resultsToJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function resultsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** ブラウザで <filename> としてダウンロードさせる(サーバへは送らない)。 */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
