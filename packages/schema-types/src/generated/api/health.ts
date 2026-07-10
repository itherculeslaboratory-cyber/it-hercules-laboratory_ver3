// GENERATED FILE — do not edit by hand.
// source: schemas/api/health.schema.json
// title: GET /health Response
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * ヘルスチェック応答契約。apps/api の初期 Hono route（フォルダ設計 §8 手順 6 の最小 1 route = health）が返す。最小形は {"status":"ok"}。service/version は ver2 FastAPI 実装（apps/api/main.py health()）が返す上位互換フィールドで、ver3 Hono 初期 route が付けるかは C1 実機照合で確定。
 */
export interface Health {
  status: "ok";
  /**
   * サービス名（ver2: 'ihl-api'）。任意。
   */
  service?: string;
  /**
   * API バージョン（ver2: '0.3.0'）。任意。
   */
  version?: string;
}
