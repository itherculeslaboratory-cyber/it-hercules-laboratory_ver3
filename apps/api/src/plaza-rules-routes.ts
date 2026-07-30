// V3-WIK-30 — 仕様書のルール(例: 掲示板作成+5Pt)をJSONで全公開し、誰でも文明の
// 「法律」を読め・検証できる透明性を保つ(OSS前提)。plaza-constants.ts(単一正本)の値を
// そのままJSON化するだけの薄いroute(値の二重定義をしない)。
// 公開範囲: このroute自体はPROTECTED既定(index.ts不可侵のためPUBLIC_ROUTES追加はHQ検収時
// 適用・mount手順は報告書参照)。「全公開」の実体は V3-SEC-30(全公開OSS確定)によりリポジトリ
// 自体が公開されること・および本route が index.ts の PUBLIC_ROUTES に載ることの両方で満たす。
import { Hono } from "hono";
import type { Bindings, Variables } from "./env";
import {
  BOARD_KINDS,
  ENGAGEMENT_KINDS,
  FORK_RANKS,
  STANCE_VALUES,
  CONSENSUS_MIN_VOTES,
  CONSENSUS_AGREE_RATIO,
  DIVISIVE_MIN_SIDE_RATIO,
  SUMMARY_BLOCK_SIZE,
  RANKING_WEIGHTS,
  OS_PROMOTION_MIN_SCORE,
  PLZ_VERIFIED_CITE_MIN,
  PLZ_VERIFIED_RETRY_MIN,
  PLZ_REFUTED_RETRY_MIN,
  PLZ_UNRESOLVED_STANCE_MIN,
  PLZ_RESOLVE_PERMISSION,
  PLZ_CARD_DELEGATION_DAYS,
} from "./plaza-constants";

export const plazaRulesRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export interface PlazaRules {
  board_kinds: readonly string[];
  engagement_kinds: readonly string[];
  fork_ranks: readonly string[];
  stance_values: readonly string[];
  consensus: { min_votes: number; agree_ratio: number; divisive_side_ratio: number };
  summary_block_size: number;
  ranking_weights: Record<string, number>;
  os_promotion_min_score: number;
  promotion: {
    verified_cite_min: number;
    verified_retry_min: number;
    refuted_retry_min: number;
    unresolved_stance_min: number;
  };
  resolve_permission: string;
  card_delegation_days: number;
}

// buildPlazaRules — 純関数(route非依存・テスト容易)。plaza-constants.ts の値をそのまま
// 転記するだけで新規の値は持たない(単一正本参照)。
export function buildPlazaRules(): PlazaRules {
  return {
    board_kinds: BOARD_KINDS,
    engagement_kinds: ENGAGEMENT_KINDS,
    fork_ranks: FORK_RANKS,
    stance_values: STANCE_VALUES,
    consensus: {
      min_votes: CONSENSUS_MIN_VOTES,
      agree_ratio: CONSENSUS_AGREE_RATIO,
      divisive_side_ratio: DIVISIVE_MIN_SIDE_RATIO,
    },
    summary_block_size: SUMMARY_BLOCK_SIZE,
    ranking_weights: RANKING_WEIGHTS,
    os_promotion_min_score: OS_PROMOTION_MIN_SCORE,
    promotion: {
      verified_cite_min: PLZ_VERIFIED_CITE_MIN,
      verified_retry_min: PLZ_VERIFIED_RETRY_MIN,
      refuted_retry_min: PLZ_REFUTED_RETRY_MIN,
      unresolved_stance_min: PLZ_UNRESOLVED_STANCE_MIN,
    },
    resolve_permission: PLZ_RESOLVE_PERMISSION,
    card_delegation_days: PLZ_CARD_DELEGATION_DAYS,
  };
}

// GET /plaza/rules — 知の広場のルールJSON全公開(WIK-30)。
plazaRulesRoutes.get("/plaza/rules", (c) => c.json(buildPlazaRules()));
