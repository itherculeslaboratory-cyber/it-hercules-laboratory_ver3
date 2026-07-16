// 論文/研究+wiki/知識クラスタ(K5)の確定数値を 1 ファイルに集約(design-k5 §2.5)。
// 較正は V3-GOV-17 管理 GUI(後波)— ハードコード散在を禁じ、ここだけを直す。
// value_origin/source enum は再定義せず frozen provenance.schema.json を単一正本とする。
// 出典: 01-requirements/registry.json V3-PPR-*・V3-WIK-*。

// WIK-16: 共通 CMS の content_type(単一イベント兼用)。
export const CONTENT_TYPES = ["article", "blog", "paper", "chat_log", "newspaper"] as const;

// PPR-03: PaperSectionsV1 6 節(目的/仮説/条件/検証/現在のフェーズ/ギャップ)。
export const PAPER_SECTIONS = ["purpose", "hypothesis", "conditions", "verification", "phase", "gap"] as const;

// WIK-14: AI 提案タグの上限(非永続・提案のみ)。
export const AI_TAGS_MAX = 10;

// WIK-13/14: 統合検索の RAG 優先度順。
export const RAG_PRIORITY = ["system", "ai", "user", "summary", "payload", "embedding"] as const;

// PPR-17: task_node の難易度。
export const DIFFICULTY = ["beginner", "intermediate", "researcher"] as const;

// PPR-18: 引用 1 件あたりの既定貢献ポイント(grantPlatinum の amount 既定)。
export const CONTRIBUTION_POINTS_PER_CITATION = 1;

// PPR-17: 新聞 cron(JST 06:00 = UTC 前日 21:00 — C4 で踏んだ UTC/JST ずれを明示回避)。
// 実 trigger 有効化は人間ゲート(常駐的トークン消費の開始・design-k5 §6)。
export const NEWSPAPER_CRON_UTC = "0 21 * * *";

// PPR-13: 分野別専門 API 対応表(確定値)。実ネット呼出は既定 OFF(不変条項①)。
export const DOMAIN_API_MAP: Record<string, readonly string[]> = {
  medicine: ["ICD-11", "ATC", "ClinicalTrials.gov"],
  ai: ["HuggingFace", "PapersWithCode"],
  materials: ["Materials Project", "PubChem"],
  weather: ["NOAA", "Copernicus"],
  game: ["Wikidata"],
  biology: ["Wikidata", "GBIF", "NCBI"],
  physics: ["Wikidata", "GBIF", "NCBI"],
  agriculture: ["Wikidata", "GBIF", "NCBI"],
  education: ["Wikidata", "GBIF", "NCBI"],
} as const;

// PPR-01/PPR-30: LLM 助言モードの既定(off=静的ヒントのみ・on は実鍵で人間ゲート・§6)。
export const RESEARCH_LLM_MODE_DEFAULT = "off";

// PPR-03: Phase1 LaTeX 禁止(JSON/YAML 節 + プレビューのみ)。\ と $ を混入させない。
export const LATEX_FORBIDDEN = /[\\$]/;

// WIK-13: embedding 類似検索(4本柱の1つ)の一致しきい値(cosine類似度・CL-08 384次元L2正規化)。
export const EMBEDDING_SIMILARITY_MIN = 0.7;
