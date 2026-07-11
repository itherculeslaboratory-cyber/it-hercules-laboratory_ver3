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
