// F2(design §4-3「検索条件JSONの保存・共有」+「再現性100%」)。
//
// ★設計からの逸脱と、その理由(報告書「判断が要った箇所」参照): design §4-3 は
// 「既存 POST /events 経路でTruthに1イベントappend(新機構0)」を想定していた。しかし
// 実装時点で本流ツリーには並走艦(g80-e2color)が packages/truth/src/envelope.ts・
// packages/schema-types/generated・codegen-validators.mjs を同時に編集中で(git status
// 実測)、新イベント型登録には同じファイル群への追記(EVENT_NAMES/VALIDATOR_NAME)+
// codegen再実行が要る。並走中の未コミット編集を巻き込むリスクが高いと判断し、
// 「Truthに永続化された共有イベント」ではなく「クライアント側のダウンロード/URLパラメータ
// 共有」に倒した。再現性の実体(= 同じ manifest generation + 同じ条件JSON = 同じ結果)は
// どちらの方式でも変わらず満たされる — 変わるのは保存先が「サーバ(Truth)」か
// 「利用者のファイル/URL」かだけ。Truth連携は次波の課題として申し送る(報告書参照)。
import type { ResearchQueryJson } from "./query-generator";

export interface SavedResearchCondition {
  manifest_generation: number;
  saved_at: string;
  query: ResearchQueryJson;
}

/** 条件JSONに manifest generation番号を必ず含める(design §4-3「再現性100%」の実体)。 */
export function buildSavedCondition(
  query: ResearchQueryJson,
  manifestGeneration: number,
  savedAt: string,
): SavedResearchCondition {
  return { manifest_generation: manifestGeneration, saved_at: savedAt, query };
}

export function conditionToJson(condition: SavedResearchCondition): string {
  return JSON.stringify(condition, null, 2);
}

/** URL共有用: 条件JSONをURL安全なbase64にエンコードする(?condition=<encoded>)。 */
export function encodeConditionForUrl(condition: SavedResearchCondition): string {
  const json = JSON.stringify(condition);
  return btoa(unescape(encodeURIComponent(json)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeConditionFromUrl(encoded: string): SavedResearchCondition {
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const json = decodeURIComponent(escape(atob(padded + "=".repeat(padLen))));
  return JSON.parse(json) as SavedResearchCondition;
}
