"use client";

import { useContext, useEffect, useState } from "react";
import { ScopeCtx, ExecuteCtx } from "../../core/context";
import { registerNode } from "../../core/registry";
import { useIndGet } from "./helpers";

// QRLINK-1(2026-08-08ユーザー裁定・R0807-1ef084-qr-deeplink・カードscore30=×・逐語対案
// 採用)の実装。個体の物理QR(bio-card qr_url・IND-15)の着地点。
// ★基本動線: 誰が読んでも個体の詳細(individual-detail)画面へ行ける(観測者本人でない
// 閲覧者・未ログインは追加観測できないが詳細は見える)。
// ★例外動線: QRを読んだ人がその個体の観測者本人と一致する時だけ、
// 『追加観測しますか?/詳細画面に行きますか?』の選択を出す(判定=GET .../profile の
// is_owner・PUBLIC_READ_ROUTES化はindex.ts不可侵のため報告書に逐語記載・HQ適用)。
// ★確認抑止設定: 選択画面のチェックボックス、または設定画面(settings.json
// qr_individual_action)のどちらからも変更できる(ask=既定/observe/detail・
// PATCH /api/v1/me/preferences・schemas/events/pref-set.schema.json)。
type IndProfileForHub = { individual_id: string; is_owner?: boolean };
type PrefsForHub = { qr_individual_action: string };

function IndQrHubNode() {
  const scope = useContext(ScopeCtx);
  const execute = useContext(ExecuteCtx);
  const id = String(scope.params.id ?? "");
  const profile = useIndGet<IndProfileForHub>(id ? `/api/v1/individuals/${id}/profile` : null);
  const isOwner = profile?.is_owner === true;
  const prefs = useIndGet<PrefsForHub>(isOwner ? "/api/v1/me/preferences" : null);
  const [remember, setRemember] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const goDetail = () => {
    void execute({ kind: "navigate", to: `individual-detail?id=${id}` });
  };
  const goObserve = () => {
    void execute({ kind: "navigate", to: `obs-register-entry?id=${id}` });
  };

  useEffect(() => {
    if (!id || !profile) return; // 個体投影の取得待ち
    if (!isOwner) {
      goDetail(); // 基本動線: 観測者本人以外・未ログインは常に詳細画面
      return;
    }
    if (!prefs) return; // 選好の取得待ち
    if (prefs.qr_individual_action === "observe") goObserve();
    else if (prefs.qr_individual_action === "detail") goDetail();
    else setChoosing(true); // "ask"(既定) = 例外動線の選択画面を出す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile, isOwner, prefs]);

  const choose = async (action: "observe" | "detail") => {
    if (remember) {
      try {
        await execute({ kind: "api", method: "PATCH", path: "/api/v1/me/preferences" }, { qr_individual_action: action });
      } catch {
        // best-effort: 保存に失敗しても遷移自体は続ける(次回また聞かれるだけ)
      }
    }
    if (action === "observe") goObserve();
    else goDetail();
  };

  if (!choosing) {
    return (
      <div className="civ-page">
        <h1>個体を確認しています…</h1>
      </div>
    );
  }

  return (
    <div className="civ-page">
      <h1>追加観測しますか? 詳細画面に行きますか?</h1>
      <p>この個体はあなたが観測者として記録している個体です。</p>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <button type="button" className="civ-btn civ-btn-primary" onClick={() => choose("observe")}>
          追加観測する
        </button>
        <button type="button" className="civ-btn" onClick={() => choose("detail")}>
          詳細画面を見る
        </button>
      </div>
      <label style={{ display: "block", marginTop: "0.75rem" }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {" "}次から聞かない(選んだ方に毎回進みます。設定画面(個体QR)からいつでも変更できます)
      </label>
    </div>
  );
}

registerNode("list:qr-individual-hub", IndQrHubNode);
