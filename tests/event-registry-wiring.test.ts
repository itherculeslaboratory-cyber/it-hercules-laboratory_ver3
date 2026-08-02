// Truth イベント型の配線ガード(裁定: 00-hq\kits\lane-think\R0802-37b8e4-REPORT-2026-08-02-g93-truththink.md)。
// EVENT_NAMES から漏れた型は eventSchemaFor が null を返し、validateEnvelope が data 検証を
// 丸ごとスキップする。Truth は INSERT ONLY なので、そこで書かれた不正データは永久に消せない
// (同じ危険は tests/schemas-foundation-k1.test.ts:1-5 が K1 の14スキーマについて既に記している)。
// 本テストはそれを「型ごとの個別テスト」ではなく「全数突合」で守る。
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function schemaFiles(category: "events" | "frozen"): string[] {
  return readdirSync(join(ROOT, "schemas", category))
    .filter((f) => f.endsWith(".schema.json"))
    .filter((f) => !(category === "events" && f === "envelope.schema.json"))
    .sort();
}

function kebabOf(filename: string): string {
  return filename.replace(/\.schema\.json$/, "");
}

// envelope.ts の VALIDATOR_NAME / EVENT_NAMES / FROZEN_NAMES は export されていない
// (kebab->camel の内部レジストリのため)。.ts は import できるが private const は
// 取り出せないので、codegen-validators.mjs と同じ作法(文字列として読み正規表現で抽出)を踏襲する。
const ENVELOPE_SRC = readFileSync(join(ROOT, "packages", "truth", "src", "envelope.ts"), "utf8");

function extractSection(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(start, end);
}

const validatorNameSection = extractSection(ENVELOPE_SRC, "const VALIDATOR_NAME", "\n};");
// キーは kebab-case のときだけクォートされ(例: "mkt-listing": "mktListing"),有効な JS
// 識別子のときはクォート無し(例: condition: "condition")。両方を拾う。
const VALIDATOR_NAME = new Set(
  [...validatorNameSection.matchAll(/^\s*["']?([a-zA-Z0-9-]+)["']?:\s*"[a-zA-Z0-9]+"/gm)].map((m) => m[1]),
);

const eventNamesSection = extractSection(ENVELOPE_SRC, "const EVENT_NAMES = new Set([", "\n]);");
const EVENT_NAMES = new Set([...eventNamesSection.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]));

const frozenNamesSection = extractSection(ENVELOPE_SRC, "const FROZEN_NAMES = new Set([", "\n]);");
const FROZEN_NAMES = new Set([...frozenNamesSection.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]));

// codegen-validators.mjs の SCHEMAS 配列 + UNREGISTERED_DEBT を同じく文字列読み取りで抽出する
// (.mjs から import すると ajv/require の実行環境依存で vitest から壊れやすいため、既存の
// T3-3方式=文字列正規表現を踏襲。案Bの却下理由と同じ判断=3-2)。
const CODEGEN_SRC = readFileSync(join(ROOT, "scripts", "codegen-validators.mjs"), "utf8");
const schemasSection = extractSection(CODEGEN_SRC, "const SCHEMAS = [", "\n];");
const CODEGEN_SCHEMA_PATHS = new Set(
  [...schemasSection.matchAll(/\["[a-zA-Z0-9]+",\s*"((?:events|frozen|common)\/[a-z0-9-]+\.schema\.json)"\]/g)].map(
    (m) => m[1],
  ),
);
const codegenDebtSection = extractSection(CODEGEN_SRC, "const UNREGISTERED_DEBT = [", "\n];");
const CODEGEN_UNREGISTERED_DEBT = [...codegenDebtSection.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);

// 恒久的に登録しない型。現時点で該当なし(将来 condition のような共有部品型の受け皿)。
const INTENTIONALLY_UNREGISTERED: string[] = [];

// 共有部品型(shared component type)。VALIDATOR_NAME には登録される($ref解決のため)が、
// envelope の dataschema ターゲットには絶対にならない設計として EVENT_NAMES から意図的に
// 除外されている(envelope.ts:70-72「condition is a shared component type」/:82-83「cite-ref
// is a shared component type」に明記済み。これは g93裁定の対象=登録漏れではなく、既存の
// 設計として最初から意図的)。
const SHARED_COMPONENT_TYPES = ["condition", "cite-ref"];

// 未解消の負債。第2波の艦は packages/truth が作業範囲外だったため登録できなかった
// (根拠: apps/api/src/market-intl-shipping-routes.ts:11-21 /
//  apps/api/src/market-routes.ts:1076-1081 / apps/api/src/observation-routes.ts:84-88)。
// 制約は既に解けている。次ラウンド以降でスキーマを起草し、この配列から1件ずつ減らす。
// ★この配列は増やすな。増やす必要が出たら設計判断として考える役へ差し戻せ。
const UNREGISTERED_DEBT: string[] = [
  "mkt-listing-intl",          // 第2波 w2-mkt。設計コメントで自認済み
  "mkt-intl-shipping-rate",    // 同上
  "mkt-platinum-symbol",       // 177aa89 (2026-07-31 w2-mkt 検収)
  "mkt-platinum-symbol-right", // 177aa89
  "mkt-relist-policy",         // 177aa89。設計コメントで自認済み
  "mkt-relist-event",          // 177aa89。設計コメントで自認済み
  "plaza-dm-thread",           // 9025e6f (2026-07-31 w2-plaza 検収)
  "plaza-dm-message",          // 9025e6f
  "wiki-template",             // 9025e6f
  "obs-poll-interval",         // 69d7b43 (2026-07-31 w2-obs 検収)
];

// apps/api/src/**/*.ts を再帰的に読み、schemas/(events|frozen)/*.schema.json への文字列参照を
// 全て集める(_SCHEMA=定数・dataschema:オブジェクトキー・envelope()ヘルパへの位置引数、いずれの
// 書き方でも拾える広いパターン。#10 obs-poll-interval と #11 obs-photo-meta は _SCHEMA 定数を
// 持たずリテラル直書きなので、狭いパターンだけだと検出漏れする — g93裁定T4の指摘どおり。
// さらに実測すると obs-photo-meta は dataschema:キーですらなくenvelope()への第3位置引数
// だったため、パターンをキー名に依存しない汎用形へ広げた)。
function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) listTsFiles(full, out);
    else if (name.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const SCHEMA_REF_RE = /["'`](schemas\/(events|frozen)\/[a-z0-9-]+\.schema\.json)["'`]/g;
const callerReferencedPaths = new Set<string>();
for (const file of listTsFiles(join(ROOT, "apps", "api", "src"))) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(SCHEMA_REF_RE)) callerReferencedPaths.add(m[1]);
}

describe("g93 event-registry-wiring — 呼出側 → 登録(全数突合)", () => {
  it("apps/api/src が参照する schemas/(events|frozen)/*.schema.json は、UNREGISTERED_DEBT を除き全てファイルが実在する", () => {
    // UNREGISTERED_DEBT の型は「制約由来の先送り」= schemaファイル自体がまだ書かれていない
    // (g93裁定§0訂正①)。呼出側は将来のパスを先に文字列で参照しているだけなので、この型に限り
    // ファイル不在を許容する。
    const missing: string[] = [];
    for (const rel of callerReferencedPaths) {
      const kebab = kebabOf(rel.split("/").pop()!);
      if (UNREGISTERED_DEBT.includes(kebab)) continue;
      const abs = join(ROOT, rel);
      try {
        readFileSync(abs, "utf8");
      } catch {
        missing.push(rel);
      }
    }
    expect(missing, `referenced but missing schema file: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("呼出側が参照する各型は EVENT_NAMES/FROZEN_NAMES に登録されている(負債型を除く)", () => {
    const unwired: string[] = [];
    for (const rel of callerReferencedPaths) {
      const kebab = kebabOf(rel.split("/").pop()!);
      if (
        UNREGISTERED_DEBT.includes(kebab) ||
        INTENTIONALLY_UNREGISTERED.includes(kebab) ||
        SHARED_COMPONENT_TYPES.includes(kebab)
      )
        continue;
      const isFrozen = rel.startsWith("schemas/frozen/");
      const registered = isFrozen ? FROZEN_NAMES.has(kebab) : EVENT_NAMES.has(kebab);
      if (!registered) unwired.push(rel);
    }
    expect(unwired, `unwired in EVENT_NAMES/FROZEN_NAMES: ${JSON.stringify(unwired)}`).toEqual([]);
  });

  it("呼出側が参照する各型は VALIDATOR_NAME に登録されている(負債型を除く)", () => {
    const unwired: string[] = [];
    for (const rel of callerReferencedPaths) {
      const kebab = kebabOf(rel.split("/").pop()!);
      if (UNREGISTERED_DEBT.includes(kebab) || INTENTIONALLY_UNREGISTERED.includes(kebab)) continue;
      if (!VALIDATOR_NAME.has(kebab)) unwired.push(rel);
    }
    expect(unwired, `unwired in VALIDATOR_NAME: ${JSON.stringify(unwired)}`).toEqual([]);
  });
});

describe("g93 event-registry-wiring — schemaファイル → 登録(全数突合)", () => {
  it("schemas/events/*.schema.json(envelope除く)は全て EVENT_NAMES に在る(負債型を除く)", () => {
    const missing = schemaFiles("events")
      .map(kebabOf)
      .filter(
        (k) =>
          !UNREGISTERED_DEBT.includes(k) &&
          !INTENTIONALLY_UNREGISTERED.includes(k) &&
          !SHARED_COMPONENT_TYPES.includes(k),
      )
      .filter((k) => !EVENT_NAMES.has(k));
    expect(missing, `missing from EVENT_NAMES: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("schemas/frozen/*.schema.json は全て FROZEN_NAMES に在る", () => {
    const missing = schemaFiles("frozen")
      .map(kebabOf)
      .filter((k) => !FROZEN_NAMES.has(k));
    expect(missing, `missing from FROZEN_NAMES: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("schemas/events + schemas/frozen(envelope除く)は全て VALIDATOR_NAME に在る(負債型を除く)", () => {
    const missing = [...schemaFiles("events"), ...schemaFiles("frozen")]
      .map(kebabOf)
      .filter((k) => !UNREGISTERED_DEBT.includes(k) && !INTENTIONALLY_UNREGISTERED.includes(k))
      .filter((k) => !VALIDATOR_NAME.has(k));
    expect(missing, `missing from VALIDATOR_NAME: ${JSON.stringify(missing)}`).toEqual([]);
  });
});

describe("g93 event-registry-wiring — codegen-validators.mjs SCHEMAS 配列との一致", () => {
  it("schemas/events + schemas/frozen(envelope除く)は全て SCHEMAS 配列に在る(負債型を除く)", () => {
    const missing: string[] = [];
    for (const category of ["events", "frozen"] as const) {
      for (const f of schemaFiles(category)) {
        const kebab = kebabOf(f);
        if (UNREGISTERED_DEBT.includes(kebab) || INTENTIONALLY_UNREGISTERED.includes(kebab)) continue;
        if (!CODEGEN_SCHEMA_PATHS.has(`${category}/${f}`)) missing.push(`${category}/${f}`);
      }
    }
    expect(missing, `missing from codegen SCHEMAS: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("codegen-validators.mjs の UNREGISTERED_DEBT と本テストの UNREGISTERED_DEBT は一致する(2箇所ズレ防止)", () => {
    expect([...CODEGEN_UNREGISTERED_DEBT].sort()).toEqual([...UNREGISTERED_DEBT].sort());
  });

  it("UNREGISTERED_DEBT は増える方向を許さない(上限アサート。減る方向は自由)", () => {
    expect(UNREGISTERED_DEBT.length).toBeLessThanOrEqual(10);
  });
});

// index.ts の SELF_SERVICE_EVENT_TYPES / SELF_SERVICE_DATASCHEMAS も export されていないため、
// 同じ文字列読み取り作法で突合する(T5で追加した対応表が SELF_SERVICE_EVENT_TYPES の全要素を
// カバーしているかを機械で守る)。
const INDEX_SRC = readFileSync(join(ROOT, "apps", "api", "src", "index.ts"), "utf8");
const selfServiceTypesSection = extractSection(
  INDEX_SRC,
  "const SELF_SERVICE_EVENT_TYPES = new Set<string>([",
  "\n]);",
);
const SELF_SERVICE_EVENT_TYPES = [...selfServiceTypesSection.matchAll(/"(ihl\.[a-z0-9_.]+)"/g)].map((m) => m[1]);

const selfServiceDataschemasSection = extractSection(
  INDEX_SRC,
  "const SELF_SERVICE_DATASCHEMAS: Record<string, readonly string[]> = {",
  "\n};",
);
const SELF_SERVICE_DATASCHEMAS_KEYS = new Set(
  [...selfServiceDataschemasSection.matchAll(/"(ihl\.[a-z0-9_.]+)":/g)].map((m) => m[1]),
);

describe("g93 event-registry-wiring — POST /events の dataschema 対応表(J4)", () => {
  it("SELF_SERVICE_EVENT_TYPES の各要素は SELF_SERVICE_DATASCHEMAS にエントリを持つ", () => {
    const missing = SELF_SERVICE_EVENT_TYPES.filter((t) => !SELF_SERVICE_DATASCHEMAS_KEYS.has(t));
    expect(missing, `missing from SELF_SERVICE_DATASCHEMAS: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
