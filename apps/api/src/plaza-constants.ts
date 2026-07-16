// 知の広場+ガバナンス(K6)の凍結定数を 1 ファイルに集約(design-c5.md §K6 §2.5)。
// ハードコード散在を禁じ、ここだけを直す。較正は V3-GOV-17 管理 GUI(後波)。
// 出典: docs/planning/c5/design-c5.md §K6 §2.5 / 01-requirements/registry.json
// V3-BBS-03/10/29/36・V3-GOV-01/09/19/23。

// BBS-03: 3板の別(説明/愚痴/改善)。plaza-post.board_kind enum の正本。
export const BOARD_KINDS = ["guide", "complaint", "improvement"] as const;

// BBS-29: fork の表示ランク(左=最上位)。projectForkRanks の整列順。
export const FORK_RANKS = ["official", "recommended", "popular", "beginner", "minor"] as const;

// BBS-36: Polis 型の賛否値。plaza-stance.value enum の正本。
export const STANCE_VALUES = ["agree", "disagree", "pass"] as const;

// BBS-36: 合意/対立を判定する最小票数(agree+disagree)。
export const CONSENSUS_MIN_VOTES = 5;
// BBS-36: consensus 閾値 = agree/(agree+disagree) 下限。
// ponytail: 較正 knob。Polis 相当の運用実測で調整(GUI 後波)。
export const CONSENSUS_AGREE_RATIO = 0.6;
// BBS-36: divisive 閾値 = min(agree,disagree)/(agree+disagree) 下限。
// ponytail: 較正 knob。二分度の感度を運用実測で調整(GUI 後波)。
export const DIVISIVE_MIN_SIDE_RATIO = 0.3;

// BBS-10: 要約ブロックの投稿数。block_index=floor(post 通番/この値)。
export const SUMMARY_BLOCK_SIZE = 100;

// GOV-01: 二人部屋の期限切れ強制 close までの日数。
// ponytail: 較正 knob。紛争滞留の実測で調整(GUI 後波)。
export const DISPUTE_TTL_DAYS = 14;

// GOV-09: 不使用フラグ付与時の grantKarmaCountIncrease steps(Δcount+10)。
export const GOV_FLAG_COUNT_STEPS = 10;

// GOV-23: 自然淘汰ランキングの加重(signal 種別 + vote/fork)。
// ponytail: 較正 knob。淘汰の効き方を運用実測で調整(GUI 後波)。
export const RANKING_WEIGHTS = { like: 1, use: 2, retain: 3, vote: 5, fork: 1 } as const;

// GOV-23: /os/main 昇格に要する projectRanking 最小スコア。
// ponytail: 較正 knob。昇格ラインを運用実測で調整(GUI 後波)。
export const OS_PROMOTION_MIN_SCORE = 100;

// GOV-35(round-15拡張・違法出品ユーザー自治): 同国指摘の二段閾値モデレーション+
// 誤BAN復帰の投票ゲート。出典: user-ruling-2026-07-15-round-15.md #6-9。
// ponytail: 較正 knob 群。実測で調整(GUI 後波・V3-GOV-17)。
export const MKT_LISTING_FLAG_HIDE_THRESHOLD = 5; // 同一商品への active 指摘5件で非表示
export const MKT_SELLER_SUSPEND_THRESHOLD = 5; // 非表示5件蓄積した出品者は出品停止
export const MKT_LISTING_FLAG_KARMA_STEPS = 1; // 既存の指摘Δcountルール(grantKarmaCountIncrease)を1段目相当で適用
export const MISBAN_REVERSAL_VOTER_KARMA_MIN = 80; // 誤BAN判定に参加できるカルマ下限
export const MISBAN_REVERSAL_VOTER_COUNT = 5; // 誤BAN判定に要する適格ユーザー数
export const MISBAN_REVERSAL_OWNER_KARMA_BONUS = 5; // 誤って停止された出品者へのカルマ+5
export const MISBAN_REVERSAL_JUROR_CONTRIBUTION = 5; // 判定に貢献したユーザーへの貢献度付与(axis=development・source=vote)
