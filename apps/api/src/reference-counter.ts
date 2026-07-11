// 参照カウンタ投影(V3-AIP-45 / design-k8 §1.4)。ある Truth イベント(targetRef)を
// 派生系譜(provenance.input_event_ids)で参照する既存イベント数を、prefix scan で都度
// 再計算する純投影。**保存しない**(不変条項①「ID/Index は使う瞬間だけ発行・派生値は都度
// 再計算」)。常駐カウンタ DB を持たず、参照数が要る瞬間に R2 を全走査して数える。
import { TruthStore } from "@ihl/truth";

/**
 * targetRef を provenance.input_event_ids に含む既存イベントの数を数える(都度再計算)。
 * ponytail: truth/ prefix 全走査 = O(n)。MVP 量なら十分・投影 index は後波(design-c2 §3.1)。
 */
export async function projectReferenceCounter(
  s: TruthStore,
  targetRef: string,
): Promise<number> {
  const events = await s.listEvents("truth/");
  let count = 0;
  for (const e of events) {
    const prov = e.provenance as { input_event_ids?: unknown } | undefined;
    const refs = prov?.input_event_ids;
    if (Array.isArray(refs) && refs.includes(targetRef)) count++;
  }
  return count;
}
