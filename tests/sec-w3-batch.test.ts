// w3-sec Wave3持ち越し回収バッチTC(R0731-e53185-ORDER-2026-07-31-w3-sec 担当7件のうち
// 62代目HQ検収是正 R0731-14f1df が指摘した未実装ギャップを埋める追加実装の型F証拠)。
// V3-SEC-43(EXIF/成長曲線/特徴点/event記録)・V3-SEC-44(2系統自動切替)・
// V3-SEC-47(DM取引禁止/デバイス指紋)を対象とする。
import { describe, expect, it } from "vitest";
import {
  checkExifConsistency,
  checkGrowthCurveConsistency,
  checkFeaturePointConsistency,
  buildImageReuseSilentWarning,
  isDmTradeAllowed,
  deriveDeviceFingerprint,
} from "../apps/api/src/policy";
import { dispatchQrPayload, generateQrEncryptionKey, generateQrSigningKeyPair } from "../apps/api/src/hmac-qr";

describe("V3-SEC-43 checkExifConsistency(時系列逆行・デバイス系列の矛盾検知)", () => {
  it("時系列が順行しデバイスが一致すれば整合", () => {
    expect(
      checkExifConsistency(
        { captured_at: "2026-01-01T00:00:00Z", device_model: "cam-1" },
        { captured_at: "2026-02-01T00:00:00Z", device_model: "cam-1" },
      ),
    ).toBe(true);
  });

  it("時系列が逆行すれば不整合", () => {
    expect(
      checkExifConsistency(
        { captured_at: "2026-02-01T00:00:00Z" },
        { captured_at: "2026-01-01T00:00:00Z" },
      ),
    ).toBe(false);
  });

  it("撮影デバイスが食い違えば不整合", () => {
    expect(
      checkExifConsistency(
        { captured_at: "2026-01-01T00:00:00Z", device_model: "cam-1" },
        { captured_at: "2026-02-01T00:00:00Z", device_model: "cam-2" },
      ),
    ).toBe(false);
  });
});

describe("V3-SEC-43 checkGrowthCurveConsistency(成長曲線の単調非減少)", () => {
  it("単調非減少なら整合", () => {
    const points = [
      { observed_at: "2026-01-01", size_cm: 10 },
      { observed_at: "2026-02-01", size_cm: 12 },
      { observed_at: "2026-03-01", size_cm: 12.3 },
    ];
    expect(checkGrowthCurveConsistency(points)).toBe(true);
  });

  it("許容誤差を超えて縮小したら不整合(すり替え疑い)", () => {
    const points = [
      { observed_at: "2026-01-01", size_cm: 20 },
      { observed_at: "2026-02-01", size_cm: 8 },
    ];
    expect(checkGrowthCurveConsistency(points)).toBe(false);
  });

  it("観測順が前後していても内部でソートして判定する", () => {
    const points = [
      { observed_at: "2026-03-01", size_cm: 12 },
      { observed_at: "2026-01-01", size_cm: 10 },
    ];
    expect(checkGrowthCurveConsistency(points)).toBe(true);
  });
});

describe("V3-SEC-43 checkFeaturePointConsistency(特徴点一致率)", () => {
  it("十分な数の特徴点が近傍一致すれば整合(同一個体)", () => {
    const a: [number, number][] = [[0, 0], [1, 1], [2, 2]];
    const b: [number, number][] = [[0.1, 0.1], [1.1, 1.1], [2.1, 2.1]];
    expect(checkFeaturePointConsistency(a, b, 0.5)).toBe(true);
  });

  it("一致率が閾値未満なら不整合(別個体疑い)", () => {
    const a: [number, number][] = [[0, 0], [1, 1], [2, 2]];
    const b: [number, number][] = [[50, 50], [60, 60], [70, 70]];
    expect(checkFeaturePointConsistency(a, b, 0.5)).toBe(false);
  });

  it("片方が空配列なら不整合(判定不能を安全側=falseに倒す)", () => {
    expect(checkFeaturePointConsistency([], [[0, 0]], 0.5)).toBe(false);
  });
});

describe("V3-SEC-43 buildImageReuseSilentWarning(ひっそり警告のevent記録形)", () => {
  it("event_type固定・理由配列と日時をそのまま保持する", () => {
    const w = buildImageReuseSilentWarning(["dhash_similar", "exif_inconsistent"], "2026-07-31T00:00:00Z");
    expect(w.event_type).toBe("image_reuse_suspect");
    expect(w.reasons).toEqual(["dhash_similar", "exif_inconsistent"]);
    expect(w.flagged_at).toBe("2026-07-31T00:00:00Z");
  });
});

describe("V3-SEC-44 dispatchQrPayload(公開用/観測管理用の自動切替)", () => {
  it("public指定は平文のまま返す", async () => {
    const result = await dispatchQrPayload("public", { specimen_id: "s-1" });
    expect(result.kind).toBe("public");
    expect((result as { data: unknown }).data).toEqual({ specimen_id: "s-1" });
  });

  it("internal指定は暗号化+署名済みトークンを返す(平文が露出しない)", async () => {
    const encKey = await generateQrEncryptionKey();
    const { publicKey, privateKey } = await generateQrSigningKeyPair();
    const result = await dispatchQrPayload(
      "internal",
      { secret: "internal-only" },
      { encKey, signPrivateKey: privateKey },
    );
    expect(result.kind).toBe("internal");
    const asInternal = result as { ciphertext_b64: string; signature_b64: string };
    expect(asInternal.ciphertext_b64).not.toContain("internal-only");
    expect(typeof asInternal.signature_b64).toBe("string");
    void publicKey; // 署名検証(往復)はhmac-qr.test.tsのopenInternalQrTokenで既に確認済み
  });

  it("internal指定で鍵未指定なら例外(平文フォールバックを構造的に禁止)", async () => {
    await expect(dispatchQrPayload("internal", { x: 1 })).rejects.toThrow();
  });
});

describe("V3-SEC-47 isDmTradeAllowed(DM個別取引禁止)", () => {
  it("通常のDM本文は許可", () => {
    expect(isDmTradeAllowed("こんにちは、観測データ見ました!")).toBe(true);
  });

  it("coin授受のトリガー文言は拒否", () => {
    expect(isDmTradeAllowed("コインを送ってください")).toBe(false);
    expect(isDmTradeAllowed("please transfer 10 coin to me")).toBe(false);
  });

  it("karma授受のトリガー文言は拒否", () => {
    expect(isDmTradeAllowed("カルマ渡すよ")).toBe(false);
  });
});

describe("V3-SEC-47 deriveDeviceFingerprint(IP/デバイス指紋)", () => {
  it("同一入力は同一指紋(決定論)", async () => {
    const a = await deriveDeviceFingerprint("203.0.113.1", "Mozilla/5.0 test");
    const b = await deriveDeviceFingerprint("203.0.113.1", "Mozilla/5.0 test");
    expect(a).toBe(b);
  });

  it("入力が違えば指紋も異なる", async () => {
    const a = await deriveDeviceFingerprint("203.0.113.1", "Mozilla/5.0 test");
    const b = await deriveDeviceFingerprint("203.0.113.2", "Mozilla/5.0 test");
    expect(a).not.toBe(b);
  });

  it("SHA-256hex(64桁16進)の形式で返る", async () => {
    const fp = await deriveDeviceFingerprint("203.0.113.1", "ua");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
