// GENERATED FILE — do not edit by hand.
// source: schemas/events/social-platinum-vote.schema.json
// title: Platinum coin vote event (ihl.social.platinum_vote.v1)
// direction: schemas/ -> generated (one-way; edit the schema, then re-run)
// regenerate: node scripts/codegen-schemas.mjs

/**
 * プラチナコイン投票の append-only イベント（1票=1coin・任意枚数）。Truth キー truth/ihl.social.platinum_vote.v1/<vote_id>.json。projectPlatinumVoteTally が対象別に合計＋投票者内訳を全公開で投影、閾値到達で公式昇格候補化（実昇格=人間ゲート・V3-KRM-25）。
 */
export interface SocialPlatinumVote {
  /**
   * 投票イベントの一意キー。
   */
  vote_id: string;
  /**
   * 投票対象（論文/UI/イベント/プロンプト等）の ID。
   */
  target_id: string;
  /**
   * 投票者の actor_id（V3-AUT-17・内訳全公開）。
   */
  voter_id: string;
  /**
   * 投じたコイン枚数（1票=1coin・任意枚数）。
   */
  coins: number;
  /**
   * 投票対象のレイヤー（0=コード〜3=機能/OS構成が投票可能域。4=固定資産/ブランド/世界観は投票・フォーク・お気に入り不可＝V3-MKT-35。/economy/vote 経由の投票のみ必須供給、/social/platinum-votes 経由は任意=既存互換）。
   */
  target_layer?: number;
  /**
   * 投票理由（V3-MKT-35 /economy/vote が枚数と併せて要求する自由記述）。
   */
  reason?: string;
  /**
   * 発生時刻（RFC3339）。
   */
  created_at: string;
  /**
   * data スキーマ版。
   */
  schema_version: string;
}
