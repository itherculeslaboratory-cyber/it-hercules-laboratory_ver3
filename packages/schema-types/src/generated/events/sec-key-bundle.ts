// GENERATED FILE — do not edit by hand.
// source: schemas/events/sec-key-bundle.schema.json
// title: Zero-knowledge key bundle (ihl.sec.key_bundle.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * V3-SEC-57: BYOK鍵5本+振込口座パスフレーズの暗号バンドルを、IHLが復号不能なzero-knowledge blob(ciphertext)としてサーバ保管する。サーバ側コードは ciphertext の中身を一切解釈・復号しない(平文鍵・パスフレーズはサーバに到達しない=クライアント側で暗号化済みのopaque文字列を保管するのみ)。append-only(新バンドルは新レコード・最新が投影上の現行バンドル)。Truth キー truth/ihl.sec.key_bundle.v1/<actor_id>/<bundle_id>.json。
 */
export interface SecKeyBundle {
  /**
   * バンドルの一意キー(ULID推奨)。
   */
  bundle_id: string;
  /**
   * 本人 actor_id(セッション principal 強制・V3-AUT-17)。
   */
  actor_id: string;
  /**
   * クライアント側で暗号化済みのopaque文字列(base64等)。サーバは中身を解釈・復号しない。
   */
  ciphertext: string;
  /**
   * クライアントの鍵導出関数パラメータ(salt/iterations等・任意・サーバは中身を解釈しない不透明値)。
   */
  kdf_params?: {
    [k: string]: unknown;
  };
  /**
   * 保管時刻(RFC3339)。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
