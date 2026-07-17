// 経済系(カルマ/プラチナ)の確定数値を 1 ファイルに集約(design-c4 §1)。
// 較正は V3-GOV-17 管理 GUI(後波)— ハードコード散在を禁じ、ここだけを直す。
// 出典: 01-requirements/registry.json V3-KRM-01/02/03。

// V3-KRM-01: カルマ値は [-100,+100]、登録直後 0。
export const KARMA_VALUE_MIN = -100;
export const KARMA_VALUE_MAX = 100;
export const KARMA_VALUE_INITIAL = 0;

// V3-KRM-03: 月次カルマ救済(count=0 完遂月に +10・上限 100・毎月 25 日基準)。
// バッチ実行は C5(今回は数値のみ集約)。
export const MONTHLY_RECOVERY = 10;
export const RECOVERY_BASE_DAY = 25;

// V3-SEC-06: 決済 5%(round-15で8%から引き下げ) 積立。accrued_total = round(confirmed_total * rate)。
// 純関数・都度再計算(常駐 DB 禁止)。較正は V3-GOV-17 管理 GUI(後波)。
export const SETTLEMENT_ACCRUAL_RATE = 0.05;

// V3-KRM-02 検算アンカー(確定): カルマカウント 0→5 で -12、5→10 で -131。
// = Σ Fib(n)(n=1..5)=1+1+2+3+5=12 / Σ Fib(n)(n=6..10)=8+13+21+34+55=131。
// Fib(1)=Fib(2)=1 の標準フィボナッチ。この 2 値がテストベクタの正本。
export const FIB_PENALTY_ANCHOR_0_5 = 12;
export const FIB_PENALTY_ANCHOR_5_10 = 131;

// ─── C5 K3 経済/マーケット凍結定数(design-k3 §2.7)──────────────────────
// ハードコード散在禁止＝ここだけを直す。GUI 可変な閾値(称号 10000・公式化ライン
// 100・免罪符初期価格)は config/economy-policy.csv の既定行にも複製し
// resolvePolicyInt 経由で参照(V3-KRM-16)。定数はスナップショットで凍結。

export const INDULGENCE_INITIAL_PRICE_PT = 1; // V3-KRM-05 初回1PT (=fib(1))
export const FEE_MAINTENANCE_TAX_RATE = 0.05; // V3-MKT-10/36 維持費税(round-15で8%から引き下げ)
export const FEE_COMMERCIAL_RATE = 0.03; // V3-MKT-36 文明拠出
export const FEE_FORK_REVENUE_RATE = 0.1; // V3-MKT-36 原作者還元
export const UPSTREAM_PERCENT = 0.1; // V3-KRM-11 祖先重み配分
export const TAX_GRACE_DAYS = 30; // V3-MKT-10 猶予
export const AUTO_GOOD_RATING_DAYS = 30; // V3-MKT-04 自動良い
export const CONTRIBUTION_PER_PLATINUM = 100; // V3-KRM-11/12 1PT鋳造基礎
export const CONTRIBUTION_TITLE_THRESHOLD = 10000; // V3-KRM-11 称号(GUI可変)
export const KARMA_BAN_THRESHOLD = -100; // V3-KRM-04 永久BAN
export const SOCIAL_EVAL_LAYER_MAX = 3; // V3-KRM-20 layer0-3のみ
export const LOW_RATING_BAD_THRESHOLD = 5; // V3-MKT-27
export const LOW_RATING_KARMA_MAX = 0; // V3-MKT-27
export const LOW_RATING_STAR_MAX = 2; // V3-MKT-27
export const RANKING_WEIGHTS = {
  usage: 40,
  retention: 20,
  rating: 20,
  forks: 10,
  improvements: 10,
} as const; // V3-MKT-22
export const INTL_TRUST_MIN = 0; // V3-KRM-21
export const INTL_TRUST_MAX = 100; // V3-KRM-21

// V3-KRM-28 観測commit成功時の研究貢献度フック(axis=research・source=observation)。
// 数値は要件文の固定アンカー(observation_saved +5 / observation_with_photo +3 /
// individual_created +10)。with_photo は saved に対する追加加点(排他ではない)。
export const CONTRIB_OBSERVATION_SAVED = 5;
export const CONTRIB_OBSERVATION_WITH_PHOTO = 3;
export const CONTRIB_INDIVIDUAL_CREATED = 10;

// ─── round-16 裁定(D節 OQ-MKT-01〜04・決済裁定受領7)市場状態機械パラメータ ─────
// V3-MKT-01/02 成立2方式+状態機械5脚+P2P決済(銀行振込既定・IHL非関与)。数値は全て
// ここだけを直す(V3-GOV-17 将来調整 GUI 化を見越し集約・ハードコード散在禁止)。

// [批評R4 major2脚②] 承諾制の要承諾オファーへの応答期限(無応答=全件自動辞退・
// 出品は継続)。read-time 判定(cron 不要): now - offer.created_at >= この時間で期限切れ。
export const OFFER_RESPONSE_HOURS = 24;

// [OQ-MKT-03 ★推奨承認] 48h 未入金→自動キャンセル+再出品+no-pay マーク。
export const NO_PAY_CANCEL_HOURS = 48;
// [OQ-MKT-03 ★推奨承認] no-pay マーク: 30 日内 2 回で 7 日間、即決/承諾制の新規申込を制限。
export const NO_PAY_LIMIT_COUNT = 2;
export const NO_PAY_LIMIT_WINDOW_DAYS = 30;
export const NO_PAY_RESTRICT_DAYS = 7;

// [批評R4 猶予キャンセル] 成立後 60 分は買い手が無料でキャンセル可能。
export const GRACE_CANCEL_MINUTES = 60;
// [OQ-MKT-04 ★推奨承認] 猶予キャンセル 30 日内 3 回で警告/制限。
// ponytail: 制限日数の具体値はワイヤー未確定(open_questions 4「制限内容」は人間裁定
// 対象のまま)。no-pay と同じ制限形状(7 日間の新規申込停止)を暫定既定として適用 —
// 差し替えが要るなら NO_PAY_RESTRICT_DAYS と分離してこの定数だけを直せばよい。
export const GRACE_CANCEL_LIMIT_COUNT = 3;
export const GRACE_CANCEL_LIMIT_WINDOW_DAYS = 30;
export const GRACE_CANCEL_RESTRICT_DAYS = 7;

// V3-IND-35 割り出し予約: 単価高い順の確認画面のタイムアウト。registry.json
// V3-IND-35.ambiguity「確認画面のタイムアウト仕様は詳細設計で確定要」への暫定既定
// (ponytail: OFFER_RESPONSE_HOURS と同じ 24h を流用・人間裁定で差し替え可)。
export const RESERVATION_CONFIRM_WINDOW_HOURS = 24;
