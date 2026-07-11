// C5 K2 PII エンジン + route 045 TC (design-c5-k2 §1.1/§1.2 / V3-SEC-07 / V3-SEC-13).
// detectPii/maskPii の型別検出・置換、POST /api/v1/settings/pii-session の非永続
// (生 email が Truth に1件も無い = マスク前保存禁止の構造充足)、deriveEmailIndex
// の安定 sha256 hex(async・crypto.subtle)、redactForPublic の構造化ID保持/住所末尾4桁。
import { describe, expect, it } from "vitest";
import app from "../apps/api/src/index";
import {
  detectPii,
  maskPii,
  redactForPublic,
  deriveEmailIndex,
} from "../apps/api/src/pii.mjs";
import { DEV_TOKEN, FakeR2Bucket, makeEnv } from "./helpers";

const AUTH = { Authorization: `Bearer ${DEV_TOKEN}`, "content-type": "application/json" };

// 各 PII 型の最小サンプル(単独で全体がその型の1マッチになる clean 入力)。
const SAMPLES: { type: string; text: string }[] = [
  { type: "EMAIL", text: "alice@example.com" },
  { type: "PHONE_JP", text: "090-1234-5678" },
  { type: "CREDIT_CARD", text: "4111 1111 1111 1111" },
  { type: "COORDS", text: "35.6812,139.7671" },
  { type: "SNS_ID", text: "@alice_handle" },
  {
    type: "PEM_PRIVATE_KEY",
    text: "-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkq\n-----END PRIVATE KEY-----",
  },
  { type: "ENV_SECRET", text: "sk-abcdefghij0123456789" },
  { type: "ADDRESS_JP", text: "〒150-0001 東京都渋谷区神宮前1-2-3" },
];

describe("V3-SEC-07 detectPii / maskPii(型別・決定論 regex)", () => {
  it("各型を単独サンプルで検出する", () => {
    for (const { type, text } of SAMPLES) {
      const types = detectPii(text).map((f) => f.type);
      expect(types, type).toContain(type);
    }
  });

  it("maskPii は各出現を {{PII:<TYPE>}} に置換する", () => {
    for (const { type, text } of SAMPLES) {
      expect(maskPii(text).masked, type).toBe(`{{PII:${type}}}`);
    }
  });

  it("複数型が混在した1文でも全て置換され原文の PII は残らない", () => {
    const text = "連絡は alice@example.com か 090-1234-5678、位置 35.6812,139.7671";
    const { masked, findings } = maskPii(text);
    expect(masked).toContain("{{PII:EMAIL}}");
    expect(masked).toContain("{{PII:PHONE_JP}}");
    expect(masked).toContain("{{PII:COORDS}}");
    expect(masked).not.toContain("alice@example.com");
    expect(masked).not.toContain("090-1234-5678");
    expect(findings.length).toBe(3);
  });
});

describe("V3-SEC-07 POST /api/v1/settings/pii-session(route 045・非永続)", () => {
  it("未認証 → 401(deny-by-default)", async () => {
    const res = await app.request(
      "/api/v1/settings/pii-session",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) },
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("masked/findings/count を返し、生 email は Truth に1件も append されない", async () => {
    const bucket = new FakeR2Bucket();
    const raw = "私のメールは bob@example.com です";
    const res = await app.request(
      "/api/v1/settings/pii-session",
      { method: "POST", headers: AUTH, body: JSON.stringify({ text: raw }) },
      makeEnv(bucket),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { masked: string; findings: unknown[]; count: number };
    expect(body.masked).toContain("{{PII:EMAIL}}");
    expect(body.masked).not.toContain("bob@example.com");
    expect(body.count).toBe(body.findings.length);
    expect(body.count).toBe(1);
    // マスク前非保存の強制: バケット内のどのオブジェクトにも生 email が無い(= 非永続)。
    for (const rec of bucket.objects.values()) {
      const stored = typeof rec.body === "string" ? rec.body : new TextDecoder().decode(rec.body);
      expect(stored).not.toContain("bob@example.com");
    }
    expect(bucket.objects.size).toBe(0);
  });

  it("text 欠落 → 400", async () => {
    const res = await app.request(
      "/api/v1/settings/pii-session",
      { method: "POST", headers: AUTH, body: JSON.stringify({}) },
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe("deriveEmailIndex(async・crypto.subtle SHA-256 hex)", () => {
  it("同一 email で安定・正規化不変(trim/lowercase)・64桁 hex", async () => {
    const a = await deriveEmailIndex("Alice@Example.com");
    const b = await deriveEmailIndex("  alice@example.com  ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const again = await deriveEmailIndex("alice@example.com");
    expect(again).toBe(a);
    const other = await deriveEmailIndex("carol@example.com");
    expect(other).not.toBe(a);
  });
});

describe("V3-SEC-13 redactForPublic(構造化ID保持・住所末尾4桁)", () => {
  it("TRK/ULID は保持し、住所は末尾4文字を残し他 PII はマスク", () => {
    // TRK-<16桁> は単体では CREDIT_CARD にヒットするが、許可 span 内なので保持される。
    const text =
      "追跡 TRK-4111111111111111 画像 01ARZ3NDEKTSV4RRFFQ69G5FAV 連絡 bob@example.com 住所 〒150-0001 東京都渋谷区神宮前1-2-3";
    const { redacted, findings } = redactForPublic(text);

    // 構造化ID(TRK 追跡番号・ULID=観測画像/trade_event ID)は非マスクで残る。
    expect(redacted).toContain("TRK-4111111111111111");
    expect(redacted).toContain("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    // 許可 span 内の CREDIT_CARD は redact 対象から除外されている。
    expect(findings.some((f) => f.type === "CREDIT_CARD")).toBe(false);

    // 他 PII(email)はマスク。
    expect(redacted).toContain("{{PII:EMAIL}}");
    expect(redacted).not.toContain("bob@example.com");

    // 住所は末尾4文字を保持し、precise な前半はマスク。
    const addr = findings.find((f) => f.type === "ADDRESS_JP");
    expect(addr).toBeDefined();
    const tail = text.slice(addr!.start, addr!.end).slice(-4);
    expect(redacted).toContain(`{{PII:ADDRESS_JP}}${tail}`);
    expect(redacted).not.toContain("東京都渋谷区神宮前");
  });

  it("maskPii は許可せず TRK 内の CREDIT_CARD もマスクする(redact との対比)", () => {
    const { masked } = maskPii("TRK-4111111111111111");
    expect(masked).toContain("{{PII:CREDIT_CARD}}");
  });
});
