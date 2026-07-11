---
id: plaza-g5-design-five-points
title: 知の広場 本採用ゲート G5「設計ゲート5点」判定材料（ver3 実装証跡）
date: "2026-07-11"
status: active
---

# 知の広場 本採用ゲート G5 — 設計ゲート5点 判定材料

> **この文書の用途**: 人間が「レビューするだけで G5 を裁定できる」ための証跡束。G5 の定義正本は
> `ihl-ver2/docs/planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md` §1.4（G1〜G6 表）L82。
> G5 = 「Phase 2 詳細 · Phase 3 遷移 · Phase 4 UI · テスト設計 · CI」の5点が揃うこと（V-model gate）。
> **誇張ゼロ方針**: ver3 実装の実在は全て Read/Grep で確認し file:line を引いた。ver2 資料と食い違う点は §4 に「差分」として隠さず明記した。
> **スコープ限定**: 本文書は **G5 のみ** を扱う。G1（IA確定）/ G2（柱別 doc 人間 PASS）/ G3（RTM 閉包）/ G4（E2E 整合）/ G6（C1–C4 監査）は別ゲートで別途判定が要る（§5）。G5 単独 PASS は本採用 Go を意味しない。

---

## §0 判定サマリ（5点 早見表）

| # | G5 の点 | ver3 該当成果物 | 実測 | 判定 |
|---|---------|----------------|------|------|
| 1 | **Phase 2 詳細設計** | `design-c5.md §K6 §2.1〜2.5`（route/event型/投影/凍結定数）＋実装 `plaza-routes.ts`・`gov-routes.ts`・`plaza-constants.ts`・`schemas/events/plaza-*.json`・`gov-*.json`・`cite-ref.schema.json` | 設計正本＋実コードが1:1で存在 | **揃う** |
| 2 | **Phase 3 遷移** | `navigation.json`（home→hub→3柱→match）＋各 screendef の `transitions` ブロック＋`check-navigation` GATE | 遷移正本＋機械 GATE OK＋≤3クリック TC 緑 | **揃う** |
| 3 | **Phase 4 UI** | `screen-defs/knowledge-{hub,board,paper,github}.json`＋`home.json` ボタン | 既存12ノード catalog のみ・新ノード型ゼロ・i18n `text_key` 付・`check-screendef-structure` GATE OK | **揃う** |
| 4 | **テスト設計** | `design-c5.md §K6 §4`（TC計画・要件ID対応）＋実 TC 11ファイル55本 | 55/55 緑（実測ログ §3）・要件ID紐付済 | **揃う（1点だけ注記あり→§4-G）** |
| 5 | **CI** | `package.json` lint 18連鎖（L11）＋ test（L12）＋本波で実行した GATE 群 | validate-schemas / check-navigation / check-screendef-structure / codegen --check ×2 / vitest 全緑 | **揃う** |

**結論（§6 詳細）**: G5 の5点はいずれも ver3 に**該当成果物が実在し、機械 GATE が緑**。欠けている点は無い。ただし §4 の差分（特に §4-A の HG-KN 未裁定・§4-G の E2E スレッド spec 未産出）は G5 の**外側のゲート**に属するため、本採用 Go には別途 §5 の裁定が要る。

---

## §1 前提 — G5 の定義正本と ver3 の対応原理

- **G5 定義**: `知の広場-仮採用-MASTER-v1.md` §1.4 L82 — 「Phase 2 詳細 · Phase 3 遷移 · Phase 4 UI · テスト設計 · CI」。参照は `.cursor/rules/ihl-waterfall-v-model-gate.mdc`（ver2 側の V-model gate ルール）。
- **ver3 での設計正本**: `docs/planning/c5/design-c5.md` の `### K6 知の広場+ガバナンス(PROTECTED)` L1005〜L1189。第8回裁定の Zulip型 topic + Polis型投影（V3-BBS-36）は L1023 に確定記載。3柱 IA（V3-BBS-01）は L1017・L1100。
- **対応原理**: ver3 は ver2 の walkId lab（mock）を継承せず、**ScreenDef + Truth append-only + 決定論投影**で新規実装した。よって G5 の各点は「ver2 lab の設計 doc」ではなく「ver3 の design-c5.md §K6 ＋ 実コード ＋ screendef ＋ TC ＋ lint GATE」を証跡とする。

---

## §2 各点の証跡（file:line）

### 2.1 Phase 2 — 詳細設計（**揃う**）

**設計正本（design-c5.md §K6）**:

| 設計要素 | 位置 |
|---------|------|
| 対象要件13件の列挙 | `design-c5.md:1011`（V3-BBS-01/03/05/10/20/29/36・V3-GOV-01/09/12/13/19/23） |
| 要件→機構の対応表 | `design-c5.md:1015-1029` |
| route 表（全 protected・slot033-040） | `design-c5.md:1035-1061` |
| 新イベント型10種＋Truthキー構造＋dataキー | `design-c5.md:1067-1078` |
| CiteRef 単一正本・相対 $ref 方針 | `design-c5.md:1080` |
| 投影関数13種（全て決定論・LLM不使用） | `design-c5.md:1084-1094` |
| 凍結定数（plaza-constants.ts） | `design-c5.md:1111-1123` |
| 実装ファイル計画（NEW/MODIFY） | `design-c5.md:1127-1142` |
| 不変条項適合の確認 | `design-c5.md:1144` |

**実コード（設計→実装の1:1確認）**:

| 設計上の関数 / route | 実コード file:line |
|---------------------|-------------------|
| `plazaRoutes` エクスポート | `apps/api/src/plaza-routes.ts:38` |
| POST /plaza/posts（appendPost） | `apps/api/src/plaza-routes.ts:133` |
| GET /plaza/threads/:thread_id（projectThread） | `apps/api/src/plaza-routes.ts:193` |
| GET /plaza/channels/:channel/threads | `apps/api/src/plaza-routes.ts:224` |
| GET /plaza/posts/:post_id | `apps/api/src/plaza-routes.ts:229` |
| POST /plaza/stances | `apps/api/src/plaza-routes.ts:239` |
| GET /plaza/threads/:thread_id/consensus | `apps/api/src/plaza-routes.ts:288` |
| POST /plaza/forks | `apps/api/src/plaza-routes.ts:299` |
| GET /plaza/forks（projectForkRanks） | `apps/api/src/plaza-routes.ts:367` |
| GET /plaza/forks/:fork_id | `apps/api/src/plaza-routes.ts:376` |
| POST /plaza/signals | `apps/api/src/plaza-routes.ts:386` |
| GET /plaza/ranking | `apps/api/src/plaza-routes.ts:473` |
| POST /plaza/summaries | `apps/api/src/plaza-routes.ts:484` |
| GET /plaza/threads/:thread_id/summary（4層） | `apps/api/src/plaza-routes.ts:552` |
| `govRoutes` エクスポート | `apps/api/src/gov-routes.ts:27` |
| POST /gov/votes | `apps/api/src/gov-routes.ts:54` |
| GET /gov/rules/:rule_id/threshold（projectThreshold） | `apps/api/src/gov-routes.ts:104`（投影関数 `:83`） |
| GET /gov/os/promotion（projectOsPromotion） | `apps/api/src/gov-routes.ts:131`（投影関数 `:116`） |
| POST /gov/disputes（openDispute） | `apps/api/src/gov-routes.ts:141` |
| POST /gov/disputes/:dispute_id/messages | `apps/api/src/gov-routes.ts:204` |
| POST /gov/disputes/:dispute_id/close（→appendPrecedent） | `apps/api/src/gov-routes.ts:256`（appendPrecedent `:229`） |
| GET /gov/disputes/:dispute_id（projectDispute） | `apps/api/src/gov-routes.ts:296`（投影関数 `:170`） |
| GET /gov/precedents（projectPrecedents） | `apps/api/src/gov-routes.ts:323`（投影関数 `:304`） |
| GET /gov/precedents/:precedent_id | `apps/api/src/gov-routes.ts:329` |
| POST /gov/flags | `apps/api/src/gov-routes.ts:340` |
| 凍結定数（BOARD_KINDS 他11定数） | `apps/api/src/plaza-constants.ts`（全体）・design 定義 `design-c5.md:1111-1123` |

**スキーマ正本（schemas/ 単一正本・codegen 一方向）**: `schemas/events/` に `cite-ref.schema.json`・`plaza-post.schema.json`・`plaza-stance.schema.json`・`plaza-fork.schema.json`・`plaza-signal.schema.json`・`plaza-summary.schema.json`・`gov-vote.schema.json`・`gov-dispute.schema.json`・`gov-precedent.schema.json`・`gov-flag.schema.json` の10ファイル実在（`ls` 確認済）。TS 型は `packages/schema-types/src/generated/events/*.ts` に生成済（cite-ref.ts / plaza-*.ts / gov-*.ts 実在）。

> **判定**: Phase 2 詳細設計は「設計 doc §2.1〜2.5」＋「実コード・スキーマが 1:1 に存在」で **揃う**。批評家指摘5件（`design-c5.md:1180-1189`）は verdict=pass 節の実装時反映事項として記載されており、うち #5（flags の admin ゲート）は実装で解消済（→§4-F）。

### 2.2 Phase 3 — 遷移（**揃う**）

**遷移正本 `screen-defs/navigation.json`**:

| 遷移 | file:line |
|------|-----------|
| knowledge-hub をナビ登録 | `navigation.json:35`（board/paper/github も `:36-38`） |
| home → knowledge-hub | `navigation.json:208` |
| knowledge-hub → knowledge-board | `navigation.json:212-213` |
| knowledge-hub → knowledge-paper | `navigation.json:217-218` |
| knowledge-hub → knowledge-github | `navigation.json:222-223` |
| knowledge-paper → paper-match | `navigation.json:227` |

**screendef 内 transitions ブロック**:

- `screen-defs/knowledge-hub.json:50-54`（3柱カード→各柱）
- `screen-defs/knowledge-paper.json:38-40`（open-match→paper-match）
- `screen-defs/home.json:116`（open-knowledge→knowledge-hub）

**機械 GATE（実測）**: `node scripts/check-navigation.mjs` → `navigation GATE OK`（§3）。
**≤3クリック（BBS-01）**: `tests/knowledge-screens.test.ts`（3本・緑）が「home→hub→各柱主要操作が transitions 上 ≤3 クリック」を assert（design TC 計画 `design-c5.md:1158`）。

> **判定**: 遷移は正本 JSON ＋ 機械 GATE ＋ クリック数 TC で **揃う**。

### 2.3 Phase 4 — UI（**揃う**）

**screendef 4枚（既存 Renderer 12ノード catalog のみ・新ノード型/新コードゼロ）**:

| screen_id | route | file | 要点 |
|-----------|-------|------|------|
| knowledge-hub | /knowledge | `screen-defs/knowledge-hub.json`（55行） | 3柱カードのみ・タブノード不在（タブ/カード重複禁止=BBS-01）。各カード `action.kind=navigate`（`:21`・`:30`・`:39`） |
| knowledge-board | /knowledge/board | `screen-defs/knowledge-board.json`（50行） | 3板リンク（guide/complaint/improvement `:18-20`）・スレ list（`source_path=/api/v1/plaza/channels/knowledge-board/threads` `:25`）・投稿 form（POST /plaza/posts `:34`）・引用リンク `:43` |
| knowledge-paper | /knowledge/paper | `screen-defs/knowledge-paper.json`（41行） | 論文 list ＋ paper-match へ navigate（`:31`） |
| knowledge-github | /knowledge/github | `screen-defs/knowledge-github.json`（33行） | GitHub link-out（`external:true` 新タブ `:24-25`） |

**home.json ボタン追加**: `screen-defs/home.json:75-76`（「知の広場を開く」`action.kind=navigate to knowledge-hub`）。

**UI 品質 GATE**: 全ノードに i18n `text_key`/`label_key` 付与（例 `knowledge-hub.json:16`）。lint 連鎖に `check-ui-tokens`・`check-contrast`・`check-ui-copy`・`check-i18n-keys`・`check-screendef-structure` が含まれ（`package.json:11`）、`check-screendef-structure` → `screendef-structure GATE OK`（§3）。「未実装/WIP」UI 文言なし（V3-UIX-01 適合。上げ代は screendef notes に「ponytail: 別波」と設計注記＝UI 文言ではない・例 `knowledge-board.json:6`）。

> **判定**: UI は screendef 4枚＋home ボタンが実在し、既存 catalog のみで表現・機械 GATE 緑で **揃う**。

### 2.4 テスト設計（**揃う・§4-G に1点注記**）

**TC 計画正本**: `design-c5.md:1148-1158`（要件ID対応・FakeR2Bucket + AUTH_HEADERS パターン）。

**実 TC（11ファイル・計55本・全緑 §3）**:

| test file | 本数 | 対応要件（design より） |
|-----------|:---:|------------------------|
| `tests/plaza-posts.test.ts` | 8 | BBS-01/03/05/36-topic/20（topic必須400・ULID順view・correction追記共存・permalink不変・tombstone・チャネル分離・409・401） |
| `tests/plaza-cite.test.ts` | 4 | BBS-20（cite_refs[]正本・token従属・citeUrl 全type安定URL） |
| `tests/plaza-consensus.test.ts` | 5 | BBS-36（append収集・最新ULID採用・consensus/divisive決定論・LLM非依存） |
| `tests/plaza-fork.test.ts` | 6 | BBS-29/GOV-19/23（public→beginner・vote昇格・順序・minor除外・非削除共存・content_hash改変検知） |
| `tests/plaza-summary.test.ts` | 4 | BBS-10（block_index=floor(/100)・4層投影・空スロット許容・diff履歴） |
| `tests/gov-dispute.test.ts` | 6 | GOV-01（open→message→close遷移・2名限定・TTL超過expired・不服申立route不在） |
| `tests/gov-precedent.test.ts` | 4 | GOV-12（close時append・q/tag検索・CiteRef引用・DELETEなし） |
| `tests/gov-vote-threshold.test.ts` | 8 | GOV-19/23（threshold_adjust投影・os_merge promotable判定） |
| `tests/gov-flag.test.ts` | 5 | GOV-09（DELETEせず論理無効化・Δcount+10・台帳append・投影反映） |
| `tests/gov-no-automod.test.ts` | 2 | GOV-13（auto-moderation endpoint / NGワード表 不在の negative 回帰） |
| `tests/knowledge-screens.test.ts` | 3 | BBS-01（3柱カードのみ・≤3クリック・4 screendef が schema 妥当） |

**実測**: `npx vitest run`（K6 11ファイル）→ `Test Files 11 passed (11) / Tests 55 passed (55)`（§3）。

> **判定**: テスト設計は「§4 TC計画 → 実 TC 11ファイル55本・要件ID紐付・全緑」で **揃う**。
> **1点だけ注記（§4-G）**: 宣言的スレッド spec（V3-AIP-34）を正本とする **クロス画面 E2E**（K8 の `spec-thread.test.ts`）は spec ファイル未産出のため未存在（skip 予定と設計記載 `design-c5.md:1500`・`:1526`）。K6 の unit/投影/screendef レベルの TC は全緑だが、cluster をまたぐ E2E route-matrix 検証は本波の分母外。これは G5 の「テスト設計」より **G4（E2E 整合）** に属する論点。

### 2.5 CI（**揃う**）

**lint 連鎖（`package.json:11`・18チェック）**: lint-filenames → check-generated → check-agents-sync → **validate-schemas** → check-frontmatter → **codegen-schemas --check** → **codegen-validators --check** → codegen-theme-css --check → check-ui-tokens → check-contrast → check-ui-copy → **check-screendef-structure** → check-i18n-keys → check-secrets → check-cron → **check-navigation** → check-public-docs。
**test（`package.json:12`）**: `npm test -w apps/api -w tests -w apps/web`（vitest run）。
**mount（保護は自動）**: `apps/api/src/index.ts:14-15`（import）・`:163` `app.route("/api/v1", plazaRoutes)`・`:169` `app.route("/api/v1", govRoutes)`。全 route は deny-by-default で PROTECTED（PUBLIC_ROUTES 非登録＝自動保護）。

**本波での実測 GATE ログ（§3 に全文）**: validate-schemas / check-navigation / check-screendef-structure / codegen-schemas --check / codegen-validators --check がいずれも exit=0・OK。vitest 55/55 緑。

> **判定**: CI は lint 18連鎖＋test が定義済で、本波で回した関連 GATE が全緑。**揃う**。

---

## §3 実測 GATE ログ（2026-07-11 本波・再現可能）

```
# K6 テスト（tests/ ワークスペース・vitest run）
 ✓ tests/gov-no-automod.test.ts (2 tests)
 ✓ tests/knowledge-screens.test.ts (3 tests)
 ✓ tests/plaza-cite.test.ts (4 tests)
 ✓ tests/plaza-summary.test.ts (4 tests)
 ✓ tests/plaza-consensus.test.ts (5 tests)
 ✓ tests/plaza-fork.test.ts (6 tests)
 ✓ tests/gov-precedent.test.ts (4 tests)
 ✓ tests/plaza-posts.test.ts (8 tests)
 ✓ tests/gov-flag.test.ts (5 tests)
 ✓ tests/gov-vote-threshold.test.ts (8 tests)
 ✓ tests/gov-dispute.test.ts (6 tests)
 Test Files  11 passed (11)
      Tests  55 passed (55)

# lint GATE（関連チェックのみ抜粋・全 exit=0）
validate-schemas            → schema validation OK
check-navigation            → navigation GATE OK
check-screendef-structure   → screendef-structure GATE OK
codegen-schemas --check     → codegen --check OK (65 files in sync)
codegen-validators --check  → codegen-validators --check OK
```

---

## §4 ver2 資料との差分（隠さず明記）

ver3 実装は ver2 MASTER（PROVISIONAL・仮採用）を継承しつつ、実装確定のため以下を確定・変更した。**A〜E は設計判断の差分、F は良い方向の解消、G は G5 の外側に残る欠け**。

### §4-A 【最重要】HG-KN-01〜08 は ver3 で「推奨案を仮置き」しただけ・人間裁定は未了
ver2 MASTER §5 L259-266 は HG-KN-01〜08 を **OPEN な人間ゲート** として残す。ver3 は `design-c5.md:1174` で推奨案を **仮置き**（HG-KN-01=C / 02=C / 03=B / 04=A / 05=A / 06=A / 07=A / 08=B）し、screendef の route/カード構成に閉じた形で実装した（裁定確定後は JSON 差替でコード不変）。
→ **差分の意味**: G5（設計5点の存在）は満たすが、この仮置きの**是非判断そのものは G1（IA確定）の人間裁定**であり未了。ver3 の screendef は「裁定が別答なら差し替える」前提で作られている（各 screendef notes に「仮置き」と明記・例 `knowledge-hub.json:6`）。

### §4-B 板の route 構成が変わった（ver2 = 複数ルート → ver3 = 単一画面＋board_kind フィルタ）
ver2 §2.2 L108 は柱1を `/board/complaint`・`/board/improvement` の**別ルート**とし、walkId 07g/07b に対応。ver3 は `/knowledge/board` **単一画面**＋`?board=guide|complaint|improvement` クエリ（`knowledge-board.json:18-20`）＋データ側 `board_kind` enum フィルタに統合（HG-KN-03=B「walkId=画面種別・本番 /knowledge 配下」の反映）。

### §4-C 板の種別が変わった（ver2 = 愚痴/改善[+その他 未決] → ver3 = 説明/愚痴/改善）
ver2 §2.2 L112 は柱1を「愚痴+改善」に限定し、その他板（`/board/general`）は HG-KN-01 で未決。ver3 の `BOARD_KINDS = ["guide","complaint","improvement"]`（`design-c5.md:1112`）は **guide（説明）を追加・general（その他）を非掲載**（HG-KN-01=C の反映）。

### §4-D ガバナンス（二人部屋 #11）の束ね方が逆
ver2 MASTER §1.2 L58 は「裁判二人部屋（#11）は掲示板二次導線・**知の広場柱には含めない**」と明記。ver3 は K6 クラスタで **知の広場（BBS）＋ガバナンス（GOV）を同一クラスタに束ねて**実装（`design-c5.md:1005` 見出し・gov-dispute/precedent/vote/flag を同時納品）。
→ **差分の意味**: 実装の束ね方（cluster 分割）の違いであり、UI 上 gov 二人部屋は知の広場「柱」ではなく `/gov/*` route として独立している。G5 の判定対象は plaza の設計5点だが、ver3 では gov も同 doc §K6 に同居している点に留意。

### §4-E 汎用引用は ver2 で「未実装の仮スキーマ」→ ver3 で実装済
ver2 MASTER §1.3 L68・§7 は `[ihl:cite type=id]`・`cite_refs[]` を「**コードベースに未実装**の仮スキーマ」と明記。ver3 は `schemas/events/cite-ref.schema.json` を単一正本として実装し、`parseCiteTokens`/`citeUrl`（`plaza-routes.ts` 補助関数・`design-c5.md:1094`）と `tests/plaza-cite.test.ts`（4本緑）で担保（HG-KN-06=A「柱確定と同時昇格」の反映）。

### §4-F flags の admin ゲートは設計 TODO → 実装で解消済（良い差分）
`design-c5.md:1061`・批評家指摘 #5（`design-c5.md:1188-1189`）は「POST /gov/flags は protected だが admin ゲート未実装（K2 依存の TODO）＝認証済なら誰でも叩ける griefing vector」と正直開示。**実コードは既に `govRoutes.post("/gov/flags", requireRole("operator", "admin"), …)`（`gov-routes.ts:340`）で role ゲート済**。→ 開示された懸念は実装で閉じている。

### §4-G 【欠け】クロス画面 E2E スレッド spec（V3-AIP-34）は未産出
ver2 MASTER §1.4 の G4（E2E 整合）に連なる論点。ver3 design は K8 の `spec-thread.test.ts` が「知の広場スレッド spec（K6 正本）」を validate する計画だが（`design-c5.md:1500`・`:1526`）、**spec ファイル・`tests/spec-thread.test.ts` とも現時点で未存在**（`find` で確認・0件）。設計は「K6 成果物未達なら `test.skip` で明示・停止報告」と規定済（`design-c5.md:1516`）。
→ **差分の意味**: G5 の「テスト設計」は unit/投影/screendef レベルで55本緑だが、**cluster をまたぐ E2E route-matrix 検証は未着手**。これは主に **G4（E2E 整合）** の欠けであり、G5 のテスト設計点を落とすものではないが、本採用 Go の前に G4 側で解消が要る。

---

## §5 G5 では判定しない事項（本採用 Go までに残る人間ゲート）

G5 の5点が揃っても、以下は別途 human-gate。G5 判定と混同しないこと。

| 種別 | 内容 | 出典 |
|------|------|------|
| **公開の実施** | `/knowledge` の一般公開・公開解除。実装（route/screendef）は完成させるが公開スイッチは押さない | `design-c5.md:1173`・グローバル規約「人間ゲート5種」 |
| **G1 IA確定** | HG-KN-01〜08 の推奨案（§4-A）を人間が裁定・確定 or 明示 defer | ver2 MASTER §1.4 L78・§5 L259-266 |
| **G2 柱別 doc 人間 PASS** | ver2 子 doc 4本＋OSS 索引の人間レビュー | ver2 MASTER §1.4 L79 |
| **G3 RTM 閉包** | ver2 §4 の全 KN-FR-* の将来 REQ/DET/UI 先取り先が空欄なし | ver2 MASTER §1.4 L80 |
| **G4 E2E 整合** | スレッド spec（§4-G）を含む E2E doc が3柱確定案と一致 | ver2 MASTER §1.4 L81・`design-c5.md:1500` |
| **G6 C1–C4 監査** | design-impl-audit 伴走監査 PASS | ver2 MASTER §1.4 L83 |
| GOV-09 行政命令服従判断 | フラグ route/Δcount は自動化するが「その命令に従うか」の意思決定は人間（V3-AIP-31） | `design-c5.md:1175` |

---

## §6 結論（人間が裁定するための1段落）

**G5 の5点（Phase 2 詳細設計 / Phase 3 遷移 / Phase 4 UI / テスト設計 / CI）は、ver3 にいずれも該当成果物が実在し、関連する機械 GATE（validate-schemas・check-navigation・check-screendef-structure・codegen --check ×2・vitest 55/55）が全緑である**（§0 早見表・§2 file:line・§3 実測ログ）。5点の中に「欠け」は無い。したがって **G5 単独としては PASS 判定材料が揃っている**。

ただし本採用 Go には G5 だけでは足りない。**§4-A（HG-KN-01〜08 の仮置きは人間裁定が未了＝G1）** と **§4-G（クロス画面 E2E スレッド spec 未産出＝G4）** の2点が、G5 の外側のゲートに残る欠けとして明確に存在する。これらは ver3 実装の欠陥ではなく、設計上「人間裁定待ち／別クラスタ（K8）成果物依存」として正直に分離されているものである（`design-c5.md:1174`・`:1500`）。

→ **人間の裁定に委ねる問い**: 「G5（設計5点の存在と機械 GATE 緑）を PASS と認めるか」は本材料で判定可能。「本採用 Go を出すか」は G1（HG-KN 裁定）・G4（E2E spec）を含む §5 の残ゲートを併せて判断されたい。
