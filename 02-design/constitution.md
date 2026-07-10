---
id: V3-DESIGN-CONSTITUTION
title: 設計書憲法 v2 — 新リポジトリ it-hercules-laboratory_ver3
date: "2026-07-10"
status: approved
source:
  - "05-運用/queues/00-設計書憲法-v1.md@4a56cf6 (C1〜C6・DET版問題・機械GATE)"
  - "05-運用/queues/00-フォルダ構成-v3-OSS.md@4a56cf6 (四分類・深度・DAG・アンチパターン思想)"
  - "docs/planning/ver3/b3/ver3-新repoフォルダ設計-v1.md@4a56cf6 (§1 L1〜L7・§7 ver3版)"
  - "docs/planning/ver3/b2/research-ai-first-data-design-v1.md@4a56cf6 (§5 AIファースト10ルール)"
  - "docs/planning/ver3/b3/ver3-開発計画-v1.md@4a56cf6 (§2.2 MVP-規約10要件)"
requirement_ids: [V3-AIP-61, V3-AIP-03, V3-AIP-31, V3-AIP-01, V3-AIP-46, V3-AIP-49, V3-CST-01, V3-SEC-07, V3-FND-14, V3-FND-16, V3-FND-17]
---

# 設計書憲法 v2 — it-hercules-laboratory_ver3

> **読者**: 将来の AI エージェントと開発者。本書は新 repo の全成果物が従う唯一の憲法。
> **正本**: 本ファイル。旧 repo `00-設計書憲法-v1.md`（C1〜C6）と `00-フォルダ構成-v3-OSS.md`（四分類・深度・DAG）を継承しつつ、グリーンフィールド最適化（L1〜L7）・AI ファースト規約・MVP-規約 10 要件を統合した v2。
> **v1 → v2 の骨子**: (a) 版番号ファイル名を廃止（L2）(b) AI 中間生成物を repo に入れない（L1）(c) スキーマ唯一正本 `schemas/`（L3）(d) パスは英語 kebab-case（L5）(e) 機械可読正本→人間可読ビューは生成物（P1）。

---

## 0. 4 本柱（本書全体を貫く原則）

| # | 原則 | 意味 |
|---|------|------|
| P1 | **AI ファースト** | 最大の読者は AI。機械可読（JSON/YAML/frontmatter 付き md）が正本、人間可読ビューは生成物 |
| P2 | **Truth は repo の外** | 永続正本は Cloudflare R2 append-only のみ。repo が持つのは契約（スキーマ）と投影を再生成する純粋関数 f |
| P3 | **憲法 C1〜C6 の継承** | 正本 1 つ / 破棄禁止 / 層分離 / 凍結 REQ / retrofit 尊重 / 機械 GATE |
| P4 | **常時公開可能状態** | シークレット実値ゼロ・PII ゼロを repo 誕生時から維持。公開の「実施」のみ人間ゲート |

---

## 1. 原則 C1〜C6（継承・意味は不変）

| # | 原則 | 意味 | ver3 での担保 |
|---|------|------|---------------|
| C1 | **正本は 1 つ** | 同一トピックに複数 md を「同等正本」として置かない | Spine を誕生時に固定・第二索引禁止（§4.3） |
| C2 | **破棄禁止** | 情報は削除しない。統合・stub・アーカイブ move のみ | git 履歴が担保。版番号ファイル名は不要になった（L2） |
| C3 | **層分離** | REQ / DET / 遷移 / UI / TEST / RTM / スキーマの責務を混ぜない | REQ にスキーマ本文・API path を書かない。スキーマは `schemas/` へリンク（L3） |
| C4 | **凍結 REQ** | `01-requirements/` の要件本文は CR 以外変更禁止。`schemas/frozen/` は対応 TC 緑化前は変更禁止 | CI が `schemas/frozen/` 変更を検知し CL negative TC を必須化 |
| C5 | **retrofit 尊重** | 既存実装を削らない。文書が追いつく（IMPL-GAP） | ver3 はゼロベースだが、ver3-live からの salvage 時に適用（V3-FND-17） |
| C6 | **機械 GATE** | 人間の「完成」宣言より GATE PASS を優先 | `scripts/` の機械 GATE が CI に接続（§4.4） |

---

## 2. 現 repo の反省点 → 新 repo の改善（L1〜L7）

グリーンフィールドなので、後付けで苦労したルールを構造で強制する。採番は撤回台帳 R-* / リスク台帳との衝突回避のため **L**（Lesson）とする。

| # | 現 repo の問題（事実） | 新 repo の改善 |
|---|------------------------|----------------|
| L1 | md 2000+ 件・quantum shards / slices が repo を支配 | **AI 中間生成物は repo に入れない**。作業ログ・分解 shard は Claude HQ（`D:\claude\ops\`）か scratchpad へ。repo は正本と Working（PR 単位）のみ |
| L2 | `詳細設計-v3.md` / v2 / v1 の版番号ファイル名 → stub 地獄 | **ファイル名から版番号サフィックスを廃止**。1 トピック = 1 安定ファイル名。版は frontmatter `status` + git 履歴 |
| L3 | `schemas/` と `02-設計/_横断/schema/` の二重正本 | **`schemas/` を唯一のスキーマ正本**（JSON Schema draft 2020-12）。設計文書は複製せずリンク。TS 型 / Python モデル / 人間文書は codegen |
| L4 | 第二索引・stub 迷路 | Spine を誕生時に固定。索引の新設はアンチパターン（§4.3） |
| L5 | 日本語ファイル名のエンコーディング事故・URL % エスケープ・grep 揺れ | **ディレクトリ・ファイル名は英語 kebab-case、日本語 title は frontmatter へ**（本文の日本語正本規約は維持） |
| L6 | mock PNG の複製（正本 vs アプリ public sync） | 静的資産は 1 置場（`assets/`）、アプリへの配置はビルド時コピー（Generated） |
| L7 | RTM が csv（人間可読）中心で機械検証が後付け | **`04-traceability/rtm.json` を正本**。csv/md ビューは生成 |

**継承して変えないもの**: V-model 番号付き 5 ボックスを root に露出（IHL 差別化）、四分類 Canonical/Working/Generated/Archive、深度制限・依存 DAG・アンチパターン文化、C-USB `components/` の独立トップ、日本語正本規約（本文言語）、V-model 5 点ゲート文化。

---

## 3. 命名・執筆規約

| 対象 | 規約 |
|------|------|
| ディレクトリ | 英語 kebab-case。V-model 5 ボックスのみ番号プレフィクス（`01-requirements/` 等）。非 ASCII・空白禁止 |
| md 文書 | 英語 kebab-case スラグ + **frontmatter 必須**: `id`, `title`（日本語可）, `date`, `status`, `requirement_ids` |
| 版管理 | **ファイル名に `-v1` 等を付けない**（L2）。`status: draft/approved/superseded` + git 履歴。共存が必要な大改版のみ `archive/` へ日付付き move |
| イベント・成果物 ID | ULID。オブジェクトキーは `<ULID>--<kebab-case-slug>.<ext>` |
| 要件 ID・イベント型名 | 文書とコードで**同一文字列**（`V3-XXX-NN`・`ihl.<domain>.<event>.v<N>`）。リンク化・略記で揺らさない（grep-ability） |
| md 本文 | **H2 セクション = 検索チャンク境界**。1 セクション 1 トピック・自己完結（代名詞で前セクションを指さない） |
| 生成物 | `<!-- GENERATED from <正本パス> — 編集禁止 -->` ヘッダ必須。CI が手編集を検知したら fail |
| AI 入口 | `AGENTS.md`（正本・120 行以内・命令形・禁止事項明記）/ `CLAUDE.md`（同内容複製 + 「正本は AGENTS.md」1 行・CI 同期チェック。symlink 不採用）/ `llms.txt`（5–12 リンク） |

---

## 4. 構造の強制（深度 / DAG / アンチパターン / 機械 GATE）

### 4.1 深度制限

| ツリー | 最大深度 | 超過時 |
|--------|----------|--------|
| `docs/` | 4 | flatten または index 化 |
| `02-design/features/<slug>/` | 2（slices/sub 廃止で ver2 の 3 から強化） | 分割は新 feature へ |
| `schemas/` | 3（`frozen/` `events/` `api/` + ドメイン 1 段） | |
| `components/<name>/` | 2（`tests/` まで） | 部品分割 |
| `libs/<domain>/` | 2（~15 files/dir 目安） | |
| `apps/*` / `packages/*` | workspace package 1 階層（nested 禁止） | |
| `scripts/` | 3 | |

### 4.2 依存方向 DAG

```text
apps/  ──►  packages/*  ·  libs/<domain>/  ·  components/*
                │                │
                └──── 読む ────► schemas/（葉。何にも依存しない）
screen-defs/（データ）──読まれる──► apps/web の単一 Renderer
```

| ルール | 内容 |
|--------|------|
| D1 | `apps → packages \| libs \| components` のみ。**apps → apps 禁止** |
| D2 | `libs/ packages/ components/ → apps` 禁止 |
| D3 | **`*/shared/` 禁止**（`libs/shared/`・`apps/*/shared/`） |
| D4 | `schemas/` は葉。schemas から他への依存禁止。codegen の向きは schemas → generated の一方向 |
| D5 | `screen-defs/` はデータであり import しない。Renderer だけが読む（V3-UIX-17/18） |
| D6 | UI（apps/web・screen-defs）はロジックを持たない。transform は components/libs 側（V3-UIX-19） |
| D7 | 投影コード（reducer/f）は Truth スキーマ（`schemas/frozen/` `schemas/events/`）にのみ依存。投影層にしか存在しない事実を作らない（ADR-V3-LAYER-01 不変条件） |

### 4.3 アンチパターン表（ver3 版）

| パターン | 理由 | 由来 |
|----------|------|------|
| `*/shared/` | 責務不明の吹き溜まり | 継承 |
| 生成物（`docs/generated/` 等）の手編集 | palimpsest 化・逆流 | 継承 + P1 |
| nested npm packages / apps 相互 import | ビルド・デプロイ結合 | 継承 |
| 空フォルダの先行作成 | Diátaxis workflow 違反 | 継承 |
| ファイル名に版番号サフィックス（`-v1.md` 等） | stub 地獄の根本原因（L2） | ver3 新規 |
| AI 中間生成物（shards/分解ログ）のコミット | repo 肥大の根本原因（L1）。HQ `ops\` へ | ver3 新規 |
| スキーマの複製（設計書へのフィールド表転記） | 二重正本（L3）。`schemas/` へリンクせよ | ver3 新規 |
| 第二索引の新設（spine 5 + AI 入口以外の「読む順」） | 競合 spine（L4） | 継承強化 |
| 日本語・空白・非 ASCII のパス名 | §3 違反。CI lint 対象 | ver3 新規 |
| `schemas/frozen/` の変更（対応 TC 緑化前） | CL-01〜13 形式凍結違反 | ver3 新規 |
| ユーザー向け UI への「未実装」「WIP」表記 | V3-UIX-01 | 継承 |

### 4.4 機械 GATE（C6 の実体）

| GATE | 置場 | 内容 |
|------|------|------|
| filename lint | `scripts/` | 非 ASCII パス・版番号サフィックス検出で fail |
| frontmatter 検査 | `scripts/` | 必須キー（`id`/`title`/`date`/`status`）欠落で fail |
| 生成物手編集検知 | `scripts/` | GENERATED ヘッダ照合。正本と乖離で fail |
| スキーマ検証 | `scripts/` | `schemas/` の JSON Schema validate + `frozen/` 変更 → CL negative TC 必須化 |
| RTM カバレッジ | `scripts/` | `04-traceability/rtm.json` の要件 ID ↔ TC 閉包 |
| CLAUDE ↔ AGENTS 同期 | `scripts/` | 両ファイルの本文一致（symlink 不採用のため） |

---

## 5. AI ファースト 10 ルール（新 repo 初日から適用）

`research-ai-first-data-design-v1.md` §5 の 10 ルールを憲法条文として転記する。

1. **エージェント入口**: ルートに `AGENTS.md`（正本・120 行以内・命令形・禁止事項明記・詳細はリンク）。`CLAUDE.md` は同内容複製 + 正本宣言 1 行。サブディレクトリ固有規約は入れ子 `AGENTS.md`。
2. **llms.txt**: 公開ドキュメントサイトのルートに `llms.txt`（H1 + 要約 + H2 区切りのリンク集）。
3. **イベントエンベロープ（R2 Truth）**: 全イベントは CloudEvents v1.0 準拠 JSON。必須: `specversion:"1.0"`, `id`（ULID）, `source`, `type`（`ihl.<domain>.<event>.v<N>`・バージョン内包）, `time`, `dataschema`（`schemas/` 相対 URI）。拡張: `provenance`（生成主体・入力イベント ID 列）。
4. **スキーマ進化**: 追加は nullable か既定値付きのみ（非破壊）。破壊的変更は `type` のバージョンを上げ新イベントとして発行。**旧イベントの UPDATE/DELETE・in-place 変換は禁止**。upcaster は投影層コードに置き、旧→新の変換テストを必ず伴う（批評家ゲート項目）。
5. **スキーマ正本**: `schemas/*.schema.json`（JSON Schema draft 2020-12）が唯一の正本。TS 型・Python モデル・スキーマ文書は codegen。生成物には GENERATED ヘッダ必須。
6. **ID とファイル名**: 全イベント・成果物 ID は ULID。オブジェクトキー/ファイル名は `<ULID>--<kebab-case-slug>.<ext>`。ディレクトリは Hive 形式パーティション `events/type=<type>/date=YYYY-MM-DD/`。
7. **Parquet 投影**: 書込時に kv metadata として `schema_id`・`source_event_range`（最初と最後の ULID）・`generated_at`・`generator` を埋め込む。ZSTD 圧縮。検証クエリを CI に入れる。
8. **Markdown 執筆規約**: H2 セクション = 検索チャンク。1 セクション 1 トピック・自己完結。全文書に YAML frontmatter（`id`/`title`/`date`/`status`/関連要件 ID）。
9. **人間可読ビュー**: HTML・要約・多言語版・ダッシュボードは全て生成物。生成物ディレクトリは手編集禁止を AGENTS.md の禁止事項に明記し逆流を防ぐ。
10. **grep-ability**: 要件 ID・イベント型名・スキーマ ID は文書とコードの双方に同一文字列で書く（リンク化・略記で表記揺れさせない）。AI の横断検索は grep が最初の手段。

---

## 6. 批評家ゲート・チェックリスト（納品前必須）

> V3-AIP-03: 批評家を通らないものは納品されない。rubber-stamp / checkbox theater 禁止。実装 EXEC と監査 AUDIT は別エージェント。

PR / 成果物は以下を全て満たしてから納品する。1 つでも欠ければ差し戻し。

- [ ] **仕様適合**: 対応する要件 ID（`V3-XXX-NN`）を明記し、その受入基準を満たす。
- [ ] **出典実在**: 引用パス・行番号・URL が実在し到達可能（捏造出典なし）。
- [ ] **intent 網羅**: 要件本文の各含意が漏れなく反映されている。
- [ ] **矛盾検査**: 既存正本（憲法・要件・スキーマ）と矛盾しない。
- [ ] **スキーマ変更 PR には upcaster テスト必須**: `schemas/` を変更する PR は「旧イベントが新コードで読めること」の upcaster テストを同梱する（AI ファースト ルール 4・§5⑤）。テストなしのスキーマ変更は fail。
- [ ] **green は実測エビデンス必須**: 「動く」「完了」「[x]」は実行ログ・スクリーンショット等の実測エビデンスがある時のみ。browser 実機検証を伴う機能は実機 PASS のみ。動かない機能を「できる」と書かない（V3-AIP-03）。
- [ ] **CL 回帰**: `schemas/frozen/`（CL-01〜13）に触れる変更は対応 negative TC が緑（`tests/`）。
- [ ] **人間ゲートの停止報告**: 公開実施・実鍵投入・金銭・物理鍵・撤回台帳復活・常駐トークン消費開始に触れる場合、機械が `[x]` を偽装せず停止報告する（V3-AIP-31）。

---

## 7. MVP-規約 10 要件（新 repo 誕生日から全コミットに適用・条文転記）

実装物ではなく規約。開発計画 §2.2 の 10 件を条文として本憲法に固定する（本人裁定原文の転記）。

| ID | 条文（要旨） |
|----|------|
| **V3-AIP-03** | 実装物は独立の批評家/監査エージェント（実装 EXEC と監査 AUDIT は別エージェント）を必ず通してから届ける。rubber-stamp / checkbox theater を禁じ、browser 実機検証を伴う場合のみ PASS、完了マークは実測エビデンスがある時だけ付ける。動かない機能を「できる」と言わない。 |
| **V3-AIP-31** | 人間ゲート / human-in-the-loop を必須とする。ワンクリック全自動を禁止し AI は補助であり決定者ではない（候補を示し人間が選ぶ）。GMO 本番・法務確定文言・Tier D 物理鍵等の人間専用ゲートで機械が `[x]` を偽装せず必ず停止報告、自動処理は opt-in、AI は文化・残高・世界法を自動変更せず自動推測・自動生成を行わない。判断理由は公開しブラックボックスを禁止、不明点は勝手に補完せず保留として記録する。 |
| **V3-AIP-01** | モデル分業を制度化する。計画・設計・レビューは高 effort モデル、機械的作業は effort low の Sonnet/Auto に委譲し、実装物は必ず独立の批評家を通す。Fable5 は計画/設計/レビュー専用で自身は大量実装しない。 |
| **V3-AIP-46** | OSS/import を最大活用し車輪の再発明をしない。各サブシステムを OSS から機能ごとにコンポーネント化し、OSS は薄くラップ（USB-C/C-USB ファイル契約: input manifest を読む / artifact 生成 / output manifest・errors を必ず出す / 既存ファイルを更新・削除しない）して交換可能な部品とする。自作コードは接続用ドライバに限定し薄く保つ。 |
| **V3-AIP-49** | テスト文化を全レイヤー緑前提で運用する。backend unit / frontend unit / E2E（Playwright）を自動化し、UI から「入力→実行→保存」までがボタン・画面レベルで動作することを機能ごとに網羅 E2E で検証（スモークではない）、新機能追加時の既存回帰率 0% を受入とする。本番コード（R2）を差し替えずローカルメモリでモックし統合テストできる仕組みも持つ。E2E は CI（Ubuntu）を正とする。 |
| **V3-CST-01** | 10 年間ユーザーが増えなくてもコストを賄える構造を最優先とし、ユーザー数に比例して増える従量課金（embedding API 等）を絶対に避け、計算資源はユーザー側に持たせる。運営コスト目標は月 300〜1000 円規模、サーバーレス（Cloudflare Pages/Workers/R2）中心 + 最小 VPS（メール/magic-link・Webhook 中継のみ）。閲覧系はアカウント不要で負荷分散、書込系のみ認証必須、メンテ処理はバッチ（5 分/1 時間/1 日毎）化。 |
| **V3-SEC-07** | 個人情報を保存前に必ず PII 検出→マスク→保存の順で処理し、マスク前データの保存・復元・ログ残留を一切禁止する。Truth/R2 には平文 PII（氏名・住所・電話・銀行口座）を保持せずユーザー識別は user_id_hash のみ、email_index は SHA256 ハッシュキーで持つ。観測 PII は平文で保存せず暗号化またはセッション限定の一時保持とする。 |
| **V3-FND-14** | システムの同期・接続・管理の最小単位を C-USB（Civilization-USB: core/rag/io/compatibility/security、IN→Transform→OUT）とし、これを前提としない独自フォーマットを新規に生やさない。全 Component を交換可能・追跡可能・意味的互換つきで接続し、全エンティティを CoreEntityBase（系譜メタ core + 検索メタ rag）で表現。OSS は薄くラップし固定するのは schema/manifest/ID/入出力契約に限る（UI から直接 OSS を叩くアンチパターン禁止）。差替時は 6 項目（インターフェース一致/依存互換/画面文脈/AI 資源/RAG/スタイル）を緑黄赤で検証。 |
| **V3-FND-16** | フォーク文化を前提とし全構成を置換しても同一文明であり続ける（R2 = 神域は fork 不可）を承認する。ただし (a) Kernel の fork 可否、(b) OS 差し替え単位（ユーザー毎か文明 1 つか）の 2 点は本人未決のため確定を保留し、決まり次第反映する。 |
| **V3-FND-17** | it-hercules-laboratory を唯一の新製品（OSS public）の正本とし、civilization-os は legacy/archive として参照・salvage のみに限定、frontend/backend への新機能実装・双方向ミラー同期を禁止する。OSS は設計 01–05 と apps/libs を一体にしたフル repo を単一 clone で公開。既存の使えるコードは新フォルダ配下に借りて綺麗に作り直し（salvage は配線 = api/hook/型を残し見た目 CSS/JSX は作り直す Option A）。wiki 正本は git。外部 API・命名規則・レイヤー構造・コンポーネント体系は OSS 化前に固定しガラパゴス化を禁止する。 |

---

## 8. 出典

| 出典 | 使用箇所 |
|------|----------|
| `05-運用/queues/00-設計書憲法-v1.md`（C1〜C6・機械 GATE・正本ではないもの） | §0 P3・§1 |
| `05-運用/queues/00-フォルダ構成-v3-OSS.md`（四分類・深度・DAG・アンチパターン・IHL 差別化） | §2・§4 |
| `docs/planning/ver3/b3/ver3-新repoフォルダ設計-v1.md`（§1 L1〜L7・§3 命名・§7 深度/DAG/アンチパターン・§5.3 批評家ゲート） | §2・§3・§4・§6 |
| `docs/planning/ver3/b2/research-ai-first-data-design-v1.md`（§5 適用ルール集 10 条） | §5 |
| `docs/planning/ver3/b3/ver3-開発計画-v1.md`（§2.2 MVP-規約 10 要件） | §7 |
| `docs/planning/ver3/ver3-最終要件定義書-v1.md`（V3-AIP-03/31/01/46/49・V3-CST-01・V3-SEC-07・V3-FND-14/16/17 条文） | §7 |

---

*本書は Phase C 冒頭の初期化チェックリスト（フォルダ設計 §8 手順 3・4）で新 repo に設置する Contributor Spine の 1 つ。改訂は append 追記または git 履歴で行い、既存条文の書き換えは誤記修正に限る（C2）。*
