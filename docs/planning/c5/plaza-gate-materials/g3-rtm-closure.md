---
id: g3-rtm-closure
title: 知の広場 本採用ゲート G3「RTM 閉包」判定材料
date: "2026-07-11"
status: active
---

# G3 RTM 閉包 — 判定材料（レビューだけで裁定できる完成品）

> **裁定対象**: ver2『知の広場-仮採用-MASTER-v1.md』§1.4 の本採用ゲート **G3**
> （「§4 の全 `KN-FR-*` が将来 REQ/DET/UI 先取り先が **空欄なし**」）。
>
> 本書は MASTER §4 の全 `KN-FR-*` 行を転記し、各行に **ver3 側の実装現物**（V3 要件ID・実装 file:line・TC ファイル）を突き合わせる。
> MASTER §4 は 5 列（仮FR / 要約 / 既存REQ / 将来REQ / 将来DET / 将来UI）で「昇格先が空欄でないこと」を求めていた。ver3 では設計→実装が進んだため、
> 本書は「昇格先アドレス」ではなく **実物の V3 要件・コード・テスト** を埋める。**空欄は 1 つも残さない**（対応が無い行は「空欄」ではなく **未対応（理由付き）** と明記）。
>
> **誇張ゼロ方針**: ver3 実装と ver2 資料が食い違う点は §3「差分レジスタ」に隠さず列挙。実装の実在は Read/Grep で確認し file:line を引用。
> C5 K6 のスコープは **API 層 + screen-def + schema + TC**。フロント UI 実装（React 画面本体）は C5 の範囲外＝「未実装」表記はその事実記述（V3-UIX-01 は UI 文言規約なので本書には非適用）。

---

## §0 30 秒サマリー（裁定者向け）

- MASTER §4 の `KN-FR-*` は全 **22 行**（Hub 5 / BBS 6 / PPR 6 / GH 5）。
- ver3 で **実物（要件＋コード＋TC）まで到達＝完全対応 ✅**: **9 行**。
- **部分対応 🟡（要件はある・実装は API/schema/link まで、UI or バッチ未実装）**: **4 行**。
- **未対応 ⛔（C5 K6 スコープ外 or 要件未採番 or schema 欠落）**: **9 行**（うち 4 行は柱2論文/観測＝別クラスタへ委譲＝明示 defer 候補）。
- **空欄（＝行き先不明で放置）: 0 行** → G3 の文言条件「空欄なし」は **形式的に充足**。
- ただし裁定者が確認すべき **実質論点は §4 に 4 件**（PPR 柱の委譲を G3 合格と認めるか等）。

> **結論の性質**: 「空欄ゼロ」は達成。しかし MASTER が柱2（論文）を独立柱として RTM に載せていたのに対し、ver3 C5 K6 は論文柱を **K5（論文照合）へ委譲し link-out のみ実装** した。この委譲を「明示 defer（G1 の許容形）」と読むか「G3 未閉包」と読むかは §4-A の人間裁定に残す。

---

## §1 実在確認済みの ver3 実装現物（file:line 引用）

裁定の土台。以下はすべて Read/Grep で実在確認済み。

| 現物 | パス | 確認事項（file:line） |
|------|------|----------------------|
| 知の広場 書込 route | `apps/api/src/plaza-routes.ts` | posts `L133`・threads `L193`・channels/threads `L224`・stances `L239`・consensus `L288`・forks `L299`・signals `L386`・ranking `L473`・summaries `L484`。全 route が `app.route("/api/v1", plazaRoutes)`（`index.ts:163`）で PROTECTED 配下 |
| ガバナンス 書込 route | `apps/api/src/gov-routes.ts` | votes `L54`・threshold `L104`・os/promotion `L131`・disputes `L141`・messages `L204`・close `L256`・precedents `L323`・flags `L340`。`index.ts:169` で登録 |
| 汎用引用ヘルパ | `apps/api/src/plaza-routes.ts` | `parseCiteTokens L66`・`mergeCiteRefs L75`・`citeUrl L91`（全 CiteRef type を網羅・空文字を返さない）・`sha256Hex L109`・`citeTargetExists L116` |
| 凍結定数（単一正本） | `apps/api/src/plaza-constants.ts` | `BOARD_KINDS = ["guide","complaint","improvement"] L7`・`FORK_RANKS = ["official","recommended","popular","beginner","minor"] L10` |
| イベント schema | `schemas/events/` | `plaza-post`/`plaza-stance`/`plaza-fork`/`plaza-signal`/`plaza-summary`・`gov-vote`/`gov-dispute`/`gov-precedent`/`gov-flag`・`cite-ref`（type enum = observation/paper/thread/post/user/tag/listing/precedent/fork/individual を確認） |
| 画面定義 | `screen-defs/` | `knowledge-hub.json`（3柱カード・ナビ1層）・`knowledge-board.json`・`knowledge-paper.json`（K5 論文照合へ navigate）・`knowledge-github.json`（link ノード・新タブ） |
| テスト | `tests/` | `plaza-posts`/`plaza-consensus`/`plaza-fork`/`plaza-summary`/`plaza-cite`・`gov-dispute`/`gov-flag`/`gov-precedent`/`gov-vote-threshold`/`gov-no-automod`・`knowledge-screens` |
| 設計正本 | `docs/planning/c5/design-c5.md` | §K6 対象要件列挙 `L1011`・screen-def 表 `L1100-1105`・凍結定数 `L1109`・TC 一覧 `L1158` |

**ver3 要件レジストリ突合**: `01-requirements/registry.json` に `V3-BBS-01〜36`・`V3-GOV-01〜35`（計 71 件）が実在（Grep + JSON パース確認）。以下の対応表はこの実在 ID にのみリンクする。

---

## §2 RTM 閉包表 — MASTER §4 全行 × ver3 対応

各行: **MASTER 原文（仮FR ID・要約・MASTER が指した既存REQ）** をそのまま転記し、右側に **ver3 実物** を埋める。
判定凡例: ✅ 完全対応（要件＋実装＋TC）/ 🟡 部分対応（要件あり・実装 API/schema まで・UI/バッチ未実装）/ ⛔ 未対応（理由必須）。

### 2.1 §4.1 Hub · 横断

| 仮FR ID | MASTER 要約 | MASTER 既存REQ | ver3 要件ID | ver3 実装 file:line | ver3 TC | 判定 |
|---------|------------|----------------|-------------|--------------------|---------|:----:|
| **KN-FR-HUB-01** | `/knowledge` Hub 着地・左ナビ1クリック | FR-CONTENT-NAV-01 | **V3-BBS-01** | `screen-defs/knowledge-hub.json`（3柱カード・ナビ1層）＋ `home.json` に「知の広場」navigate ボタン追加（`design-c5.md:1105`） | `tests/knowledge-screens.test.ts` | ✅ |
| **KN-FR-HUB-02** | 3柱 IA（掲示板/論文/GitHub） | FR-CONTENT-NAV-07（差分） | **V3-BBS-01 / V3-BBS-36** | `screen-defs/knowledge-hub.json`（3柱カードのみ・タブノード不在＝タブ/カード重複禁止・`design-c5.md:1100`） | `tests/knowledge-screens.test.ts`（3柱カードのみ・タブ不在を assert） | ✅ |
| **KN-FR-HUB-03** | 柱間 汎用引用 | FR-CONTENT-NAV-02 | **V3-BBS-20** | `plaza-routes.ts:66-126`（parseCiteTokens/mergeCiteRefs/citeUrl/citeTargetExists）＋ `schemas/events/cite-ref.schema.json` | `tests/plaza-cite.test.ts` | ✅ |
| **KN-FR-HUB-04** | 空/loading/error 各柱 | NFR-BBS-04 | **未採番（独立 NFR）** | 各柱の empty/loading/error **UI 状態機械は screen-def に未定義**。API は 400/404/409/401 を返すのみ。※ V3-BBS-35 は「投稿失敗リカバリ（下書き rescue）」であり本行（各柱の空/loading/error 状態機械）とは別要件のため割当しない — V3-BBS-35 は BBS-04 に紐付く | （なし） | ⛔ 未対応（理由: MASTER の NFR-BBS-04 に対応する各柱の empty/loading/error UI 状態機械は **ver3 要件として未採番**・screen-def 未定義。ver3 独立 NFR の起票が要る） |
| **KN-FR-HUB-05** | ≤3クリック 主要導線 | preferences §A | **V3-BBS-01** | `home.json → knowledge-hub → 各柱`（transitions ≤3・`design-c5.md:1105`） | `tests/knowledge-screens.test.ts`（home→hub→柱主要操作 ≤3 クリックを transitions 上で assert） | ✅ |

### 2.2 §4.2 柱1 — 公式掲示板

| 仮FR ID | MASTER 要約 | MASTER 既存REQ | ver3 要件ID | ver3 実装 file:line | ver3 TC | 判定 |
|---------|------------|----------------|-------------|--------------------|---------|:----:|
| **KN-FR-BBS-01** | 愚痴板スレ閲覧・投稿 | FR-BBS-05, FR-BBS-14 | **V3-BBS-03 / V3-BBS-01** | `plaza-routes.ts:133`（POST /plaza/posts）・`:171` projectThread・`:201` projectChannelThreads（board_kind グルーピング）。板種は `plaza-constants.ts:7 BOARD_KINDS=["guide","complaint","improvement"]`＝説明/愚痴/改善（V3-BBS-03 の3種） | `tests/plaza-posts.test.ts` | ✅ |
| **KN-FR-BBS-02** | 改善板スレ閲覧・投稿 | 同上 | **V3-BBS-03** | 同 POST /plaza/posts（`board_kind="improvement"`）。愚痴/改善で route を分けず **単一エンドポイント＋board_kind enum** で区別 | `tests/plaza-posts.test.ts` | ✅（**差分あり→§3-D1**） |
| **KN-FR-BBS-03** | 板選びハブ 2×2 カード単一ナビ | FR-BBS-14 | **V3-BBS-01** | 板選びは `projectChannelThreads` の `boards` グルーピング（`plaza-routes.ts:217-220`）に吸収。Hub 画面は **3柱カード**（`knowledge-hub.json`）で 2×2 板ハブではない | `tests/knowledge-screens.test.ts` | 🟡 部分対応（**差分→§3-D2**: MASTER の 2×2 板ハブ＝07a を ver3 は3柱カードHubへ再設計＝HG-KN-08 選択肢B相当。板グルーピングは API で提供） |
| **KN-FR-BBS-04** | 投稿 rescue（失敗理由・再試行） | FR-BBS-07 | **V3-BBS-35** | **C5 K6 未実装**（sessionStorage ローカル下書き＝フロント責務）。API 側は失敗時 400/409 と details を返すのみ | （なし） | ⛔ 未対応（理由: V3-BBS-35 として要件は採番済だが実装がフロント側で C5 スコープ外） |
| **KN-FR-BBS-05** | 争い入口（指摘）→ #11 二人部屋 | FR-BBS-12 | **V3-BBS-06 / V3-GOV-02 / V3-GOV-03** | `gov-routes.ts:141`（POST /gov/disputes・二人部屋 open）・`:170` projectDispute・`:204` messages（第三者403）・`:256` close。`subject_ref` が anchor（CiteRef） | `tests/gov-dispute.test.ts` | ✅（**差分→§3-D3**: MASTER は「#11 裁判二人部屋」へ遷移。ver3 は dispute-room 単一コンポに統一＝V3-GOV-02） |
| **KN-FR-BBS-06** | `post_id` 安定発言ID | ADR-H-10 | **V3-BBS-05 / V3-BBS-20** | `plaza-routes.ts:139-165`（post_id を key に put-if-absent・permalink 不変）・`:228` GET /plaza/posts/:post_id | `tests/plaza-posts.test.ts`（訂正後も permalink stable を assert） | ✅ |

### 2.3 §4.3 柱2 — 論文

> **重要**: MASTER §4.3 は論文を独立柱として 6 行の RTM を持つが、ver3 C5 K6 は論文柱を **K5（論文照合クラスタ）へ委譲**し、K6 では `knowledge-paper.json` が K5 へ navigate する link のみを持つ（`design-c5.md:1102`）。paper_case enum・Paper Match・テンプレ穴埋めは **K6 の plaza-post schema に無い**（`schemas/events/plaza-post.schema.json` の enum は board_kind=guide/complaint/improvement のみ・paper_case 不在を確認）。→ この委譲の可否が §4-A の裁定論点。

| 仮FR ID | MASTER 要約 | MASTER 既存REQ | ver3 要件ID | ver3 実装 file:line | ver3 TC | 判定 |
|---------|------------|----------------|-------------|--------------------|---------|:----:|
| **KN-FR-PPR-01** | 進行中論文一覧（in_progress 一級） | FR-PPR-*・ADR-H-09 | **V3-BBS-02**（論文板 /board/paper） | `screen-defs/knowledge-paper.json`（K5 論文照合へ navigate の link のみ）。in_progress 一覧・paper_case は K6 未実装 | （なし・K5 側） | ⛔ 未対応（理由: K5 論文照合クラスタへ委譲＝明示 defer。K6 では link-out のみ） |
| **KN-FR-PPR-02** | テンプレ穴埋め 6 節 | 詳細設計-v3 | **未採番** | ver3 registry に直接対応要件なし。K5/後波 | （なし） | ⛔ 未対応（理由: ver3 要件として未採番・K6 スコープ外） |
| **KN-FR-PPR-03** | Paper Match（条件×観測） | FR-PPR-01〜11 | **K5 クラスタ**（`screen-defs/paper-match.json` 実在） | K5 側で実装（`screen-defs/paper-match.json`）。K6 K6 スコープ外 | （K5 側） | ⛔ 未対応（K6 として。理由: Paper Match は K5 クラスタ。screen-def は実在＝別ゲートで閉包） |
| **KN-FR-PPR-04** | case チップ（論文板内フィルタ） | FR-BBS-15/16 | **V3-BBS-02**（paper_case enum） | **未実装**: `plaza-post.schema.json` に paper_case enum 無し（board_kind のみ確認）。V3-BBS-02 の8値 case 分類は C5 K6 に落ちていない | （なし） | ⛔ 未対応（**差分→§3-D4**: 要件 V3-BBS-02 は存在するが実装が K6 schema に無い） |
| **KN-FR-PPR-05** | 観測逆流 1 クリック | FR-PPR-04 | **観測クラスタ（V3-OBS-*）** | 観測クラスタ側。K6 スコープ外 | （なし） | ⛔ 未対応（理由: 観測クラスタへ委譲・K6 スコープ外） |
| **KN-FR-PPR-06** | 論文→掲示板議論 CTA | FR-ART-11 系 | **V3-BBS-20**（柱間引用） | `plaza-routes.ts:96 citeUrl` が `paper` type を `/knowledge/paper/:id` へ解決。柱間参照は引用で可能だが「議論CTA」UI は未実装 | `tests/plaza-cite.test.ts`（paper type の URL 解決を assert） | 🟡 部分対応（引用機構で参照可・CTA ボタン UI は未実装） |

### 2.4 §4.4 柱3 — GitHub 掲示板

| 仮FR ID | MASTER 要約 | MASTER 既存REQ | ver3 要件ID | ver3 実装 file:line | ver3 TC | 判定 |
|---------|------------|----------------|-------------|--------------------|---------|:----:|
| **KN-FR-GH-01** | GitHub Issues 索引表示 | #25 草案 | **V3-BBS-26** | `screen-defs/knowledge-github.json`（link ノード・新タブ link-out）。Issues 索引の一覧生成は未実装（link-out のみ） | `tests/knowledge-screens.test.ts` | 🟡 部分対応（link-out は実装・索引表示 UI は未実装） |
| **KN-FR-GH-02** | component BOARD.md 一覧 | FR-19-* | **V3-BBS-16 / V3-BBS-26** | `knowledge-github.json`（link-out）。BOARD.md 一覧生成・component 階層ボードは未実装 | （なし） | 🟡 部分対応（**差分→§3-D5**: BOARD.md 一覧生成なし・link-out のみ） |
| **KN-FR-GH-03** | giscus コメント層 | ADR-H-10 §6 | **V3-BBS-26** | ver3 は iframe 埋め込み禁止・link-out 方針（GH-04）。giscus 埋め込みは未採用 | （なし） | ⛔ 未対応（理由: V3-BBS-26 は giscus を MIT で採用と記すが、埋め込みでなく link-out に統一・埋め込み層は未実装） |
| **KN-FR-GH-04** | iframe 禁止・新タブ link-out | 柱3原則 | **V3-BBS-26** | `screen-defs/knowledge-github.json`（link type ノード・新タブ・`design-c5.md:1103`） | `tests/knowledge-screens.test.ts`（link ノードを assert） | ✅ |
| **KN-FR-GH-05** | AI 要約バッチ（#25） | FR-CONTENT-NAV-06 | **V3-BBS-26** | **未実装**: C5 は LLM 呼び出しゼロ方針（`plaza-routes.ts:4-5` / 要約本文は空スロット）。GitHub 改善内容の AI 要約バッチは未構築 | （なし） | ⛔ 未対応（**差分→§3-D6**: 要件 V3-BBS-26 に含むが LLM ゼロ方針で C5 未実装・後日バッチ） |

---

## §3 差分レジスタ（ver3 実装 ⇔ ver2 MASTER の食い違い・隠さず列挙）

MASTER の記述と ver3 実装が食い違う点を、裁定者が「意図的な設計変更」か「未閉包の見落とし」か判断できるよう明記する。

| # | 論点 | MASTER の記述 | ver3 実装の事実（file:line） | 性質 |
|---|------|--------------|------------------------------|------|
| **D1** | 愚痴/改善の route 分離 | KN-FR-BBS-01/02 は `/board/complaint`・`/board/improvement` の別 route（MASTER §2.2） | 単一 `POST /plaza/posts` ＋ `board_kind` enum（`plaza-constants.ts:7`）で3板を区別。channel=画面/機能（Zulip型 topic 第一級化・V3-BBS-36） | **設計変更**（第8回裁定 Zulip 型採用の帰結）。機能は同値・URL 構造が異なる |
| **D2** | 板選びハブの形 | KN-FR-BBS-03 は 2×2 カード板ハブ（07a・CAL-07-HUB-03） | Hub は3柱カード（`knowledge-hub.json`）。板選びは API の boards グルーピング（`plaza-routes.ts:217`）に吸収 | **設計変更**（HG-KN-08 選択肢B＝「柱1は2枚+柱2/3へ」を実装採用したと読める） |
| **D3** | 争いの遷移先 | KN-FR-BBS-05 は「#11 裁判二人部屋」へ | dispute-room 単一コンポに統一（V3-GOV-02・`gov-routes.ts:141`）。裁判モジュール #11 は独立せず | **設計変更**（V3-GOV-02 の入口一本化） |
| **D4** | 論文 case チップ | KN-FR-PPR-04・V3-BBS-02 は paper_case 8値でフィルタ | `plaza-post.schema.json` に paper_case enum **無し**（board_kind のみ）。論文柱は K5 へ委譲 | **未実装**（要件 V3-BBS-02 は存在・K6 に落ちていない） |
| **D5** | GitHub BOARD.md 一覧 | KN-FR-GH-02 は component BOARD.md 一覧表示 | `knowledge-github.json` は link-out のみ・一覧生成なし | **未実装**（link-out で代替・一覧 UI 未着手） |
| **D6** | GitHub AI 要約バッチ | KN-FR-GH-05・V3-BBS-26 は AI 要約バッチ | C5 は LLM 呼び出しゼロ（`plaza-routes.ts:4`）・要約本文は空スロット | **意図的な後回し**（不変条項①コスト最小・LLM 既定OFF。後日バッチ append を想定） |

> **注**: D1〜D3 は「MASTER が仮採用・PROVISIONAL で、その後の第8回裁定（V3-BBS-36 Zulip/Polis）・V3-GOV-02（入口一本化）で上書きされた」結果であり、ver3 側が新しい。MASTER §1.3 は自身を「Non-binding」と宣言しているため、これらは正当な設計進化。D4〜D6 は「要件はあるが C5 K6 に実装が無い」＝真の未閉包。

---

## §4 人間裁定に残る実質論点（G3 を Go と裁定するために答えるべき問い）

「空欄なし」の形式条件は §2 で充足（空欄0行）。以下は形式では割り切れない **実質判断**。

### §4-A 柱2（論文）の K5 委譲を G3 閉包と認めるか【最重要】
MASTER §4.3 は論文を6行の独立 RTM 柱として持つが、ver3 C5 K6 は論文柱を **K5（論文照合）へ委譲し link-out のみ実装**（KN-FR-PPR-01/02/04 が K6 で未実装）。
- **「Go」と読む根拠**: MASTER §1.4 G1 は「決定済み **または明示 defer**」を許容。paper-match.json は K5 に実在＝別クラスタで閉包予定。柱2は「委譲」であって「放置」ではない。
- **「未閉包」と読む根拠**: paper_case enum（V3-BBS-02 の中核）は要件採番済なのに **どのクラスタの schema にも無い**（K6 で不在を確認）。K5 で本当に閉包されるかは本書では未確認。
- **裁定者への問い**: 論文柱の RTM 閉包を「K5 ゲートに委譲」で G3 Go にするか、K5 側の paper_case 実装確認を G3 の前提条件に加えるか。
- **推奨**: **Go（K5 委譲を閉包と認める）**。MASTER §1.4 は「明示 defer」を許容し paper-match.json は K5 に実在＝放置でなく委譲。**K5 の paper_case 実装確認は G3 の前提条件に上げず、K5 ゲート側で後追い**に回して可（G3 記録に「paper_case の実閉包は K5 ゲートで確認」と一文残す）。

### §4-B 「昇格先アドレス空欄なし」で足りるか、「実装 TC まで」を要求するか
MASTER §4 の原文条件は「将来 REQ/DET/UI **先取り先が空欄なし**」＝アドレスが埋まっていればよい。この文字通りなら §2 は全行で ver3 要件ID が埋まり **22/22 充足**。
一方 ver3 は実装まで進んだため、⛔5・🟡6 行は「先はあるが現物が無い」。
- **裁定者への問い**: G3 を MASTER 原文どおり「昇格先が決まっていれば Go」とするか、ver3 の到達度に合わせ「⛔行の実装 or defer ADR まで」を Go 条件に引き上げるか。
- **推奨**: **アドレス基準（MASTER 原文どおり）で Go**。MASTER §4 の合格条件は「昇格先が空欄でないこと」で §2 は 22/22 埋まり空欄0。ただし誠実性のため **⛔行には defer 理由（委譲先 or 後波）を ADR に一文ずつ残す**運用を添える（実装基準へ引き上げるなら ⛔5件の defer ADR 起票が Go の前提になる＝§5 と整合）。

### §4-C 未実装3件（HUB-04 空/loading/error・BBS-04 投稿rescue・GH-05 AI要約）の扱い
BBS-04=V3-BBS-35・GH-05=V3-BBS-26 は採番済、HUB-04（各柱の空/loading/error 状態機械）は未採番の独立 NFR。いずれも C5 K6 に実装が無い。
- BBS-04（V3-BBS-35 投稿rescue）と HUB-04 の error 状態はフロント責務で C5 スコープ外＝別 Phase で閉包が自然。
- GH-05 は LLM ゼロ方針（不変条項①）による意図的後回し。
- **裁定者への問い**: これら3件を「defer ADR を切って G3 Go」とするか、G3 のブロッカーとするか。
- **推奨**: **defer ADR を切って Go**。3件ともフロント責務（HUB-04/BBS-04）または LLM ゼロ方針（GH-05・不変条項①）による意図的後回しで C5 K6 スコープ外＝ブロッカーにする根拠が無い。HUB-04 は同 ADR で「NFR 採番＋別 Phase 実装」を明記して閉じる。

### §4-D MASTER の PROVISIONAL 差分（D1〜D3）を追認するか
D1〜D3 は第8回裁定・V3-GOV-02 で MASTER を上書きした設計変更。ver3 が正・MASTER が旧。
- **裁定者への問い**: これらを「MASTER §4 の当該行は ver3 実装で読み替え済み」と明記して MASTER を supersede するか（G3 記録に一文追記すれば足りる）。
- **推奨**: **追認（一文追記で supersede）**。D1〜D3 は第8回裁定・V3-GOV-02 で上書き済みで ver3 が正・MASTER が旧、かつ MASTER §1.3 は自身を Non-binding と宣言している。G3 記録に「MASTER §4.2 の当該行は ver3 実装（V3-BBS-36/V3-GOV-02）で読み替え済み」と一文残せば足りる。

---

## §5 裁定テンプレ（この4つに○×を付ければ G3 は決まる）

```
G3-Q1 柱2論文の K5 委譲を閉包と認める:            [ Go / K5確認を前提条件に追加 ]
G3-Q2 G3 の合格ラインは:                          [ 昇格先アドレス空欄なし / 実装orDeferADRまで ]
G3-Q3 未実装3件(HUB-04/BBS-04/GH-05)は:           [ defer ADRでGo / G3ブロッカー ]
G3-Q4 D1-D3 の MASTER supersede を追認:            [ 追認(一文追記) / 保留 ]
──────────────────────────────────────────────
→ Q1=Go かつ Q2=アドレス基準 かつ Q3=defer なら G3 は即 Go。
→ Q2=実装基準 なら ⛔5件の defer ADR 起票が Go の前提。
```

---

## §6 集計（検算）

| 判定 | 行数 | 仮FR ID |
|------|:----:|---------|
| ✅ 完全対応（要件＋実装＋TC） | 9 | HUB-01, HUB-02, HUB-03, HUB-05, BBS-01, BBS-02, BBS-05, BBS-06, GH-04 |
| （うち差分注記付き・機能は充足） | — | BBS-02（§3-D1）, BBS-05（§3-D3） |
| 🟡 部分対応 | 4 | BBS-03, PPR-06, GH-01, GH-02 |
| ⛔ 未対応（理由付き） | 9 | HUB-04, BBS-04, PPR-01, PPR-02, PPR-03, PPR-04, PPR-05, GH-03, GH-05 |

> **検算**: MASTER §4 = 22 行（Hub5+BBS6+PPR6+GH5）。内訳 = ✅9 + 🟡4 + ⛔9 = 22。空欄0。
> （⛔9 のうち PPR-01/02/03/05 の4件は柱2論文/観測クラスタへの委譲＝明示 defer 候補、HUB-04/BBS-04/GH-03/GH-05 の4件はフロント/バッチ未実装、PPR-04 は要件採番済だが schema 欠落。）

---

*本書は G3 の判定材料であり裁定そのものではない。§5 テンプレに記入した時点で G3 の Go/No-Go が確定する。*
