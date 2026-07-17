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

// BBS-14: 改善要求(board_kind=improvement)投稿の AI 安全チェック。LLM は既定 OFF
// (不変条項①・ai-kernel.ts)のため、決定論キーワードブロックリストで攻撃的内容を拒否する
// フォールバック実装(投稿 400・plaza-routes.ts isOffensiveContent)。
// ponytail: 固定キーワード列の較正 knob。IHL_AI_PROVIDER に実鍵が入り classify task が
// 有効化された後(§6 人間ゲート)、makeLLMClient(task:"classify") 判定へ差し替えるのが
// 上げ道(ai-kernel.ts の DI seam を再利用・新規 kernel は作らない)。
export const BBS14_BLOCKED_TERMS = ["死ね", "殺す", "kill you", "die you"] as const;

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

// 知の広場スレ昇格・投票・解決・カード発行(round-16 裁定 OQ-PLZ-01〜05)。
// 出典: docs/planning/rulings/user-ruling-2026-07-17-round-16.md §3-F ・
// docs/planning/c7/wireframes-core5.md §F1-F3。V3-BBS-03/05 の promotion/resolution
// 投影(plaza-routes.ts)が参照する単一正本。
// ponytail: 較正 knob 群(仮値・運用データで調整・裁定注記どおり)。

// OQ-PLZ-01: 昇格閾値一式(仮値4/2/5/12を承認)。
export const PLZ_VERIFIED_CITE_MIN = 4; // 「✔裏取り済み」= 実観測cite件数の下限
export const PLZ_VERIFIED_RETRY_MIN = 2; // 「✔裏取り済み」= 追試(再現)件数の下限
export const PLZ_REFUTED_RETRY_MIN = 5; // 「⚠反証あり」= 追試(再現せず)件数の下限
export const PLZ_UNRESOLVED_STANCE_MIN = 12; // 「未収束の論点」= stance母数の下限

// OQ-PLZ-02: 票の重み係数の初期値(認定飼育者2.0倍・一次観測者1.5倍で開始し試行運用で調整)。
// 認定飼育者/一次観測者の判定元(identity/certification の正本)は本裁定でも未確定のため、
// 重みの適用先(plaza-routes.ts projectConsensus の actorWeights 引数)は呼び手が
// actor_id→weight の対応表を注入する設計に留める(役割データ源が無い状態での実装は
// 本ラウンドの対象外・別途裁定/設計待ち)。
export const PLZ_VOTE_WEIGHT_CERTIFIED_BREEDER = 2.0;
export const PLZ_VOTE_WEIGHT_PRIMARY_OBSERVER = 1.5;

// OQ-PLZ-03: 解決マーク([✔解決した]/[取り消す])の権限はスレ主のみ(荒れ防止・後開放は可逆)。
export const PLZ_RESOLVE_PERMISSION = "thread_owner_only" as const;

// OQ-PLZ-05: カード発行導線の委譲。スレ主無応答 N=14 日で認定飼育者/最多cite観測者の
// 両方へ通知委譲(自動発行はしない・opt-in規律維持)。委譲実装自体は識別/認定の正本が
// 別途必要なため本ラウンドでは定数のみ確定する。
export const PLZ_CARD_DELEGATION_DAYS = 14;
