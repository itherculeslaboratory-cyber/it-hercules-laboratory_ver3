// V3-WIK-18: 会話ログ・掲示板・R2ログ・観測データを、mini_chunk(1〜2往復・思考粒度・分析用)と
// theme_chunk(4〜6往復or1000トークン・意味のまとまり・RAG用)の2階層チャンクへ1回の処理で
// 両方分割する。summary/design_conclusion/embedding は空スロット(plaza-routes.ts の
// EMBEDDING_REF/4層要約と同じ「後日バッチ/手動が埋める」規約・LLM 直呼びはしない・
// 不変条項①)。スレッド/会話の変化は diff(summary_before/after/diff_text/embedding)として
// 記録するための型のみ用意する(実際の diff 生成は summary が埋まった後の別バッチの仕事)。
import { WIK_MINI_CHUNK_MAX_TURNS, WIK_THEME_CHUNK_MAX_TURNS, WIK_THEME_CHUNK_MAX_TOKENS } from "./plaza-constants";

export interface ConversationTurn {
  turn_id: string;
  raw_text: string;
}

export interface Chunk {
  chunk_id: string; // 決定論(先頭turn_idベース)。ULID 生成は呼び出し側の責務(このファイルは純関数)。
  kind: "mini" | "theme";
  turn_ids: string[];
  raw_text: string; // turn を結合した原文(改変なし)。
  summary: string | null; // 空スロット(後日バッチ/人手が埋める)。
  design_conclusion: string | null; // 空スロット。
  embedding: null; // 空スロット(plaza-routes.ts EMBEDDING_REF と同型の後日バッチ規約)。
}

// 決定論トークン推定(不変条項①: LLM/外部トークナイザ不使用)。おおまかな目安として
// 文字数/2 を採用する(日本語1文字≒0.5〜1トークン相当の粗い近似・厳密なトークナイザは
// 過剰実装のため導入しない=YAGNI・閾値超過の検知が目的でカウントの厳密一致は不要)。
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function makeChunk(kind: "mini" | "theme", turns: ConversationTurn[]): Chunk {
  return {
    chunk_id: `${kind}:${turns[0].turn_id}`,
    kind,
    turn_ids: turns.map((t) => t.turn_id),
    raw_text: turns.map((t) => t.raw_text).join("\n"),
    summary: null,
    design_conclusion: null,
    embedding: null,
  };
}

// chunkMiniAndTheme — 1回の処理で mini_chunk(WIK_MINI_CHUNK_MAX_TURNS往復ごと)と
// theme_chunk(WIK_THEME_CHUNK_MAX_TURNS往復 or WIK_THEME_CHUNK_MAX_TOKENS トークンで区切り、
// どちらか先に達した方で切る)の両方を生成する。
export function chunkMiniAndTheme(turns: ConversationTurn[]): { mini: Chunk[]; theme: Chunk[] } {
  const mini: Chunk[] = [];
  for (let i = 0; i < turns.length; i += WIK_MINI_CHUNK_MAX_TURNS) {
    mini.push(makeChunk("mini", turns.slice(i, i + WIK_MINI_CHUNK_MAX_TURNS)));
  }

  const theme: Chunk[] = [];
  let bucket: ConversationTurn[] = [];
  let bucketTokens = 0;
  for (const turn of turns) {
    const turnTokens = estimateTokens(turn.raw_text);
    if (bucket.length && (bucket.length + 1 > WIK_THEME_CHUNK_MAX_TURNS || bucketTokens + turnTokens > WIK_THEME_CHUNK_MAX_TOKENS)) {
      theme.push(makeChunk("theme", bucket));
      bucket = [];
      bucketTokens = 0;
    }
    bucket.push(turn);
    bucketTokens += turnTokens;
  }
  if (bucket.length) theme.push(makeChunk("theme", bucket));

  return { mini, theme };
}

export interface SummaryDiff {
  summary_before: string | null;
  summary_after: string;
  diff_text: string;
  embedding: null; // 空スロット。
}

// buildSummaryDiff — スレッド/会話の変化を diff として記録する(WIK-18 後段)。diff_text は
// 決定論の行単位差分ラベルのみ(意味的差分の生成はLLM要約バッチの仕事・ここでは変化の
// 「記録の型」だけを提供する)。
export function buildSummaryDiff(before: string | null, after: string): SummaryDiff {
  const diffText = before === null ? "[initial]" : before === after ? "[unchanged]" : `[changed] -"${before}" +"${after}"`;
  return { summary_before: before, summary_after: after, diff_text: diffText, embedding: null };
}
