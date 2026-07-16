// retired 2026-07-17 round-16(個人事業主に GMO あおぞらネット銀行の本番 API が提供されない
// ことが公式確認済み・docs/planning/b2-research/research-paypay-unification.md 付録A)。
// 決済は PAY.JP(payjp-connector.ts)へ移行。本ファイルは route 非マウント後も旧イベント
// (ihl.gmo.expected_payment.v1 / ihl.gmo.reconciliation.v1)の読み取り互換・単体 TC 維持の
// ため残置(丸ごと削除しない)。新規の決済導線からは呼ばない。
//
// GMO sunabar 照合コネクタ(design-c4 §2 / CL-11 / research-gmo-aozora-api §1 Phase 1).
// 接続層を差し替え可能に分離: GMO_CONNECTOR_MODE=sunabar(無料 sandbox・審査なし)
// / live(本番口座 API — 人間ゲート: GMO 本番契約・実鍵投入・live 昇格までは明示 throw)。
// 本コネクタは READ ONLY(入出金明細 poll のみ)。振込(更新系=金銭移動)は行わない
// — 入金は利用者が振込む側で、照合は名前照合ポーリング(Phase 1 最小構成)。
// トークン/口座IDは env 経由(D:\env\platform.env の GMO_SUNABAR_TOKEN1 等)。実値の
// 出力・コミット・ログ混入は禁止(AGENTS.md 禁止事項)。

/** 正規化済みの入金明細 1 件(sunabar の生レスポンスから投影)。 */
export interface DepositTransaction {
  itemKey: string; // 口座ID毎に一意の明細キー(冪等キー。二重 append 拒否に使う)
  applicantName: string; // 振込依頼人名(先頭に U-XXXX が載る想定・CL-11)
  amount: number; // 入金額(円)
  transactionDate: string; // 取引日
}

export interface GmoConnector {
  readonly mode: string;
  /** 入金明細を poll。live は人間ゲートまで throw。 */
  listDepositTransactions(): Promise<DepositTransaction[]>;
}

export interface GmoEnv {
  GMO_CONNECTOR_MODE?: string;
  GMO_SUNABAR_TOKEN1?: string;
  GMO_SUNABAR_API_BASE?: string;
  GMO_SUNABAR_ACCOUNT_ID?: string;
}

// sunabar 個人口座 API 実ホスト(研究レポート §8: portal モックとは別。実疎通で 200 確認)。
const DEFAULT_API_BASE = "https://api.sunabar.gmo-aozora.com/personal/v1";

// ── 依頼人名 → 振込コード(U-XXXX)抽出 ──────────────────────────────────
// 全角 ASCII(Ｕ－９４…)を半角へ畳んでから大文字化し、frozen transfer-code 形状
// U-[0-9A-Z]{4,6} を照合。半角カナ(ﾃｽﾄ 等)は対象外で残す。切り詰め・後方付随語は
// 先頭一致で吸収する(design-c4 §2 照合エッジ: 前方一致・全角混在・コード不在)。
function normalizeName(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0xff01 && c <= 0xff5e) out += String.fromCodePoint(c - 0xfee0); // 全角英数記号→半角
    else if (c === 0x3000) out += " "; // 全角空白→半角
    else out += ch;
  }
  return out.toUpperCase();
}

export function extractTransferCode(applicantName: string): string | null {
  const m = normalizeName(applicantName).match(/U-[0-9A-Z]{4,6}/);
  return m ? m[0] : null;
}

// ── sunabar 生レスポンス → DepositTransaction[] ───────────────────────
// 実測確定(2026-07-11・REAL 入金・docs/planning/c4/sunabar-e2e-evidence.md §7):
// sunabar personal は /accounts/deposit-transactions を提供せず(405)、入金は
// /accounts/transactions が返す。振込入金の依頼人名は remitterName/applicantName
// ではなく **remarks** に「振込 <全角依頼人名>」形で着地する(実データ例
// remarks="振込 スナバ　タロウ")。remitterName=U-HA6M 設定時に remarks="振込 U-HA6M"
// になるか(全角変換・切り詰め)は U-HA6M 入金の着地時に確定 — evidence §7 未確定1点。
// フィールド: transactionType 1=入金/2=出金・amount 金額・transactionDate 取引日・
// itemKey 明細キー(GMO 法人口座編 仕様 v1.20.1 と同中核項目)。remitterName/
// applicantName を先に見る防御的パースは本番(法人口座編)互換のため残す — personal
// では未存在で remarks に fall through する。extractTransferCode が「振込 」接頭辞を
// 前方一致で吸収し U-XXXX を抽出する。
export function parseTransactions(raw: unknown): DepositTransaction[] {
  const txs = (raw as { transactions?: unknown })?.transactions;
  if (!Array.isArray(txs)) return [];
  const out: DepositTransaction[] = [];
  for (const t of txs as Record<string, unknown>[]) {
    if (String(t.transactionType ?? "1") === "2") continue; // 出金は照合対象外
    const itemKey = String(t.itemKey ?? t.transactionId ?? "");
    if (!itemKey) continue;
    const applicantName = String(t.remitterName ?? t.applicantName ?? t.remarks ?? "");
    out.push({
      itemKey,
      applicantName,
      amount: Number(t.amount ?? t.transactionAmount ?? 0),
      transactionDate: String(t.transactionDate ?? t.valueDate ?? ""),
    });
  }
  return out;
}

export function makeGmoConnector(env: GmoEnv): GmoConnector {
  const mode = env.GMO_CONNECTOR_MODE ?? "sunabar";

  if (mode === "live") {
    // 本番口座 API は人間ゲート(GMO 本番契約・実鍵投入・live 昇格)。接続層は分離
    // 済み — ゲート通過後に本番 OAuth/OIDC + api.gmo-aozora.com 実装を差し込む。
    const throwLive = async (): Promise<never> => {
      throw new Error(
        "GMO live connector not implemented — 本番接続は人間ゲート(GMO 本番契約/実鍵/live 昇格)",
      );
    };
    return { mode, listDepositTransactions: throwLive };
  }
  if (mode !== "sunabar") throw new Error(`unknown GMO_CONNECTOR_MODE: ${mode}`);

  const base = env.GMO_SUNABAR_API_BASE ?? DEFAULT_API_BASE;
  const token = env.GMO_SUNABAR_TOKEN1;
  const accountId = env.GMO_SUNABAR_ACCOUNT_ID;
  return {
    mode,
    async listDepositTransactions(): Promise<DepositTransaction[]> {
      if (!token || !accountId) {
        throw new Error(
          "sunabar connector missing GMO_SUNABAR_TOKEN1 / GMO_SUNABAR_ACCOUNT_ID",
        );
      }
      // 実測(2026-07-11): sunabar の取引日付は JST。UTC 日で dateTo を作ると
      // JST 0:00〜9:00 の間は当日明細が範囲外になり deposits=[] になる(実バグ)。
      // transfer API も UTC 日を「過去日付」で 400 にする(evidence §7.3)。JST 固定。
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const url =
        `${base}/accounts/transactions?accountId=${encodeURIComponent(accountId)}` +
        `&dateFrom=2020-01-01&dateTo=${today}`;
      const res = await fetch(url, { headers: { "x-access-token": token } });
      if (!res.ok) throw new Error(`sunabar transactions HTTP ${res.status}`);
      return parseTransactions(await res.json());
    },
  };
}
