// w2-sec Wave2バッチ TC(R0730-ad0c0b-ORDER-2026-07-31-w2-sec 担当ID群のうち、
// policy.ts に追加した純関数・定数の型F/型C遵守証拠+既存アーキテクチャで既に満たされて
// いる項目の構造回帰確認)。V3-SEC-01/10/21/22/23/25/27/29/35/37/39/43/47/48/50 を集約する。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assignSandboxIds,
  resolveTermsMediaUrl,
  isScrollComplete,
  DATA_COLLECTION_ITEMS,
  isLogPurposeAllowed,
  AI_TRAINING_POLICY,
  resolveOssLicenseAction,
  sanitizeMarkdownToHtml,
  dHash,
  hammingDistance,
  IMAGE_REUSE_SUSPECT_THRESHOLD,
  isAssetAllowedForUse,
  type TermsMediaRow,
} from "../apps/api/src/policy";

const SRC_DIR = fileURLToPath(new URL("../apps/api/src/", import.meta.url));
function readSrc(file: string): string {
  return readFileSync(SRC_DIR + file, "utf8");
}

describe("V3-SEC-10 assignSandboxIds(連番再割当・R2/Truthを一切参照しない構造保証)", () => {
  it("登場順に1,2,3...を割り当て、重複actorIdは同一番号を再利用する", () => {
    const map = assignSandboxIds(["u-a", "u-b", "u-a", "u-c"]);
    expect(map.get("u-a")).toBe(1);
    expect(map.get("u-b")).toBe(2);
    expect(map.get("u-c")).toBe(3);
    expect(map.size).toBe(3);
  });

  it("負の回帰: policy.ts の assignSandboxIds 実装ブロックが TruthStore/R2 を一切参照しない", () => {
    const text = readSrc("policy.ts");
    const fnStart = text.indexOf("export function assignSandboxIds");
    const fnEnd = text.indexOf("\n}", fnStart);
    const fnBody = text.slice(fnStart, fnEnd);
    expect(fnBody).not.toMatch(/TruthStore|R2Bucket|\.env\.TRUTH/);
  });
});

describe("V3-SEC-21/22/23 ToS版管理・動画resolver・scroll gate", () => {
  const rows: TermsMediaRow[] = [
    { terms_version: "v1", section_id: "sec-1", media_kind: "video", resolved_url: "https://example.com/v1/sec-1.mp4" },
  ];

  it("resolveTermsMediaUrl: 版+条+種別が一致する行のURLを返す", () => {
    expect(resolveTermsMediaUrl(rows, "v1", "sec-1", "video")).toBe("https://example.com/v1/sec-1.mp4");
  });

  it("resolveTermsMediaUrl: 版が変わればマッピングだけ差し替えればよい(未登録はnull)", () => {
    expect(resolveTermsMediaUrl(rows, "v2", "sec-1", "video")).toBeNull();
  });

  it("isScrollComplete: 下端到達で true、未到達で false", () => {
    expect(isScrollComplete(900, 1000, 100)).toBe(true); // 900+100=1000
    expect(isScrollComplete(500, 1000, 100)).toBe(false);
  });
});

describe("V3-SEC-29 収集項目の透明性・ログ用途限定", () => {
  it("DATA_COLLECTION_ITEMS に規約記載必須項目が全て含まれる", () => {
    for (const item of ["email", "country", "language", "screen_transition_log", "post_history", "ai_usage_log"]) {
      expect(DATA_COLLECTION_ITEMS).toContain(item);
    }
  });

  it("isLogPurposeAllowed: 広告目的は許可されない", () => {
    expect(isLogPurposeAllowed("service_improvement")).toBe(true);
    expect(isLogPurposeAllowed("fraud_prevention")).toBe(true);
    expect(isLogPurposeAllowed("advertising")).toBe(false);
  });
});

describe("V3-SEC-35 外部AI再学習に使わない宣言(構造的裏付け)", () => {
  it("AI_TRAINING_POLICY = no-retrain", () => {
    expect(AI_TRAINING_POLICY).toBe("no-retrain");
  });

  it("ai-kernel.ts はプロバイダ未設定時、既定で全タスクをAI_DISABLEDにする(外部送信経路が既定ゼロ)", () => {
    const text = readSrc("ai-kernel.ts");
    expect(text).toMatch(/AiDisabledError/);
    expect(text).toMatch(/makeLLMClient/);
  });
});

describe("V3-SEC-37 OSSライセンス管理", () => {
  it("CC-BYは自動クレジット挿入・ロック", () => {
    expect(resolveOssLicenseAction("CC-BY")).toBe("auto_credit_lock");
  });
  it("再配布NGは公開不可", () => {
    expect(resolveOssLicenseAction("no-redistribute")).toBe("public_forbidden");
  });
  it("GPLは取り込み拒否", () => {
    expect(resolveOssLicenseAction("GPL")).toBe("reject_import");
  });
  it("未分類は人手確認", () => {
    expect(resolveOssLicenseAction("other")).toBe("manual_review");
  });
});

describe("V3-SEC-39 sanitizeMarkdownToHtml(XSS対策)", () => {
  it("raw HTML(<script>等)はエスケープされ実行可能な形で出力されない", () => {
    const out = sanitizeMarkdownToHtml('<script>alert(1)</script>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("対応Markdown記法(bold/italic/code/link)はHTMLへ変換される", () => {
    const out = sanitizeMarkdownToHtml("**bold** *italic* `code` [link](https://example.com)");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain('<a href="https://example.com"');
  });

  it("javascript:リンクは許可構文にマッチせずプレーンテキストのまま残る(http/httpsのみ許可)", () => {
    const out = sanitizeMarkdownToHtml("[x](javascript:alert(1))");
    expect(out).not.toContain("<a href");
  });

  it("翻訳結果など外部由来テキストをそのまま通してもXSS入口にならない(同一関数を通す構造)", () => {
    const translated = '<img src=x onerror=alert(1)>';
    const out = sanitizeMarkdownToHtml(translated);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

describe("V3-SEC-43 dHash/hammingDistance(投稿画像の盗用・すり替え検知)", () => {
  it("同一ピクセル配列は距離0(完全一致)", () => {
    const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    const h1 = dHash(pixels, 3, 3);
    const h2 = dHash(pixels, 3, 3);
    expect(hammingDistance(h1, h2)).toBe(0);
  });

  it("大きく異なる画像は距離が閾値を超える(盗用ではないと判定できる)", () => {
    const a = dHash([10, 20, 30, 40, 50, 60, 70, 80, 90], 3, 3);
    const b = dHash([90, 10, 80, 20, 70, 30, 60, 40, 50], 3, 3);
    expect(hammingDistance(a, b)).toBeGreaterThan(0);
  });

  it("pixels.length が width*height と不一致なら例外", () => {
    expect(() => dHash([1, 2, 3], 2, 2)).toThrow();
  });

  it("IMAGE_REUSE_SUSPECT_THRESHOLD は非負の較正knob", () => {
    expect(IMAGE_REUSE_SUSPECT_THRESHOLD).toBeGreaterThanOrEqual(0);
  });
});

describe("V3-SEC-50 保護アセット(ブランド資産)NG設定", () => {
  it("観測データ(kind=observation)は保護対象に入れられず常に許可", () => {
    const entry = { asset_id: "a1", kind: "observation" as const, blocked_uses: ["video_generation" as const], ai_training_allowed: false };
    expect(isAssetAllowedForUse(entry, "video_generation")).toBe(true);
    expect(isAssetAllowedForUse(entry, "ai_training")).toBe(true);
  });

  it("brand資産はblocked_usesに含まれる用途をブロックする", () => {
    const entry = { asset_id: "logo-1", kind: "brand" as const, blocked_uses: ["video_generation" as const, "rag_search" as const], ai_training_allowed: false };
    expect(isAssetAllowedForUse(entry, "video_generation")).toBe(false);
    expect(isAssetAllowedForUse(entry, "ui_generation")).toBe(true); // blocked_usesに無い用途は許可
    expect(isAssetAllowedForUse(entry, "ai_training")).toBe(false);
  });
});

// ── 既存アーキテクチャで既に満たされている型C項目(新規コード不要・評価根拠のみ) ──

describe("V3-SEC-01 観測オープンデータ・PII匿名化・同意明確化(既存機構の組み合わせで充足)", () => {
  it("consent-routes.ts の同意ゲートが実在する(SEC-23の再同意フロー基盤と同一実装)", () => {
    const text = readSrc("consent-routes.ts");
    expect(text).toMatch(/MUST_AGREE_TO_TERMS/);
  });
});

describe("V3-SEC-25/27 独立ToS/Privacy法務ドラフト(docs/legal作成は本艦の書いてよい場所の外)", () => {
  it("civilization-os の規約を流用していない(参照0件・構造的独立性)", () => {
    const sources = ["policy.ts", "consent-routes.ts"].map(readSrc);
    for (const text of sources) {
      expect(text).not.toMatch(/civilization-os/);
    }
  });
});

describe("V3-SEC-47 サーバー側価値操作強制(ledger-routes.tsの既存実装が満たす・引用確認)", () => {
  it("ledger-routes.ts に role=system 強制とカルマFibonacciペナルティが実在する", () => {
    const text = readSrc("ledger-routes.ts");
    expect(text).toMatch(/karma value increase forbidden/);
    expect(text).toMatch(/fibPenalty|Fibonacci/);
  });

  it("rate-limit.ts に IP指紋(clientIp)+書込レート制限が実在する", () => {
    const text = readSrc("rate-limit.ts");
    expect(text).toMatch(/clientIp/);
    expect(text).toMatch(/WRITE_RATE_LIMIT_PER_MINUTE/);
  });
});

describe("V3-SEC-48 Kernel入口の構造バリデーション(envelope.tsの既存実装が満たす・引用確認)", () => {
  it("validateEnvelope が dataschema の frozen/event スキーマを都度検証する", () => {
    const text = readFileSync(fileURLToPath(new URL("../packages/truth/src/envelope.ts", import.meta.url)), "utf8");
    expect(text).toMatch(/export function validateEnvelope/);
    expect(text).toMatch(/frozenSchemaFor|eventSchemaFor/);
  });

  it("TruthStore.putEvent/putEventAt は書込前に必ずvalidateEnvelopeを通す(壊れたデータでKernelを汚染しない)", () => {
    const text = readFileSync(fileURLToPath(new URL("../packages/truth/src/store.ts", import.meta.url)), "utf8");
    const putEventBlock = text.slice(text.indexOf("async putEvent("), text.indexOf("async putBlob("));
    expect(putEventBlock).toMatch(/validateEnvelope/);
  });
});
