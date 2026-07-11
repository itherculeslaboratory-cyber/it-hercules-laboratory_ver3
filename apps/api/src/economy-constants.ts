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

// V3-SEC-06: 決済 8% 積立。accrued_total = round(confirmed_total * rate)。
// 純関数・都度再計算(常駐 DB 禁止)。較正は V3-GOV-17 管理 GUI(後波)。
export const SETTLEMENT_ACCRUAL_RATE = 0.08;

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
export const FEE_MAINTENANCE_TAX_RATE = 0.08; // V3-MKT-10/36 維持費税
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
