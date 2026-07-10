// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/transfer-code.schema.json
// title: GMO Transfer Code (CL-11)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 既存ユーザーに導出済みの振込コード。導出関数を変えると入金照合が破綻（要件定義書 CL-11 / V3-MKT-12 / FR-GMO-01）。導出: SHA-256(userId) の先頭 3 バイトを big-endian uint24 とし、Base36 大文字化して 'U-' を前置、4 桁未満は zfill(4)、6 桁超は末尾 6 桁（ver2 libs/ihl/payments/gmo_transfer_code.py derive_transfer_code）。uint24 の Base36 は最大 5 文字のため実運用は U-XXXX〜U-XXXXX。既存ユーザー全員分のテストベクタ回帰は C1（1 件でも不一致なら fail）。
 */
export interface TransferCode {
  /**
   * deriveTransferCode(userId) の出力。'U-' + Base36 大文字 4〜6 桁。注意: fixtures/oracle/gmo-transfer-code.json の 'IHL-EXAMPLE-8PCT' は GMO stub レスポンスのデモ値であり、この導出関数の出力形式ではない。
   */
  transfer_code: string;
}
