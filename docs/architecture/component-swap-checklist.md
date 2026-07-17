---
id: V3-DOC-COMPONENT-SWAP-CHECKLIST
title: C-USB コンポーネント差替チェックリスト
date: "2026-07-17"
status: active
requirement_ids: [V3-FND-14]
---

# C-USB コンポーネント差替チェックリスト

> V3-FND-14「差替時はインターフェース一致/依存互換/画面文脈/AI資源/RAG/スタイルの
> 6 項目を緑黄赤で検証する」の実務チェックリスト。人間レビュー用(機械 GATE ではない
> — 機械 GATE は manifest.json の構造検証。`scripts/lint-components.mjs`)。
> 「差替」= `components/<name>/` 配下の OSS バックエンド実装を別実装へ入れ替える操作
> (manifest.json の契約・`cusb_layer` は保つ)。

## 6 項目(緑=適合・黄=要注意・赤=不適合)

| 項目 | 何を見るか | 赤の例 |
|---|---|---|
| 1. インターフェース一致 | `manifest.json` の `entrypoint`/`inputs`/`outputs` 契約が旧実装と同じ形で満たされるか | 出力フィールドの型・単位が変わる |
| 2. 依存互換 | 新 OSS の依存(ライセンス・実行環境・バージョン)が `lint-deps.mjs`/`lint-components.mjs` gate と両立するか | 常駐 DB 依存の混入(V3-FND-02 違反) |
| 3. 画面文脈 | UI から直接 OSS を叩くアンチパターンになっていないか(component 経由を保つ) | Renderer が component をバイパスして OSS API を直接呼ぶ |
| 4. AI 資源 | LLM/Vision 等コストのかかる呼び出しを新規に常時化していないか(不変条項①既定 OFF) | 差替後に従量課金 API 呼び出しが既定 ON になる |
| 5. RAG | 検索可能性(title/tags/embedding)が壊れていないか(CoreEntityBase の rag メタ) | 新実装が embedding/title/tags を出力しなくなる |
| 6. スタイル | 出力の見た目/文言が既存 UI トークン・文言規約(`check-ui-tokens.mjs`/`check-ui-copy.mjs`)と整合するか | 生成物が ThemePack 外の色/文言を持ち込む |

## 手順

1. `components/<name>/manifest.json` の `cusb_layer`(`core`/`rag`/`io`/`compatibility`/`security`)を確認し、差替先も同じ層の契約を満たすことを確認する。
2. 上表 6 項目を緑黄赤で採点し、赤が 1 つでもあれば差替は不採用(黄は理由をコミットメッセージに残して可)。
3. `npm run lint`(component lint 含む)+ 対応する `tests/` を緑化してからコミットする。

## 現行コンポーネントの `cusb_layer` 割当(参考)

| component | cusb_layer | 理由 |
|---|---|---|
| `components/collector-switchbot/` | `io` | SwitchBot Cloud API から観測値を取得し署名付き ingest として外部へ出す境界部品(IN→Transform→OUT の典型) |
| `components/wiki-ingest/` | `rag` | embedding backend(PyTorch/ONNX)のパリティ検証 — 検索(RAG)基盤の交換可能性を担保する部品 |
| `components/obs-manifest/` | (未オンボード) | `manifest.json` 未追加 — オンボード=manifest 追加時にこの表へ追記し gate 対象化 |
