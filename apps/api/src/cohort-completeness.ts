// C7 背骨S7 コホート完結性の導出(V3-KRM-35・design
// proposals\R0801-f383db-DESIGN-2026-08-01-g72-backbonedesign.md §4.4)。
// 保存しない — 読み出し時に count層(clutch_event)と individual層(life_event)
// を都度突合して導出する(不変条項①・projectClutchCurrentCount/
// projectClutchReconciliation と同じ縮退)。新しい器・新しい検出器は作らない:
// コホートの器=ihl.ind.clutch.v1(既存)、未説明検出=discrepancy(既存・
// projectClutchReconciliation が既に集約している値をそのまま使う設計だが、
// この関数自身は分母/説明済み/生存中/未説明を独立に再導出する — discrepancy
// はrecount単位の差分でありコホート全体の完結性とは分母が異なるため合成しない)。
//
// envelope()/store()/dataOf() は observation-routes.ts / individual-routes.ts /
// clutch-routes.ts と同じくモジュール内非公開ヘルパーとして再宣言する(既存の
// 前例=individual-routes.ts冒頭コメント「envelope()/store()/dataOf() are
// re-declared inline here」と同じ理由でimportできない)。
import { TruthStore } from "@ihl/truth";

const CLUTCH_TYPE = "ihl.ind.clutch.v1";
const CLUTCH_EVENT_TYPE = "ihl.ind.clutch_event.v1";
const LIFE_TYPE = "ihl.ind.life_event.v1";

function dataOf(e: Record<string, unknown>): Record<string, unknown> {
  return (e.data ?? {}) as Record<string, unknown>;
}

/**
 * 個体1体が「終端状態(eclosion/death/lost)を持つ」か判定する
 * (design §4.4 ①)。apps/api/src/individual-routes.ts の deriveLifeStatus と
 * 同じ「直近の終端 life-event が優先」規約に合わせる: survival_correction が
 * 最新なら death/lost の撤回として扱い(S6と同じ取り消し可能性)、その場合でも
 * eclosion が過去に一度でもあれば「成体観測済み」として説明済みに数える
 * (eclosion はやり直しの無い一方向イベントのため撤回対象に含めない)。
 * ★判断: RULING §8 の3値「成体観測済み/N令死亡/追跡不能」には無いが、
 * specimen(標本化)は死亡後の状態でありdeath同様に終端として扱う
 * (「未説明」に落とすと明らかに実態と矛盾するため。判断根拠は報告書に記載)。
 */
async function isPromotedIndividualExplained(s: TruthStore, individualId: string): Promise<boolean> {
  const events = (await s.listEvents(`truth/${LIFE_TYPE}/${individualId}-`)).map(dataOf);
  const hasEclosion = events.some((d) => d.kind === "eclosion");
  const terminals = events.filter(
    (d) => d.kind === "death" || d.kind === "specimen" || d.kind === "lost" || d.kind === "survival_correction",
  );
  const last = terminals.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  if (last && (last.kind === "death" || last.kind === "specimen" || last.kind === "lost")) return true;
  return hasEclosion;
}

/**
 * コホート完結性の導出(design §4.4)。
 * 分母 = 最新recountのcounted(無ければinitial_count)。
 * 説明済み = ①promote済み個体のうち終端状態を持つ数
 *          + ②attritionのdeath_count合計
 *          + ②'promoteのdeath_count合計(★判断: 既存の projectClutchCurrentCount
 *            コメント「promote removes BOTH the promoted individuals AND any
 *            death_count照合済みの差分」が示すとおり、promote.death_countは
 *            attritionと同じ count層の減耗であり、含めないと分母との整合が
 *            取れない。理由は報告書に記載)
 *          + ③count層のままlost申告された数(★既存スキーマに機構なし。0固定。
 *            発注書の指示どおりスキーマは変更しない)
 * 生存中 = promote済みで未終端(①に含まれない)
 * 未説明 = 分母 − 説明済み − 生存中
 * completeness_ratio = 説明済み / 分母(分母0はゼロ除算を避け1として扱う=
 *   「説明すべき個体が最初から存在しない」ため trivially complete)
 */
export async function projectCohortCompleteness(
  s: TruthStore,
  clutchId: string,
): Promise<Record<string, unknown> | null> {
  const clutch = await s.readEvent(`truth/${CLUTCH_TYPE}/${clutchId}.json`);
  if (!clutch) return null;
  const cd = dataOf(clutch);
  const events = (await s.listEvents(`truth/${CLUTCH_EVENT_TYPE}/${clutchId}-`))
    .map(dataOf)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.event_id).localeCompare(String(b.event_id)));

  let latestRecountCounted: number | null = null;
  let attritionDeathSum = 0;
  let promoteDeathSum = 0;
  const promotedIds: string[] = [];
  for (const e of events) {
    if (e.kind === "recount" && typeof e.counted === "number") latestRecountCounted = e.counted;
    if (e.kind === "attrition") attritionDeathSum += Number(e.death_count ?? 0);
    if (e.kind === "promote") {
      promoteDeathSum += Number(e.death_count ?? 0);
      if (Array.isArray(e.promoted_individual_ids)) {
        for (const id of e.promoted_individual_ids) if (typeof id === "string") promotedIds.push(id);
      }
    }
  }

  const denominator = latestRecountCounted ?? Number(cd.initial_count ?? 0);

  let explainedIndividualTerminal = 0;
  for (const id of promotedIds) {
    if (await isPromotedIndividualExplained(s, id)) explainedIndividualTerminal++;
  }
  const surviving = promotedIds.length - explainedIndividualTerminal;

  // ③ count層のまま lost 申告された数: ind-clutch-event.schema.json の kind
  // enum は recount/attrition/promote のみで、attrition にも lost 系
  // フィールドは無い(実測。既存スキーマ・既存検出器を変えない発注書の指示に
  // 従い、機構を新設せず 0 固定とする)。
  const explainedCountLayerLost = 0;

  const explainedTotal = explainedIndividualTerminal + attritionDeathSum + promoteDeathSum + explainedCountLayerLost;
  const unexplained = denominator - explainedTotal - surviving;
  const completenessRatio = denominator > 0 ? explainedTotal / denominator : explainedTotal === 0 ? 1 : 0;

  return {
    clutch_id: clutchId,
    denominator,
    promoted_count: promotedIds.length,
    explained_individual_terminal: explainedIndividualTerminal,
    explained_attrition_death: attritionDeathSum,
    explained_promote_death: promoteDeathSum,
    explained_count_layer_lost: explainedCountLayerLost,
    explained_total: explainedTotal,
    surviving,
    unexplained,
    completeness_ratio: completenessRatio,
    complete: surviving === 0 && unexplained === 0,
  };
}
