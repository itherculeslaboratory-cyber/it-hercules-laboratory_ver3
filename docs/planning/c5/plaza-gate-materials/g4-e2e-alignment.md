---
id: g4-e2e-alignment
title: 知の広場 本採用ゲート G4「E2E 整合」判定材料（ver3 実装 × ver2 MASTER §4.5）
date: "2026-07-11"
status: active
---

# G4 E2E 整合 — 判定材料

> **人間が「レビューするだけで裁定できる」ための一次資料。** ver2 仮採用 MASTER の E2E シナリオ対応（`§4.5`）に対し、ver3 で実装済みの knowledge 4画面 + K6 API route を突き合わせ、**画面遷移列 + API 呼び出し列** の確定案を提示する。既存 TC がカバーする区間と、**実ブラウザ E2E（C6 staging で実施予定）でしか検証されない区間** を分離する。ver2 資料と ver3 実装が食い違う点は §5・§6 に **差分として明記**（隠さない）。
> 実在確認はすべて Read/Grep 実測・file:line 引用。実測不能な主張は書かない。

## §0 G4 合格条件（正本）

ver2 MASTER §1.4:

> **G4 E2E 整合** — `KN-知の広場-E2E` または後継 E2E doc が **3柱 or 3タブの確定案** と一致
> （出典: `D:/claude/systems/ihl-ver2/docs/planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md:81`）

第8回裁定で **HG-KN-02=C（外側3柱・内側タブのハイブリッド）** が確定（design-c5.md §K6 §6・:1174）。ver3 は **3柱を screendef で確定実装**し、板は柱1内の board_kind データフィルタ（＝内側タブ相当）で表現している。よって G4 は「**3柱の確定案 = ver3 knowledge 4画面**」と、その E2E パスが破綻なく通ることの確認に帰着する。

## §1 ver2 §4.5 E2E シナリオ対応（原文再掲 → ver3 マッピング）

ver2 MASTER §4.5（`知の広場-仮採用-MASTER-v1.md:243-251`）の対応表を左に、ver3 実装での実現先を右に置く。ver2 の `SC-KN-*` は ver2 側の E2E Scenario ID であり、**ver3 リポジトリには存在しない**（ver3 は Scenario doc ではなく vitest TC + screendef 構造 TC で担保 — §5-D 差分）。

| ver2 仮FR | ver2 SC（原文） | ver2 備考（原文） | ver3 実現先（実測） |
|-----------|-----------------|-------------------|---------------------|
| KN-FR-HUB-01 | SC-KN-HUB-01, 02 | 3タブ assert は柱化後に改訂要 | `knowledge-hub.json`（3柱カード）+ `knowledge-screens.test.ts:42` |
| KN-FR-BBS-01/02 | SC-KN-HUB-05, SC-07-BBS-01 | 愚痴・改善 | `knowledge-board.json` + `plaza-routes.ts` post/thread + `plaza-posts.test.ts` |
| KN-FR-PPR-04 | SC-KN-HUB-06 | 論文板 case | ver3 では柱2 = 論文照合（K5）へ navigate。**case チップは未実装**（§5-C 差分） |
| KN-FR-PPR-03 | —（SC 要追加） | Paper Match 専用 SC 要追加 | `knowledge-paper.json` → `paper-match`（K5・navigation.json:226-230） |
| KN-FR-GH-02 | —（SC 要追加） | `19board` lab SC 要追加 | ver3 では柱3 = GitHub 単一 link-out（`knowledge-github.json`）。**BOARD.md 索引は未実装**（§5-C 差分） |

## §2 ver3 E2E パス確定案（画面遷移列 + API 呼び出し列）

ver3 のナビ正本は `screen-defs/navigation.json`（有向エッジ）。API 正本は `plaza-routes.ts` / `gov-routes.ts`（全 PROTECTED・`index.ts:163,169` で `/api/v1` に mount・`index.ts:47-67` の deny-by-default が gate）。以下5本を **G4 確定 E2E パス案** とする。

### E2E-KN-01 — Hub 着地・3柱ナビ（BBS-01 / KN-FR-HUB-01,02）
- **画面遷移**: `home` → `knowledge-hub`（navigation.json:207-210）→ 3柱カード（`knowledge-hub.json:19-44`・card×3・各 `action.kind=navigate`）
- **API 呼び出し**: **なし**（hub は静的 screendef。カード click で下記各柱へ遷移）
- **遷移先確定**: pillar-board→`knowledge-board`、pillar-paper→`knowledge-paper`、pillar-github→`knowledge-github`（`knowledge-hub.json:50-54` transitions・navigation.json:211-223）

### E2E-KN-02 — 公式掲示板 スレ閲覧 + 投稿（BBS-03/05 / KN-FR-BBS-01,02）
- **画面遷移**: `home` → `knowledge-hub` → `knowledge-board`（navigation.json:211-215）
- **API 呼び出し列**:
  1. スレ一覧ロード: `GET /api/v1/plaza/channels/knowledge-board/threads` → `projectChannelThreads`（route `plaza-routes.ts:224`・fn :201）。返却 `{channel, threads[], boards{guide,complaint,improvement}}`
  2. 板フィルタ: `knowledge-board.json:18-20` の3リンク（`?board=guide|complaint|improvement`）— **画面内フィルタ（board_kind データ絞込・別画面遷移なし）**
  3. 投稿: post form（`knowledge-board.json:31-39`）→ `POST /api/v1/plaza/posts` → `appendPost`（`plaza-routes.ts:133`）。`actor_id` はセッション principal 強制刻印（:138・V3-AUT-17）
  4. スレ表示: `GET /api/v1/plaza/threads/:thread_id` → `projectThread`（route :193・fn :171・ULID 昇順 materialized view・correction 追記共存・cite 欠落 tombstone）
  5. permalink: `GET /api/v1/plaza/posts/:post_id` → readPost（:229）

### E2E-KN-03 — 賛否表明 → consensus（BBS-36 / Polis 型投影）
- **前提**: スレ内の post を statement とする（E2E-KN-02 の続き）
- **API 呼び出し列**:
  1. `POST /api/v1/plaza/stances`（`plaza-routes.ts:239`・value=agree/disagree/pass）
  2. `GET /api/v1/plaza/threads/:thread_id/consensus`（route :288）→ post_id を statement_ids に集約 → `projectConsensus`（fn :263）per-statement `{agree,disagree,pass,consensus,divisive}`
- **UI 面**: **knowledge-board screendef に stance/consensus ウィジェットは無い**（§6-A・GAP）。C5 では API のみ・画面導線なし。

### E2E-KN-04 — 論文 柱2 → 論文照合（BBS-01 / KN-FR-PPR-03）
- **画面遷移**: `home` → `knowledge-hub` → `knowledge-paper`（navigation.json:216-219）→ `paper-match`（open-match button・`knowledge-paper.json:27-34`・navigation.json:226-230）
- **API 呼び出し**: 論文リスト = `GET /api/v1/observation/search`（`knowledge-paper.json:22-26` source_path）。**⚠ この route は POST 専用**（`observation-routes.ts:403`）— §6-B 差分。paper-match 画面自体は K5 クラスタ。
- **クリック数**: home→paper-match = 3（`knowledge-screens.test.ts:62-63` が assert）

### E2E-KN-05 — GitHub 柱3 link-out（BBS-01）
- **画面遷移**: `home` → `knowledge-hub` → `knowledge-github`（navigation.json:220-223）
- **API 呼び出し**: **なし**。外部 link-out（`knowledge-github.json:18-26`・`external:true`・新タブ・`iframe 禁止` 原則に適合）
- **link 先**: 単一 repo（`https://github.com/itherculeslaboratory-cyber/it-hercules-laboratory_ver3`）

## §3 TC カバレッジ分離（既存 TC がカバー / 実ブラウザ E2E=C6 必要）

**分離の原則**: ver3 の既存 TC は **(a) API 層の投影・書込・認可**（vitest run・FakeR2Bucket）と **(b) screendef の構造・スキーマ・ナビエッジ上のクリック数**（`knowledge-screens.test.ts`）を機械検証する。**(c) Renderer が screendef を実描画し source_path を fetch → bind → form が POST → 実遷移する経路** は、いずれの TC も実行していない。(c) が **C6 staging の実ブラウザ E2E で初めて検証される区間** である。

| E2E 区間 | カバー種別 | カバー TC（file:line） | 実ブラウザ E2E（C6）で要検証 |
|----------|-----------|------------------------|------------------------------|
| API: post/thread 投影 | (a) | `plaza-posts.test.ts:24-138`（topic必須400・ULID順・correction共存・permalink不変・tombstone・チャネル分離・二重409・未認証401） | 済（API単体）→ ブラウザからの実呼び出しは未 |
| API: stance/consensus | (a) | `plaza-consensus.test.ts:29-98`（append-only・最新ULID採用・consensus/divisive算術・決定論） | 同上 |
| API: fork/rank | (a) | `plaza-fork.test.ts:38-108`（public→beginner・fork_rank昇格・表示順・minor除外・content_hash改変検知） | 同上 |
| API: summary 4層 | (a) | `plaza-summary.test.ts:17-68`（block_index・空スロット許容・4層返却） | 同上 |
| API: cite | (a) | `plaza-cite.test.ts:18-69`（cite_refs正本・token統合・citeUrl全type・sha256決定論） | 同上 |
| API: dispute 二人部屋 | (a) | `gov-dispute.test.ts:36-112`（open→message→close遷移・第三者403・TTL expired・不服申立404・未認証401） | 同上 |
| API: precedent | (a) | `gov-precedent.test.ts:27-77`（close時append・q/tag検索・cite可能・DELETEなし・title/summary必須400） | 同上 |
| API: vote/threshold/os昇格 | (a) | `gov-vote-threshold.test.ts:50-127`（adjust_to採用・base fallback・reject無視・1actor1票・os昇格判定） | 同上 |
| API: flag 論理無効化 | (a) | `gov-flag.test.ts:21-73`（append・Δcount+10・target_owner必須400・role gate 401/403 fail-closed） | 同上 |
| API: no-automod 回帰 | (a) | `gov-no-automod.test.ts:17-30`（automod endpoint 不在・NGワード表 不在の assert） | 実装物なし（思想）→ E2E 対象外 |
| screendef: hub 3柱・重複ナビ禁止 | (b) | `knowledge-screens.test.ts:42-57`（card×3・button/list/form/field/tab 不在・各 navigate・transition×3） | Renderer が実際に3カードを描画し click 遷移するか |
| screendef: ≤3クリック導線 | (b) | `knowledge-screens.test.ts:59-64`（home→hub=1・home→各柱≤3・home→paper-match≤3） | 実ブラウザでの実クリック到達 |
| screendef: 4画面 schema 妥当 | (b) | `knowledge-screens.test.ts:66-77`（screendef.schema.json draft2020-12 validate） | — |
| **Renderer 実描画 → source_path fetch → bind** | **(c) 未カバー** | **なし** | **C6 必須**（§6-A/B の bind 不整合はここでのみ露見） |
| **post form → POST → 遷移** | **(c) 未カバー** | **なし**（`renderer.test.tsx` は individuals 系のみ・knowledge screen 不使用） | **C6 必須** |
| **柱3 外部 link-out 新タブ挙動** | **(c) 未カバー** | **なし** | **C6 必須** |
| **4画面が Renderer の screen registry に登録され route 到達可能か** | **(c) 未カバー** | navigation.json にエッジは有（:207-230） | **C6 必須**（実 route 登録の実測） |

> **要旨**: **API 13 route と screendef 静的構造は機械 GATE 済み。未検証なのは「Renderer↔API の実配線」一層のみ**で、これが C6 staging の実ブラウザ E2E スコープ。§6 の bind 不整合2件はこの層に属し、現 TC では原理的に検出されない。

## §4 ver3 E2E パスと 13 要件の網羅（落ちが無いことの確認）

design-c5.md §K6 §1（:1011）の 13 要件に対し、上記 E2E パス／API がどの区間で通るか:

| 要件 | E2E 区間 | route / handler（file:line） |
|------|----------|------------------------------|
| BBS-01 | E2E-KN-01〜05（3柱ナビ・≤3クリック） | screendef 4枚 + navigation.json |
| BBS-03 | E2E-KN-02（3板 board_kind グルーピング） | `projectChannelThreads`（plaza-routes.ts:201） |
| BBS-05 | E2E-KN-02（materialized view・permalink・tombstone） | `projectThread`（:171） |
| BBS-10 | （UI 面なし・API のみ） | `appendSummary`/`projectSummary`（:484/:522） |
| BBS-20 | E2E-KN-02 の cite_refs | `mergeCiteRefs`/`citeUrl`（:75/:91） |
| BBS-29 | （UI 面なし・API のみ） | `appendFork`/`projectForkRanks`（:299/:336） |
| BBS-36 | E2E-KN-03 | `appendStance`/`projectConsensus`（:239/:263） |
| GOV-01 | （UI 面なし・API のみ・二人部屋） | `openDispute`/`projectDispute`/close（gov-routes.ts:141/:170/:256） |
| GOV-09 | （operator 明示操作・UI 面なし） | `applyFlag`（gov-routes.ts:340・role gate :340） |
| GOV-12 | （UI 面なし・API のみ） | `appendPrecedent`/`projectPrecedents`（:229/:304） |
| GOV-13 | 実装物なし（回帰 TC のみ） | `gov-no-automod.test.ts` |
| GOV-19 | （UI 面なし・API のみ） | `projectThreshold`（gov-routes.ts:83） |
| GOV-23 | （UI 面なし・API のみ） | `projectOsPromotion`/`projectRanking`（gov-routes.ts:116 / plaza-routes.ts:429） |

> **網羅上の事実**: 13 要件のうち **画面（screendef）から到達する E2E パスを持つのは BBS-01/03/05/20/36 と PPR 系のみ**。BBS-10/29・GOV-01/09/12/19/23 は **C5 では API 実装 + API-TC のみで、knowledge 4画面に UI 導線が無い**。これは design-c5.md §2.4（:1096-1107）の設計どおり（screendef は3柱+掲示板を参照実装とし、fork一覧/consensus/dispute 等の UI は Renderer 拡張の別波）だが、**「E2E 整合」を "全13要件がブラウザから通る" と読むなら未達**であり、"3柱 IA の確定案が画面+ナビで一致" と読むなら達成。この解釈選択は §7 の人間裁定に残す。

## §5 ver2 ↔ ver3 差分（隠さず明記）

### 5-A 柱1 の板構成が違う（2板 → 3板・板名も違う）
- ver2 MASTER §2.2（:108-112）: 柱1 = **愚痴 + 改善の2板**。`その他板` は defer（HG-KN-01=C・:259）。
- ver3: `BOARD_KINDS = ["guide","complaint","improvement"]`（design-c5.md:1112 / plaza-constants.ts）= **説明/愚痴/改善の3板**。
- **差分**: ver3 は ver2 に無い **「説明（guide）」板を追加**している。これは ver2 の「その他（general）板」とは別物（その他は非掲載のまま）。柱1 が2板から3板に増えた点は ver2 §2.2 の柱1 定義からの逸脱。裁定で「guide 板を正式採用するか」を確認する余地（§7）。

### 5-B 板が別 route ではなく単一画面のデータフィルタ（route 集約）
- ver2 §2.2/§6.1（:108-110,:279-282）: `/board/complaint`・`/board/improvement`・`/board/paper` の **板ごと別ルート**（walkId 07g/07b/09）。
- ver3: 単一画面 `knowledge-board`（/knowledge/board）+ `?board=guide|complaint|improvement` の **画面内データフィルタ**（`knowledge-board.json:18-20`・板は board_kind 絞込）。
- **差分**: ver2 の「板＝ルート」に対し ver3 は「板＝1画面内フィルタ」。HG-KN-03=B（walkId=画面種別・本番は /knowledge 配下・design-c5.md:1174）に整合するが、ver2 §6.1 のルート表とは1:1 対応しない。

### 5-C 柱2・柱3 のスコープが ver2 より縮小
- **柱2 論文**: ver2（§2.2:109・§4.3:226-231）は in_progress 一覧・テンプレ穴埋め（09t）・Paper Match・case チップ。ver3 `knowledge-paper.json` は **論文照合（paper-match）への navigate + 論文リスト表示のみ**。**テンプレ穴埋め・case チップ・進行中論文一覧は未実装**。
- **柱3 GitHub**: ver2（§2.2:110・§4.4:235-241）は Issues 索引・component BOARD.md 一覧・giscus。ver3 `knowledge-github.json` は **単一 repo への link-out 1本のみ**。**Issues 索引・BOARD.md 一覧・giscus は未実装**。
- **差分**: ver2 §4.5 の `KN-FR-PPR-04`（論文板 case）・`KN-FR-GH-02`（BOARD.md）に対応する ver3 UI が無い。到達性（navigate 先の存在）は満たすが、ver2 が想定した機能面は縮約。

### 5-D E2E の担保形式が違う（Scenario doc → vitest TC + 構造 TC）
- ver2 §4.5 は `SC-KN-HUB-01/02/05/06`・`SC-07-BBS-01` という **E2E Scenario ID** を参照（改訂前提）。
- ver3 には対応する `SC-*` Scenario ファイルは無い。代わりに **`plaza-*.test.ts`/`gov-*.test.ts`（API 単体）+ `knowledge-screens.test.ts`（screendef 構造）** で担保。
- **差分**: ver2 の「シナリオ台本」型 E2E doc は ver3 には未移植。本 doc（g4-e2e-alignment.md）が §2 で ver3 版シナリオを確定案として起こした最初のもの。**実ブラウザを跨ぐ Scenario は C6 staging で初実行**。

### 5-E walkId 概念の廃止
- ver2 §6（:276-321）は walkId（07a/07g/07b/09/09t/19board）↔画面↔ルートの lab マップが正本。
- ver3 は walkId を持たず、`navigation.json` の有向エッジが唯一のナビ正本。
- **差分**: ver2 lab の walkId 対応表は ver3 には引き継がれない（HG-KN-03=B の帰結）。ver2 の `19board`（コンポ掲示板）は ver3 柱3 に統合されず **link-out に置換**。

## §6 実装バグ候補（実ブラウザ E2E でのみ露見・現 TC 検出不能）

Renderer の bind 規約は「`source_path` の GET レスポンスを `data[node.id]` に格納」（`renderer.tsx:203-223`・`setNodeData` 実体 :717-718 で `data[id]=r`）、リストは `getPath(scope, bind_items)`（:492-493・getPath :114 は単純ドット辿り）。正しい bind は **`data.<node_id>.<レスポンス内フィールド>`**（正例: `device.json:24` = `data.device-list.devices`）。この規約に照らすと knowledge 2画面に不整合がある。

### 6-A knowledge-board のスレ一覧 bind がレスポンス配列に届かない
- node id = `"threads"`（`knowledge-board.json:23`）、`bind_items = "data.threads"`（:26）。
- API `projectChannelThreads` は `{channel, threads[], boards}` を返す（`plaza-routes.ts:220`）→ `data["threads"] = {channel, threads[], boards}`（**オブジェクト**）。
- `getPath(scope,"data.threads")` は **その wrapper オブジェクトを返す**（配列 `threads[]` ではない）。正しくは `"data.threads.threads"`。
- **帰結**: `items = (object) ?? []` → `items.length` は `undefined`（empty_text 分岐に入らない）→ `items.map` で **実ブラウザ描画時に TypeError（配列でない）**。スレ一覧が表示されない/クラッシュ。
- **なぜ現 TC で出ないか**: `knowledge-screens.test.ts` は schema 妥当性とクリック数のみ検証、`renderer.test.tsx` は individuals 系のみ。**Renderer×API を跨ぐ TC が存在しない**（§3(c)）。→ C6 実ブラウザ E2E での修正確認対象。

### 6-B knowledge-paper の論文リストが POST 専用 route を GET している
- `knowledge-paper.json:22-26`: `source_path = "/api/v1/observation/search"`。`useSource` は **GET で fetch**（`renderer.tsx:213`）。
- 但し `observation/search` は **POST 専用**（`observation-routes.ts:403`）。GET は route 未マッチ。
- **帰結**: 論文リスト fetch が成立せず `data.papers` 未定義 → 空リスト（`bind_items="data.papers"` は仮に応答があっても §6-A 同型で `data.papers.papers` が正）。
- **なぜ現 TC で出ないか**: 同上（§3(c) 未カバー）。→ C6 で「柱2 の論文リストをどう賄うか（専用 GET 投影を足すか、paper-match への navigate のみに割り切るか）」を実配線で確定。

> §6-A/B は **可逆な JSON/軽微修正**（bind 文字列訂正・source_path 差替）で、コード骨格に影響しない。design-c5.md §2.4（:1104「裁定確定後は JSON 差替でコード不変」）の想定内。ただし **現状の 4画面は "API は緑・画面は未描画確認" の状態**であることを誇張せず記す。

## §7 G4 判定材料まとめ（人間がレビューで裁定する形）

**達成できている（機械実測済み）**:
1. 3柱 IA が screendef で確定実装（hub 3カード・重複ナビ禁止・`knowledge-screens.test.ts:42` 緑）— HG-KN-02=C ハイブリッドの外側3柱に一致。
2. home→hub→各柱 ≤3クリック（navigation.json エッジ上・`:59` 緑）。
3. K6 の 13 要件すべてに API route 実装 + API-TC 緑（§3(a)・§4）。全 PROTECTED・actor_id 強制刻印・R2 INSERT ONLY。
4. ver2 §4.5 の各 SC 対応先が ver3 に存在（§1・柱への navigate 到達性）。

**未達／要判断（隠さない）**:
- **A. E2E の解釈**: 「3柱 IA の確定案がナビ+画面で一致」なら **達成**。「全13要件がブラウザから通る」なら **未達**（BBS-10/29・GOV-01/09/12/19/23 は UI 導線なし・§4 末尾）。**どちらを G4 合格基準とするかは人間裁定**。
- **B. Renderer×API 実配線の未検証**: §3(c) の一層が現 TC 圏外。§6-A/B の bind 不整合2件が未修正のまま。**C6 staging の実ブラウザ E2E で緑化するのが正道** — 本ゲートで「C6 で塞ぐ前提の PASS」を許すか、「4画面が実描画するまで G4 保留」かは人間裁定。
- **C. ver2 からの縮約/逸脱の受容可否**: 柱1 が3板化（§5-A）・柱2/3 縮約（§5-C）。ver2 が想定した機能面（テンプレ穴埋め・case チップ・BOARD.md 索引・giscus）は C5 未実装。**"3柱到達性で G4 十分" とするか "ver2 機能面まで要求" するか**は人間裁定。

**残る人間ゲート（design-c5.md §6・:1173 と一致）**:
- 公開の実施（/knowledge 一般公開スイッチ）。
- HG-KN-01〜08 の最終裁定（現状は推奨案を仮置き・JSON 差替でコード不変）。特に本 doc が新たに炙り出した **HG-KN-01 派生の「guide 板 正式採用可否」（§5-A）**。
- GOV-09 行政命令服従判断（V3-AIP-31）。
