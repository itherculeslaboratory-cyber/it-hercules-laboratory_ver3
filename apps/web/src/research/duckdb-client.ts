// F2(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §4-2 案C・実測 F0=
// R0801-4ee3c9-REPORT-2026-08-01-g79-f0wasm.md)。ブラウザ内 duckdb-wasm を
// **研究者タブを開いた時だけ**動的importで読み込む(遅延ロード)。F0が実測した
// 「追加設定なしで動く・専用チャンクへ自動分離される」構成をそのまま踏襲する
// (next/dynamic 等の追加ラッパーは不要 — await import() だけで足りることをF0が確認済み)。
//
// 自己ホスト配信(F0の判断=CDNに頼らずオフライン/社内配信でも動く形を優先)。
// public/duckdb/ 配下の .wasm / *.worker.js を配る(このリポジトリの他の public/ 資産
// = public/finder/ とは無関係の新規ディレクトリ)。
import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";

let cached: Promise<AsyncDuckDB> | null = null;

/** duckdb-wasm を遅延ロードし、初期化済みの AsyncDuckDB インスタンスを返す(以後キャッシュ)。 */
export async function loadDuckDb(): Promise<AsyncDuckDB> {
  if (cached) return cached;
  cached = (async () => {
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundles: import("@duckdb/duckdb-wasm").DuckDBBundles = {
      mvp: {
        mainModule: "/duckdb/duckdb-mvp.wasm",
        mainWorker: "/duckdb/duckdb-browser-mvp.worker.js",
      },
      eh: {
        mainModule: "/duckdb/duckdb-eh.wasm",
        mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
      },
    };
    const bundle = await duckdb.selectBundle(bundles);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return db;
  })();
  return cached;
}

/**
 * manifest.parquet のバイト列(fetchで取得済み)を DuckDB に登録し、`manifest` という
 * 名前のVIEWとして参照できるようにする。query-generator.ts が生成するSQLは
 * 「FROM manifest」を前提にしており、文字列置換のような場当たり対応をしない
 * (VIEWを1回作るだけで、生成器側は素のテーブル名として書ける)。
 */
export async function registerManifest(db: AsyncDuckDB, parquetBytes: Uint8Array): Promise<void> {
  await db.registerFileBuffer("manifest.parquet", parquetBytes);
  const conn = await db.connect();
  try {
    await conn.query("CREATE OR REPLACE VIEW manifest AS SELECT * FROM read_parquet('manifest.parquet')");
  } finally {
    await conn.close();
  }
}

/**
 * 生成済みSQL+パラメータ(query-generator.ts の出力)を実行し、行の配列を返す。
 * 値は prepare()+bind で渡す(SQL文字列へ直接連結しない — query-generator側の
 * パラメータバインド契約をここでも維持する)。実行はブラウザ内のみ。
 */
export async function runResearchQuery(
  db: AsyncDuckDB,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const conn = await db.connect();
  try {
    const stmt = await conn.prepare(sql);
    try {
      const result = await stmt.query(...params);
      return result.toArray().map((row) => row.toJSON() as Record<string, unknown>);
    } finally {
      await stmt.close();
    }
  } finally {
    await conn.close();
  }
}
