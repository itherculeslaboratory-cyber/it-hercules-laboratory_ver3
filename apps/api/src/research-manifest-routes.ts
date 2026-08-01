// F2(design R0801-c618a6-REPORT-2026-08-01-g78-b3think.md §4-2 案C): 研究者モードが
// 読む Parquet manifest を R2(TRUTH バケット)から配信するだけの薄いルート。実行は
// ブラウザ内 duckdb-wasm(F0実測=R0801-4ee3c9)が行うため、ここは「バイト列を返す」
// 「generation番号を返す」の2本のみで、SQL実行・列フィルタ等の判断は一切持たない
// (invariant①=重い計算はクライアント側)。
//
// キー規約(★新規決定・生成器側との唯一の橋渡し): R2 の TRUTH バケット直下に
//   research/manifest/latest.json                          — { generation, generated_at }
//   research/manifest/generation-<N>/manifest.parquet       — Parquet本体
// を置く前提。libs/datalake/manifest.py の generate_manifest_from_index_entries() は
// ローカルファイルシステムに書く関数のままで(F1・cea2bf3)、ローカル出力をこのR2キーへ
// アップロードする経路(手動 route か CLI か)は F1 が「未決着」と明記しており、F2でも
// 未着手(§決められなかったこと参照)。今回作ったのは「R2にこの形で置かれていれば読める」
// という受け口のみ。
//
// PROTECTED(既存の deny-by-default 方針に合わせ PUBLIC_ROUTES には登録しない —
// index.ts §1.5 gate 経由でログイン済みのみ到達する)。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";

export const researchManifestRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export const RESEARCH_MANIFEST_PREFIX = "research/manifest";

interface LatestManifestPointer {
  generation: number;
  generated_at: string;
}

function parquetKeyFor(generation: number): string {
  return `${RESEARCH_MANIFEST_PREFIX}/generation-${generation}/manifest.parquet`;
}

// GET /research/manifest/latest — generation番号+生成時刻。正直表示(design §4-4④):
// manifest未生成(R2に latest.json が無い)環境では generation:null をそのまま返し、
// 呼び出し側(ResearchPanel)が「まだ生成されていません」を表示する。
researchManifestRoutes.get("/research/manifest/latest", async (c) => {
  const obj = await c.env.TRUTH.get(`${RESEARCH_MANIFEST_PREFIX}/latest.json`);
  if (!obj) {
    return c.json({ generation: null, generated_at: null });
  }
  const text = await obj.text();
  let pointer: LatestManifestPointer;
  try {
    pointer = JSON.parse(text) as LatestManifestPointer;
  } catch {
    return c.json({ generation: null, generated_at: null, error: "MANIFEST_POINTER_CORRUPT" }, 500);
  }
  return c.json({ generation: pointer.generation, generated_at: pointer.generated_at ?? null });
});

// GET /research/manifest/generation/:gen/data.parquet — Parquet本体をそのまま返す。
// duckdb-wasm 側が fetch() でこのURLを直接読む(registerFileBuffer/registerFileURL相当)。
researchManifestRoutes.get("/research/manifest/generation/:gen/data.parquet", async (c) => {
  const gen = Number(c.req.param("gen"));
  if (!Number.isInteger(gen) || gen < 0) {
    return c.json({ error: "INVALID_GENERATION" }, 400);
  }
  const obj = await c.env.TRUTH.get(parquetKeyFor(gen));
  if (!obj) {
    return c.json({ error: "MANIFEST_NOT_FOUND", generation: gen }, 404);
  }
  const bytes = await obj.arrayBuffer();
  return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
});
