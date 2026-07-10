// GENERATED FILE — do not edit by hand.
// source: schemas/frozen/embedding-manifest.schema.json
// title: Embedding Manifest (CL-08)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * 既存の埋め込みベクトルの契約。次元/正規化が非互換だと類似検索が全断（要件定義書 CL-08 / V3-OBS-09 / FR-18-07）。ADR-V3-EMB-01 で 384 一本化が確定したため embedding_dim=384・normalized_flag=true を凍結値とする（ver2 実装 embedding.py の DINOV2_DIM=384 / DUMMY_DIM=384・L2 正規化と一致）。raw float32 バイナリ（base64 不使用・V3-WIK-19）で 1 ベクトル = 384*4 = 1536 バイト。
 */
export interface EmbeddingManifest {
  embedding_id: string;
  capture_id: string;
  individual_id: string;
  image_id: string;
  /**
   * ADR-V3-EMB-01 で 384 一本化（DINOv2 ViT-S/14 系・ruri-v3-70m）。768 はエスケープハッチで実装しない。
   */
  embedding_dim: 384;
  /**
   * raw float32 バイナリファイル（Universe 単位 embeddings.bin・V3-WIK-19）へのパス。
   */
  embedding_file: string;
  /**
   * embeddings.bin 内のバイトオフセット。
   */
  vector_offset: number;
  /**
   * ベクトルのバイト長。384 次元 float32 = 1536。C1 で dim との整合を検証。
   */
  vector_length?: number;
  /**
   * L2 正規化済み（embedding.py は常に norm 除算）。cosine 検索の前提。
   */
  normalized_flag: true;
  part_type?: string;
  embedding_model?: string;
  embedding_version?: string;
  input_image_path?: string;
  input_hash?: string;
  preprocessing_name?: string;
  preprocessing_version?: string;
  /**
   * ver2: 'dinov2_vits14'（本番）/ 'dummy'（CI）。const は付けない（CI dummy を許容）。
   */
  model_name: string;
  model_version: string;
  pipeline_name?: string;
  pipeline_version?: string;
  snapshot_id?: string;
  value_origin?: string;
  schema_version: number;
  run_id: string;
  created_at: string;
}
