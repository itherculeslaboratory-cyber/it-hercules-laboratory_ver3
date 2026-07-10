// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/consent-record.schema.json
// title: Legal Consent Record (CL-05)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 利用規約への技術的同意イベント。INSERT ONLY・複数同意=別ファイル（法的証跡なので形式変更不可 — 要件定義書 CL-05 / V3-SEC-20 / NFR-05）。ver2 apps/api/main.py の legal_agree が書き出す legal_agree_v1 レコードそのもの。最終法務文言は人間ゲート HUMAN-02-LEGAL 待ちのため is_draft_terms=true。
 */
export interface ConsentRecord {
  schema: "legal_agree_v1";
  /**
   * os.urandom(6).hex() 由来。ファイル名 = <agree_id>.json（別ファイル方式）。
   */
  agree_id: string;
  actor_id: string;
  /**
   * 同意した規約バージョン（ver2 現行 = 'draft-2026-06'）。
   */
  terms_version: string;
  /**
   * 草案版への同意か。最終法務確定（HUMAN-02-LEGAL）前は true。
   */
  is_draft_terms: boolean;
  /**
   * この同意をブロックしている人間ゲート識別子（ver2 現行 = 'HUMAN-02-LEGAL'）。
   */
  legal_gate: string;
  /**
   * ver2 の永続レコードには created_at が書かれていない（apps/api/main.py の record dict に含まれない）。ver3 で付与するかは C1 実機照合で確定。
   */
  created_at?: string;
}
