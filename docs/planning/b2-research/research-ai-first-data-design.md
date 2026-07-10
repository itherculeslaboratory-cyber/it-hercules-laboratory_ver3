---
source: "docs/planning/ver3/b2/research-ai-first-data-design-v1.md@4a56cf6"
id: B2-RES-AI-FIRST-DATA-v1
title: AIファーストデータ設計のベストプラクティス調査
date: 2026-07-10
status: draft
decision: "ver3 は AGENTS.md(=CLAUDE.md symlink)+llms.txt の repo 規約、CloudEvents 風エンベロープ(type 内バージョン+ULID+provenance)の append-only イベント、JSON Schema を単一正本とする自己記述スキーマ、Parquet kv_metadata 埋め込み、見出し=チャンク境界の Markdown 規約、人間可読ビュー全生成の 7 点セットを標準規約として採用する"
sources_count: 16
revalidate_before_impl: true
---

# AIファーストデータ設計のベストプラクティス調査（ver3 Phase B2）

> 読者想定: 将来の AI エージェントと開発者。調査日: 2026-07-10。全出典は同日にアクセス確認済み。
> ユーザー裁定（正本 = `docs/planning/ver3/HANDOFF-ver3-phase-b2.md` §3-5）: 「データは AI ファースト設計に。最大の読者は AI。人間可読ビューは生成物」。

## 1. 結論（選定）

ver3 の新 repo（`it-hercules-laboratory_ver3`）は、次の 7 点セットを **repo 誕生時から** 適用する。
(a) エージェント向け入口として **AGENTS.md を正本とし CLAUDE.md は symlink**、公開ドキュメントサイトには **llms.txt** を置く。
(b) R2 Truth の append-only イベントは **CloudEvents v1.0 準拠の薄いエンベロープ**（`specversion`/`id`/`source`/`type`/`time`/`dataschema` + 独自 `provenance` 拡張）とし、**イベント型名にバージョンを内包**（例 `ihl.obs.image_captured.v1`）、**upcasting は投影層のみ**で行いストア内イベントは書き換えない。
(c) スキーマの単一正本は **JSON Schema（repo 内 `schemas/`）** とし、TypeScript 型・Python モデル・人間向けスキーマ文書はすべてそこから生成する。
(d) ID は **ULID**（時系列ソート可・26 文字・URL 安全）を全イベント・全成果物に採用し、ファイル名は `ULID--自己説明スラッグ` 形式で grep 可能にする。
(e) 投影層 Parquet には **`parquet_kv_metadata` で schema_id・生成元イベント範囲・生成日時を埋め込み**、DuckDB から自己記述的に検証できるようにする。
(f) Markdown ドキュメントは **H2 見出し = RAG チャンク境界** を前提に、1 セクション 1 トピック・自己完結で書く。
(g) 人間可読ビュー（HTML・要約・ダッシュボード）は **すべて CI/スクリプトによる生成物**とし、手書き複製を禁止する（docs-as-code の single source of truth 原則）。

## 2. 根拠（出典付き・全て 2026-07-10 アクセス）

1. **AGENTS.md は業界の事実上標準になった。** 60,000+ リポジトリが採用し、Claude Code / Codex / Cursor / Gemini CLI / Copilot など 25 以上のツールがネイティブに読む。2025-12 に Linux Foundation 傘下（Agentic AI Foundation）へ寄贈され、モノレポではディレクトリ最近傍の AGENTS.md が優先される入れ子規約も定義済み。→ ver3 が独自形式を発明する理由はない。
   - https://agents.md/ （公式。WebFetch で内容確認）
   - https://github.com/agentsmd/agents.md （リポジトリ）
2. **llms.txt はサイト側の LLM 向け入口として実用段階。** Jeremy Howard 提案（2024-09-03）の Markdown 形式仕様。正式標準ではないが 2026 年時点で約 10% のドメインが採用し、Anthropic・Vercel など開発者向け企業が先行。Cursor / Claude Code 等の IDE エージェントが `/llms.txt` `/llms-full.txt` を実際に取得する。→ OSS 公開サイト（it-hercules.uk 後継）に設置する価値がある。ただし Google Search 側は不要と表明しており「エージェント用」と割り切る。
   - https://llmstxt.org/ （仕様原文。WebFetch で内容確認）
   - https://presenc.ai/research/state-of-llms-txt-2026 （2026 年採用状況調査）
3. **CLAUDE.md は「短く・命令形・禁止事項明記」が定説。** 実効 80〜120 行、直接命令形（「〜しない」を含む否定規則が特に重要）、詳細は深い文書へのポインタで済ませる。複数エージェント対応は「AGENTS.md 正本 + symlink」が推奨パターン。Claude Code 公式も CLAUDE.md / `.claude/rules/` / auto-memory の階層を文書化している。
   - https://code.claude.com/docs/en/memory （公式ドキュメント）
   - https://dev.to/nishilbhave/claudemd-best-practices-the-complete-2026-guide-435j
4. **イベントのエンベロープは CloudEvents v1.0 が最小十分。** `specversion` 必須、`dataschema` はスキーマ URI（非互換変更は別 URI）、独自属性は拡張として追加可。イベント型のバージョンは `type` に内包する方式（`com.example.user.created.v1`）が推奨されている。→ ver3 の `schema_version` + `provenance` 要求をゼロ発明で満たせる。
   - https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md （仕様原文）
   - https://cloudevents.io/ （CNCF プロジェクトページ）
5. **append-only ストアのスキーマ進化は「非破壊変更+upcasting」が定石。** 追加は nullable/既定値付きで非破壊に、破壊的変更は新バージョンのイベント型を発行し、古いイベントは **書き換えずに** デシリアライズ時に upcast する（複数バージョンの共存は正常な状態）。「そもそもバージョニングを不要にする設計が最善」も同記事の要点。→ ver3 の append-only 不変条項③と完全に整合。
   - https://event-driven.io/en/simple_events_versioning_patterns/ （WebFetch で内容確認）
   - https://docs.eventsourcingdb.io/best-practices/versioning-events/
   - https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing （イベントソーシング一般原則）
6. **JSON Schema は LLM との「データ契約」の共通語。** 構造化出力・tool use の入出力定義は JSON Schema が業界横断の契約形式であり、エージェント間通信の型保証にもそのまま使える。→ イベント data 部・API・エージェント成果物のスキーマ正本を JSON Schema に一本化すれば、LLM が読む・書く・検証する全てが同じ形式になる。
   - https://blog.promptlayer.com/how-json-schema-works-for-structured-outputs-and-tool-integration/
7. **ULID は「時系列ソート可能 + grep 可能」を両立する。** 48bit タイムスタンプ + 80bit 乱数、Crockford Base32 の 26 文字（UUID の 36 文字より短い）、辞書順ソート = 時系列順。ファイル名やログに埋めれば `ls` / `grep` だけで時系列追跡でき、DB インデックス断片化も UUIDv4 より少ない。
   - https://github.com/ulid/spec （仕様原文。WebFetch で内容確認）
   - https://www.honeybadger.io/blog/uuids-and-ulids/
8. **Parquet は自己記述形式で、カスタム KV メタデータを持てる。** DuckDB は `parquet_kv_metadata()` / `parquet_schema()` / `parquet_file_metadata()` で任意のキー値メタデータとスキーマを SQL から直接照会できる。→ 投影 Parquet に「どのイベント範囲から・どのスキーマで・いつ生成したか」を埋め込めば、投影が Truth から再導出可能であることを機械検証できる。パス設計は `date=*/` 形式の Hive パーティションが推奨。
   - https://duckdb.org/docs/current/data/parquet/metadata.html （WebFetch で内容確認）
   - https://duckdb.org/docs/current/data/parquet/tips
9. **RAG チャンクは構造（見出し）境界に揃えるのが最大の改善。** Markdown の H2 セクションが自己完結チャンクとして最も機能し、論理境界に沿った適応チャンキングは固定長分割を大差で上回るという報告がある（臨床 DS 研究で 87% vs 13%）。→ 「書く時点でチャンク境界を作る」= H2 単位で自己完結に書く規約が、将来の検索基盤（wiki 統合・埋め込み）への最安の投資になる。
   - https://www.firecrawl.dev/blog/best-chunking-strategies-rag
   - https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide
10. **「人間可読ビューは生成物」は docs-as-code の確立済み原則。** 文書タイプごとに単一正本を定め、公開版は全て CI で生成する。コード/スキーマを Source of Truth にした自動生成は精度と同期を保証する標準プラクティス。→ ユーザー裁定そのものが業界標準と一致しており、逆流（生成物の手編集）だけを禁止すればよい。
    - https://konghq.com/blog/learning-center/what-is-docs-as-code
    - https://clickhelp.com/clickhelp-technical-writing-blog/code-to-docs-overview-how-to-generate-documentation-from-code-automatically/

## 3. 比較した代替案と却下理由

| 代替案 | 却下理由 |
|---|---|
| CLAUDE.md のみ（AGENTS.md なし） | Claude Code 専用になる。OSS として Codex/Cursor/Gemini 利用者を排除する。symlink 1 本で両立できるため独自路線の利点なし |
| 独自エンベロープを自作 | CloudEvents が CNCF 標準で全項目を既に定義済み。自作は将来の AI が学習済み知識で読めない形式を増やすだけ（コスト最小①違反） |
| Avro/Protobuf + Schema Registry | スキーマ進化機能は強力だが、レジストリという常駐インフラが増える（コスト最小①違反）。テキスト JSON + JSON Schema は LLM が直接読め、R2 だけで完結する |
| UUIDv4 | ソート不能・36 文字・タイムスタンプ情報なし。ULID の下位互換（128bit）で移行も容易なため採用理由がない。UUIDv7 は近い性質を持つが ULID の方が短く Base32 で URL/ファイル名に安全 |
| イベントの in-place マイグレーション（旧イベント書き換え） | append-only 不変条項③に真っ向から違反。upcasting（読み取り時変換）で同じ結果を不変性を保って得られる |
| llms.txt を README 代替として全面採用 | llms.txt は「サイト」向けであり repo 内ナビゲーションには AGENTS.md/README が担当。役割を混同しない。また SEO/AI 検索効果は 2026 年時点で不確実（Google Search は不要と表明） |
| ベクトル DB 前提のチャンク後付け | 書く時点で境界を守れば追加コストゼロ。専用チャンカー・ベクトル DB の導入判断は wiki 統合基盤の選定（別 B2 調査）に委ねる |

## 4. ver3 要件との接続

- **V3-AIP-96（夜間タスク・Tier S）**: 夜間に AI が生成する全成果物がエンベロープ+ULID+provenance を持てば、朝レビュー（かんばん）はイベントの投影として自動生成できる。
- **V3-AIP-97（Claude HQ 階層）**: `D:\claude\00-HQ` の運用規約・裁定ログも本規約（frontmatter + H2 自己完結 + 生成ビュー）で書くことで、HQ 横断検索が同一の規約で機能する。
- **B4 設計書 3 種（AI 用/一般人用/開発者用）**: 「AI 用（機械可読）が正本、他 2 種は生成物」という構図が本調査の結論 (g) と一致。B4 は本規約を前提に設計する。
- **不変条項との適合**:
  - **①コスト最小**: 常駐インフラ追加ゼロ（レジストリ・ベクトル DB なし）。R2 + Parquet + 静的ファイルのみ。
  - **②fork 文化**: AGENTS.md/llms.txt/JSON Schema/CloudEvents は全て開放標準。fork した第三者のエージェントが初見で読める。
  - **③append-only**: 旧イベント書き換え禁止 + upcasting は投影層のみ、を規約として明文化（§5 ルール 4）。
  - **④人間ゲート**: 規約自体は事後承認方式の対象（AI が完成品まで作る）。公開実施のみ人間ゲート。
  - **⑤批評家ゲート**: スキーマ変更 PR には「旧イベントが読めることの検証（upcaster テスト）」を批評家ゲートの必須チェック項目に追加する。

## 5. ver3 への具体的適用ルール集（新 repo に最初から入れる規約）

新 repo `it-hercules-laboratory_ver3` の初期コミットに含める規約。条文はこのまま `AGENTS.md` と `docs/conventions/` に転記して使う。

1. **エージェント入口**: ルートに `AGENTS.md`（正本）を置き、`CLAUDE.md` はその symlink（Windows では同内容+「正本は AGENTS.md」の 1 行）。内容は 120 行以内・命令形・禁止事項明記・詳細はリンク。サブディレクトリ固有規約は入れ子 `AGENTS.md`。
2. **llms.txt**: 公開ドキュメントサイトのルートに `llms.txt`（H1 + 引用ブロック要約 + H2 区切りのリンク集）。各ページの `.md` 版を同 URL + `.md` で配信する。
3. **イベントエンベロープ（R2 Truth）**: 全イベントは CloudEvents v1.0 準拠 JSON。必須: `specversion: "1.0"`, `id`（ULID）, `source`, `type`（`ihl.<domain>.<event>.v<N>` 形式・バージョン内包）, `time`, `dataschema`（repo 内 `schemas/` への相対 URI）。拡張: `provenance`（生成主体: human / agent 名+モデル ID / device ID、および入力イベント ID 列）。
4. **スキーマ進化**: 追加は nullable か既定値付きのみ（非破壊）。破壊的変更は `type` のバージョンを上げ新イベントとして発行。**旧イベントの UPDATE/DELETE・in-place 変換は禁止**。upcaster は投影層コードに置き、旧→新の変換テストを必ず伴う（批評家ゲート項目）。
5. **スキーマ正本**: `schemas/*.schema.json`（JSON Schema draft 2020-12）が唯一の正本。TS 型・Python モデル・スキーマ文書（人間向け Markdown）は codegen。生成物には `<!-- GENERATED from schemas/... — 編集禁止 -->` ヘッダを必ず入れる。
6. **ID とファイル名**: 全イベント・成果物 ID は ULID。オブジェクトキー/ファイル名は `<ULID>--<kebab-case-自己説明スラッグ>.<ext>`（例 `01J1QZ...--molt-l3-first-shed.jpg`）。ディレクトリは Hive 形式パーティション `events/type=<type>/date=YYYY-MM-DD/`。
7. **Parquet 投影**: 書き込み時に kv metadata として `schema_id`, `source_event_range`（最初と最後の ULID）, `generated_at`, `generator`（スクリプト名+バージョン）を埋め込む。ZSTD 圧縮。検証クエリ（`parquet_kv_metadata()`）を CI に入れる。
8. **Markdown 執筆規約**: H2 セクション = 検索チャンク。1 セクション 1 トピック・そのセクションだけ読んで意味が通る（代名詞で前セクションを指さない）。全文書に YAML frontmatter（`id`, `title`, `date`, `status`, 関連要件 ID）。
9. **人間可読ビュー**: HTML・要約・多言語版・ダッシュボードは全て生成物。生成物ディレクトリ（例 `generated/`）は手編集禁止を AGENTS.md の禁止事項に明記し、逆流を防ぐ。
10. **grep-ability**: 要件 ID（`V3-XXX-NN`）・イベント型名・スキーマ ID は文書とコードの双方に**同一文字列**で書く（リンク化や略記で表記揺れさせない）。AI の横断検索は grep が最初の手段であることを前提にする。

## 6. リスクと再検証条項

本レポートの情報は **2026-07 時点** のスナップショットである。実装着手（Phase C）時に以下を再検証すること（frontmatter `revalidate_before_impl: true` の意味）。

- **llms.txt の標準化動向**: 2026-02 時点で IETF/W3C 標準ではなく、Google Search と Chrome Lighthouse で扱いが割れている。Phase C 時点で仕様変更・後継提案（llms-full.txt の扱い含む）を確認。
- **AGENTS.md の仕様固定度**: Linux Foundation 寄贈直後であり、必須セクションの追加など仕様が動く可能性。agents.md の最新版を再取得。
- **CloudEvents のバージョン**: v1.0 前提。v2 系が出ていれば `specversion` の扱いを再確認。
- **DuckDB API**: `parquet_kv_metadata()` 等の関数名は DuckDB のバージョンアップで変わり得る。実装時に current docs を再取得。
- **チャンキング知見の流動性**: 2026-02 のベンチマークでは recursive 512 トークン分割が semantic 分割を上回る等、結論が揺れている分野。H2 境界規約は「書き方」の投資として安全だが、検索基盤側の分割戦略は wiki 統合基盤選定時に改めてベンチを引く。
- **ULID vs UUIDv7**: UUIDv7 の標準採用（RFC 9562）が進んでおり、エコシステム（DB ネイティブ対応等)次第では UUIDv7 が有利になる可能性。Phase C で主要依存ライブラリの対応状況を確認。
- **出典の質の注記**: 根拠 2・9 の一部（採用率 10.13%、87% vs 13% 等の数値）は一次調査ではなく二次記事経由。数値を意思決定に使う場合は一次ソースまで遡ること。

## 7. 未解決の問い

1. **JSON Schema と Parquet スキーマの二重管理**: イベント（JSON）の正本は JSON Schema だが、投影 Parquet の列定義との対応をどう機械検証するか（codegen で Parquet スキーマも生成するか、CI で突合するか）は B3/B4 で設計が要る。
2. **provenance 拡張の粒度**: モデル ID・プロンプトハッシュ・コストまで記録するか。夜間タスク（V3-AIP-96）のコスト上限監査と絡むため B7 と併せて決める。
3. **Windows 環境での symlink**: 新 repo は Windows 開発が主。`CLAUDE.md` symlink が git/Windows でどう振る舞うか（`core.symlinks`）。実ファイル複製 + CI 同期チェックが現実解かもしれない。
4. **llms.txt を repo 自体にも置くか**: 仕様はウェブサイト向けだが、GitHub リポジトリ直下に置く事例も出ている。効果不明のため Phase C で実測判断。
5. **既存 ver2 データの遡及適用**: 本 repo（ver2）の既存イベントに ULID・エンベロープを遡及付与するか、移行境界で「v0 イベント」として封印するか。移行戦略（互換必須 13 レイヤー）の一部として B3 で裁定する。
