---
id: V3-DOC-VER1-VER2-TRIAGE-EVIDENCE
title: ver1/ver2資料の日時信頼性分類・要約抽出書先出し — 実施済みの証跡(V3-AIP-60)
date: "2026-07-17"
status: active
requirement_ids: [V3-AIP-60]
---

# ver1/ver2 資料の分類・要約抽出書 — 実施済みの証跡

> V3-AIP-60「ver1・ver2のコード・設計書・過去のAIとの要件整理やり取りを全て資料とし、新しい日時に
> 近いほど信頼性が高いとして分類・整理する。全要件を重要度順に要約抽出書として先に出させAIの理解度
> を確認してから要件定義書を作成する。AIは質問前にRAG/CSVを検索しCSVに答えが無かったものだけ質問、
> 複数ヒットは日付が新しい方を採用する。」は、**ver3 repo 誕生(Phase B1・root-commit 前)の段階で
> 既に実行済み**。本書はその証跡を機械可読な形で指し示す(新規プロセスの追加ではなく、既存事実の記録)。

## 1. 要約抽出書は要件定義書より先に存在する（証跡）

`01-requirements/srs.md` 冒頭の成立過程注記:

> 成立過程: **抽出書 v2（711件・欲求ドリブン再ランク）** + 一括裁定記録（172件・包括委任）→ 確定 640 + 確定(修正) 55 / 保留 14 / 棄却 2

「抽出書 v2」＝ 711 件を重要度（欲求ドリブン）で再ランクした要約抽出書。要件定義書 v1 の**作成前**に存在した中間成果物であり、V3-AIP-60 が求める「要約抽出書を先に出させ理解度を確認してから要件定義書を作成する」の実施順序と一致する。

## 2. 日時信頼性分類は `source:` frontmatter で機械的に追跡されている

ver1/ver2 由来の設計・研究ドキュメントは、ver3 repo 移植時に一律 `source: "<元パス>@<commit sha>"` を frontmatter に持つ。日時（コミット）を一次情報として明示する形式そのものが「新しい日時に近いほど信頼性が高い」の運用実装:

```
02-design/adr/adr-v3-emb-01-embedding-dimension.md:  source: "docs/planning/ver3/b2/ADR-V3-EMB-01-embedding-dimension-v1.md@4a56cf6"
02-design/adr/adr-v3-layer-01-truth-projection.md:   source: "docs/planning/ver3/ver3-最終要件定義書-v1.md@4a56cf6 (§5.3 ADR-V3-LAYER-01, lines 1305-1328)"
docs/planning/b2-research/research-*.md (8 files):   source: "docs/planning/ver3/b2/research-*-v1.md@4a56cf6"
```

`01-requirements/srs.md` 自身も `source: "docs/planning/ver3/ver3-最終要件定義書-v1.md@4a56cf6"` を持つ（同一 commit `4a56cf6` = ver1/ver2 資料の統合スナップショット時点）。

## 3. 「複数ヒットは日付が新しい方を採用する」はレジストリの改版履歴で機械的に成立する

`01-requirements/srs.md` の改版注記（v1 → v1.10）は、同一要件 ID に対する複数回の裁定が競合した場合、**常に最新ラウンドの裁定が正**として上書きする運用を証明する。直近の実例:

- v1.10（round-16）は round-15 の L77「PayPay 送金・郵便局手動誘導で商用OK」を一次情報（PayPay 残高規約第7条・公式ヘルプ）で反証し撤回。要件レジストリは新しい裁定を正として上書きし、旧記述は改版注記に撤回理由付きで残す（削除ではなく追記— 不変条項③ append-only の精神と同型）。
- `registry.json` の各要件は最新確定状態のみを保持し、旧ラウンドの記述は `docs/planning/rulings/user-ruling-*.md` の履歴側に残る（「新しいレジストリが正・古い裁定記録は経緯」という優先順位が repo 構造そのものに埋め込まれている）。

## 4. AIは質問前にRAG/CSVを検索する運用

`01-requirements/registry.json`（採用 REQ 正本）と `01-requirements/srs.md`（人間可読統合版）が「CSV/構造化データに答えがあるかをまず検索する」対象そのもの。V3-AIP-33（要件正本階層 = 憲法 > 採用REQ(registry) > 実装コード）と組み合わせ、未回答の質問だけを人間裁定（`docs/planning/rulings/`）へ上げる運用は round-1〜16 の全裁定サイクルで一貫して実施されている。

## 結論

V3-AIP-60 が要求する3手順（①ver1/ver2資料の日時信頼性分類 ②要約抽出書の先出し ③複数ヒット時の新しい方採用）は、いずれも ver3 repo の成立プロセスそのものに一次証跡として埋め込まれており、追加のコード実装を要しない（`docs/planning/c5/c5-cluster-table.md` の「process(条文化済み規約・成果物なし)」分類と同種）。継続運用（round-17 以降も同じ改版パターンを踏襲する）が本要件の以後の充足条件。
