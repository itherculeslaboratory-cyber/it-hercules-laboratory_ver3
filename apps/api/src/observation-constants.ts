// C5 K1 frozen constants — single source of truth for observation/individual
// tuning values. Scatter these as literals across route files and they drift;
// keep them here and every projection reads the same number.
// x_ihl_req: V3-OBS-06/07/09/10/11/20/21/45/56 · V3-IND-07/15
// x_ihl_source: docs/planning/c5/design-k1.md §1.6

/** rerank blend weights (OBS-11 / ADR-H-12). Sum = 1.0. */
export const RERANK_WEIGHTS = {
  embedding: 0.5,
  color: 0.2,
  size: 0.2,
  lineage: 0.1,
} as const;

/** default score for a missing rerank component (OBS-11). */
export const RERANK_MISSING = { color: 0.5, size: 0.5, lineage: 0.0 } as const;

/** preference online-learning rate α in w ← w + α·y·x (IND-07). */
export const LEARNING_RATE = 0.1;

/** AUC threshold for a "valid"/converged preference model (IND-08). */
export const MATCH_AUC_VALID_THRESHOLD = 0.7;

/** V3-IND-09「N問到達での打ち切り」— Pairwise比較(②)の進捗チップ/打ち切り目安の
 * 質問数。要件本文・design35とも具体数は未確定のため、UX慣例値(10問前後)を暫定既定
 * として置く(人間裁定で差し替え可・PATCH機構は未実装のためこの定数を直接編集する)。 */
export const IND09_PAIRWISE_QUESTION_TARGET = 10;

/** V3-UIX-21: 検索結果への好み(preference)ブレンド比率。OBS-11 の compositeScore
 * (embedding/color/size/lineage・ADR-H-12・sum=1.0)は変更せず、その結果へ追加で
 * 上書きブレンドする独立レイヤーとして personalize=true 時のみ効かせる(既定 rerank
 * 挙動を壊さない・ADR 再交渉なし)。finalScore = (1-w)·compositeScore + w·preference。 */
export const PERSONALIZE_WEIGHT = 0.25;

/** allowed QR batch sizes (IND-15). */
export const QR_BATCH_SIZES = [100, 500, 1000] as const;

/** max individual_ids per POST /individuals/bio-card-batch request. Design
 * placeholder, not measured (real usage: user reports 15 individuals kept —
 * 200 is a ~13x headroom, not a load-tested ceiling). Raise if it turns out
 * insufficient (R0807-d763a2-DESIGN §3-A). */
export const BIO_CARD_BATCH_MAX = 200;

/** stage→next-observation interval in days (OBS-21 example values). */
export const SCHEDULE_STAGE_INTERVAL_DAYS = {
  first_to_second: 30,
  second_to_third: 30,
} as const;

/** current life-event stage (to_stage vocabulary: first/second/third_early/…)
 *  → the SCHEDULE_STAGE_INTERVAL_DAYS transition key for "what's next from here"
 *  (V3-IND-20 スケジュール自動生成). Stages past `second` have no interval yet
 *  (OBS-21 の例示値がここまでしか無い) — 未知は呼び出し側で 400(推測しない)。 */
export const STAGE_TO_NEXT_TRANSITION: Record<string, keyof typeof SCHEDULE_STAGE_INTERVAL_DAYS> = {
  first: "first_to_second",
  second: "second_to_third",
};

/** target-navigator convergence bound: questions to reach a species (OBS-02). */
export const NAVIGATOR_TARGET_QUESTIONS = { min: 7, max: 12 } as const;

/** scale-paper print spec (OBS-45). Physical calibration knob — tolerance_mm is
 *  the real-world print/cut slack, not a code constant to zero out. */
export const SCALE_PAPER = {
  sheet: "A4",
  grid_cm: { w: 19, h: 26 },
  marker_mm: 10,
  qr_mm: 15,
  thin_line_mm: 1,
  thick_line_mm: 10,
  tolerance_mm: 0.2,
} as const;

/** embedding vector dimension (OBS-09/10). Mirrors observation-routes.ts. */
export const EMBEDDING_DIM = 384;

/**
 * OBS-45/53 pixel->mm calibration: realLength = pixelLength × mmPerPixel,
 * where mmPerPixel is derived from the scale paper's KNOWN physical marker
 * size (SCALE_PAPER.marker_mm) measured in pixels. The corner-detection +
 * projective-transform step that PRODUCES markerPixelLength runs client-side
 * (browser Canvas/WASM, OFF the server — V3-AIP-104/invariant①); this function
 * is the shared, pure formula both a client implementation and a test/design
 * doc can point at. Returns null on a degenerate/failed detection
 * (markerPixelLength <= 0) rather than silently producing a bogus scale.
 */
export function calibratedRealLengthMm(
  pixelLength: number,
  markerPixelLength: number,
  markerRealMm: number = SCALE_PAPER.marker_mm,
): number | null {
  if (!Number.isFinite(markerPixelLength) || markerPixelLength <= 0) return null;
  if (!Number.isFinite(pixelLength)) return null;
  const mmPerPixel = markerRealMm / markerPixelLength;
  return pixelLength * mmPerPixel;
}

/**
 * OBS-15: dew point / VPD / absolute humidity are recomputed from raw
 * temp_c + humidity_pct at QUERY time, never persisted to Truth (保存最小・
 * 決定論優先 — the formula can be swapped later without touching stored data).
 * Magnus-Tetens approximation (a/b below), valid over the sensor's normal
 * operating domain; returns all-null when humidityPct is outside (0,100]
 * or an input is non-finite, rather than emitting a bogus number (誇張ゼロ).
 */
const MAGNUS_A = 17.62;
const MAGNUS_B = 243.12; // °C

export function deriveEnvironmentValues(
  tempC: number,
  humidityPct: number,
): { dewPointC: number | null; vpdKPa: number | null; absHumidityGm3: number | null } {
  if (
    !Number.isFinite(tempC) ||
    !Number.isFinite(humidityPct) ||
    humidityPct <= 0 ||
    humidityPct > 100
  ) {
    return { dewPointC: null, vpdKPa: null, absHumidityGm3: null };
  }
  const satVaporKPa = 0.61078 * Math.exp((MAGNUS_A * tempC) / (MAGNUS_B + tempC));
  const actualVaporKPa = satVaporKPa * (humidityPct / 100);
  const alpha = Math.log(humidityPct / 100) + (MAGNUS_A * tempC) / (MAGNUS_B + tempC);
  const dewPointC = (MAGNUS_B * alpha) / (MAGNUS_A - alpha);
  const vpdKPa = satVaporKPa - actualVaporKPa;
  const absHumidityGm3 = (216.7 * (actualVaporKPa * 10)) / (273.15 + tempC);
  return { dewPointC, vpdKPa, absHumidityGm3 };
}

/**
 * value_origin → confidence grade (OBS-07). Covers ALL 9 frozen provenance
 * value_origin enum values (schemas/frozen/provenance.schema.json) so
 * confidenceGrade() is total and never returns undefined for a valid
 * measurement (批評家#2). Derived origins → ○, estimated/model/aggregate → △.
 */
export const CONFIDENCE_ORDER = {
  direct_observed: "◎",
  image_derived: "○",
  environment_derived: "○",
  lineage_derived: "○",
  estimated: "△",
  imputed: "△",
  aggregate: "△",
  model_inference: "△",
  unknown: "△",
} as const;

// ── V3-OBS-12: 標準撮影チャンバー(booth) ────────────────────────────────
/** Type-A=常設 / Type-B=可搬(booth_type on a capture's booth record). */
export const BOOTH_TYPES = ["fixed", "portable"] as const;
/** 5視点(上面/正面/背面/左右) — RAW(dng)+JPG(確認用)の2ファイルを視点ごとに紐づける。 */
export const CAPTURE_VIEWS = ["top", "front", "back", "left", "right"] as const;
export const CAPTURE_FILE_KINDS = ["raw", "jpg"] as const;

// ── V3-OBS-13: BPCMS v1.0(甲虫色彩計測標準規格・凍結) ────────────────────
export const BPCMS_VERSION = "1.0" as const;

/**
 * BPCMS v1.0 派生値レイヤー(R127/F-5): 生画像は無補正のまま保存(OBS-23)、Lab補正
 * 値は後処理で算出する別レイヤーとしてのみ持つ。CIE76(ΔE*ab)固定 — CIEDE2000への
 * 切替は別途確定(要件文どおり凍結対象外)。純関数: 画像内グレーカード基準Labから
 * サンプルの生Labを線形補正するだけで、生データそのものへは一切触れない。
 */
export function correctLabViaGreycard(
  sampleLab: { l: number; a: number; b: number },
  greycardMeasuredLab: { l: number; a: number; b: number },
  greycardReferenceLab: { l: number; a: number; b: number } = { l: 76.55, a: -0.5, b: 1.5 }, // X-Rite 18%グレー相当
): { l: number; a: number; b: number; bpcms_version: typeof BPCMS_VERSION } {
  return {
    l: sampleLab.l + (greycardReferenceLab.l - greycardMeasuredLab.l),
    a: sampleLab.a + (greycardReferenceLab.a - greycardMeasuredLab.a),
    b: sampleLab.b + (greycardReferenceLab.b - greycardMeasuredLab.b),
    bpcms_version: BPCMS_VERSION,
  };
}

/** CIE76 ΔE*ab(BPCMS v1.0 凍結式)。CIEDE2000切替タイミングは別途確定(要件文どおり)。 */
export function deltaE76(
  a: { l: number; a: number; b: number },
  b: { l: number; a: number; b: number },
): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/** g80-e2color: ΔE76(deltaE76)を RERANK_WEIGHTS.color スロット(0..1・大きいほど類似)へ
 *  正規化するための上限値。Lab空間のL(0-100)+a/b(概ね-128..127)の対角線的な実用上の
 *  上限として100を採る(この値を超えるΔE76は「もはや無関係な色」として類似度0に丸める・
 *  RERANK_WEIGHTS の数値自体は変更しない=定数は1箇所の規約どおり別定数として追加)。 */
export const COLOR_DELTA_E_NORM_MAX = 100;

/** ΔE76 → compositeScore の color スロット値(0..1・大きいほど類似)。0除算しない
 *  Math.max/minの単純clampで、負値や非有限値は0に丸める(誇張ゼロ=範囲外を推測しない)。 */
export function colorSimilarityFromDeltaE76(deltaE: number): number {
  if (!Number.isFinite(deltaE) || deltaE < 0) return 0;
  return Math.max(0, Math.min(1, 1 - deltaE / COLOR_DELTA_E_NORM_MAX));
}

// ── V3-OBS-30: デバイス取得間隔4階層(既定/一括上書き/複数選択/個別) ───────
/** クラウド最新値取得系(SwitchBot等)はDB格納値取得のみでリアルタイムでない=間隔設定は無意味。 */
export const CLOUD_POLL_PROVIDERS = new Set(["switchbot"]);
/** 自作デバイス(custom)は秒単位で細かく設定可能。既定は5分(既存TELEMETRY_BUCKET_MSと同スケール)。 */
export const DEFAULT_POLL_INTERVAL_SEC = 300;
export const CUSTOM_MIN_POLL_INTERVAL_SEC = 1;

// ── V3-OBS-38: 画像配信の低コスト改善(段階1) ─────────────────────────────
/** サムネイル/画像レスポンスのキャッシュ寿命(秒)。URL再利用・重複fetch削減の低コスト策。 */
export const MEDIA_CACHE_MAX_AGE_SEC = 3600;
/** テレメトリ保持ポリシー(3〜6ヶ月超はアーカイブ/削除対象・既定=保守的な6ヶ月側)。 */
export const TELEMETRY_RETENTION_MONTHS = 6;

/** bucket_start_ms が保持期間(TELEMETRY_RETENTION_MONTHS)を超えているか(OBS-38)。
 *  純関数: 実削除/アーカイブ処理は別レイヤー(バッチ)の責務、ここは判定のみ。 */
export function isTelemetryStale(bucketStartMs: number, nowMs: number): boolean {
  const retentionMs = TELEMETRY_RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000;
  return nowMs - bucketStartMs > retentionMs;
}

// ── V3-OBS-58: QC builder(blur/exposure/scale/background/occlusion) ──────
export const QC_FLAGS = ["usable", "warning", "reject", "unchecked"] as const;
export const QC_THRESHOLDS = {
  minEdgePx: 128, // scale: サムネイル長辺がこれ未満は解像度不足(reject)
  warnEdgePx: 256, // scale: これ未満はwarning
  maxFileBytes: 20 * 1024 * 1024, // exposure/background代理指標: 極端に大きい/小さいファイルは撮影条件異常の代理シグナル
  minFileBytes: 512,
} as const;

/**
 * QC builder(OBS-58) — 決定論ヒューリスティック(LLM/Vision既定OFF・不変条項①)。
 * blur/occlusion の画素解析は将来の client-side WASM 拡張の余地として qc_score
 * に0.5の中立値を残す(未実装機能を"検査済み"と偽らない=誇張ゼロ)。scale
 * (解像度)と exposure/background の代理指標(ファイルサイズ極端値)のみ、既存の
 * サムネイル生成結果(width/height/bytes)から決定論的に判定する。
 */
export function computeQcFlag(
  widthPx: number,
  heightPx: number,
  fileBytes: number,
): { qc_flag: (typeof QC_FLAGS)[number]; qc_score: number; reasons: string[] } {
  const reasons: string[] = [];
  const longEdge = Math.max(widthPx, heightPx);
  if (fileBytes < QC_THRESHOLDS.minFileBytes || fileBytes > QC_THRESHOLDS.maxFileBytes) {
    reasons.push("exposure_or_background_out_of_range");
  }
  if (longEdge < QC_THRESHOLDS.minEdgePx) {
    reasons.push("scale_too_small");
    return { qc_flag: "reject", qc_score: 0, reasons };
  }
  if (reasons.length > 0 || longEdge < QC_THRESHOLDS.warnEdgePx) {
    if (longEdge < QC_THRESHOLDS.warnEdgePx) reasons.push("scale_low_resolution");
    return { qc_flag: "warning", qc_score: 0.5, reasons };
  }
  return { qc_flag: "usable", qc_score: 1, reasons };
}

// ── g66-consent: L3(第三者提供・AI学習コーパス)許諾判定(RULING-2026-08-01-gen65-
//    ihl-backbone.md §11-2/§12 D-5) ──────────────────────────────────────
/**
 * 捕獲時点のL3許諾（consent_l3）が「第三者提供してよい」と機械判定できるか。
 * 未指定(undefined)・false はどちらも未許諾(=提供不可)。既定値を許諾ありにしない
 * (RULING D-5「初期設定は拒否です」)。true 以外は全て false を返す total function。
 */
export function isThirdPartyProvisionConsented(consentL3: boolean | undefined): boolean {
  return consentL3 === true;
}

/**
 * 既存captureのL3許諾内訳を数える(遡及書き換えの代わりに可視化する・T2禁止事項
 * 「既存データの遡及書き換え」に抵触しない読み取り専用の集計)。
 * missing = consent_l3 フィールド自体が無い(=本フィールド導入前のcapture、または
 * 導入後でも未指定のまま作られたcapture)。将来「売れない在庫」として扱われる件数。
 */
export function countConsentL3Inventory(
  captures: { consent_l3?: boolean }[],
): { total: number; granted: number; denied: number; missing: number } {
  let granted = 0;
  let denied = 0;
  let missing = 0;
  for (const cap of captures) {
    if (cap.consent_l3 === true) granted++;
    else if (cap.consent_l3 === false) denied++;
    else missing++;
  }
  return { total: captures.length, granted, denied, missing };
}

// ── V3-UIX-22/23/79 pairwise features(HQ裁定G79-1・uib02think §5-2②) ────────
/** feature_tags 固定語彙(one-hot)。末尾に「その他」バケツ(語彙外タグの受け皿)を
 *  1次元追加し、未知タグでも情報を捨てず決定論的に写像する(match-routes.ts の
 *  computeMatchFeatures が使う)。語彙を増やす時は MATCH_FEATURES_VERSION を切ること
 *  (uib02think §5-2②「静かに間違った内積を出す」の防止・G79-1裁定「規則変更を可逆に
 *  する」)。既存タグの実例(tests/individual.test.ts の bio-card TC)から採った暫定値
 *  — 実タグ運用の広がりに応じて見直す前提の第1版。 */
export const MATCH_FEATURE_TAG_VOCAB = ["体格重視", "色重視", "模様重視", "気性重視", "希少性重視"] as const;
/** サイズ正規化の除数(mm)。latest_size(mm) / この値を末尾次元に置く。現行データの
 *  実測レンジ分布は未計測のため暫定値(規則変更時は MATCH_FEATURES_VERSION を切る)。 */
export const MATCH_FEATURE_SIZE_NORM_MM = 100;
/** pairwise features 生成規則のバージョン(match-preference schema の
 *  features_version に保存・G79-1裁定「features_version を必ず付ける」)。 */
export const MATCH_FEATURES_VERSION = "tagvocab-v1";

// ── V3-OBS-71: 観測データ印刷 — 選べる項目の許可リスト ────────────────────
export const PRINT_ALLOWED_FIELDS = [
  "capture_id",
  "subject_ref",
  "domain",
  "species_candidate",
  "measurements",
  "note",
  "observed_at",
] as const;
