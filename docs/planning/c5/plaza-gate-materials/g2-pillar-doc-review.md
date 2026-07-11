---
id: g2-pillar-doc-review
title: 知の広場 本採用ゲート G2 — 柱別 doc レビュー（ver2 主張 × ver3 実装）
date: "2026-07-11"
status: active
---

# G2 柱別 doc レビュー — 人間 PASS 判定材料

> **目的**: ver2「知の広場 仮採用」柱別 doc 4 本 + OSS-PRIOR-ART の各主張が、ver3 K6 実装（plaza / gov / research）で **どこまで実現・変更・破棄されたか** を file:line 付きで対照し、人間が G2（柱別 doc レビュー PASS）を裁定できる材料を提供する。
> **誇張ゼロ方針**: ver2 資料と ver3 実装が食い違う点は「差分」として §7 に隠さず明記する。「実現」判定は必ず Read/Grep で実在確認済みのコードにのみ付す。
> **参照正本（ver2）**: `D:/claude/systems/ihl-ver2/docs/planning/w2-checkpoint/` の `知の広場-仮採用-01〜04` + `知の広場-OSS-PRIOR-ART-v1.md` + `知の広場-仮採用-MASTER-v1.md`（§1.4 G1〜G6・§5 HG-KN-01〜08）。
> **参照正本（ver3）**: `apps/api/src/plaza-routes.ts` / `gov-routes.ts` / `plaza-constants.ts`、`schemas/events/plaza-*.json` / `gov-*.json` / `cite-ref.schema.json`、`screen-defs/knowledge-{hub,board,paper,github}.json`、設計 `docs/planning/c5/design-c5.md §K6`。

---

## §0 判定凡例と読み方

| 判定 | 意味 |
|------|------|
| **実現** | ver2 doc の主張が ver3 実装で機能として成立（コード実在・file:line 提示）。UI 表現形が変わっても機能が成立していれば実現とする。 |
| **変更** | 主張の意図は残るが、実装手段・スキーマ・URL・語彙・配置柱が ver2 の記述と異なる。§7 に差分明記。 |
| **未着手** | ver3 に対応実装が無い（Grep で不在確認）。破棄か後波かは §4/§7/§8 で区別。 |
| **別柱で実現** | ver2 が本柱の責務とした主張が、ver3 では別クラスタ（主に K5 research）で実装されている。 |

**重要な構造前提（ver3 が採った IA 裁定）**: ver3 は MASTER の 3 柱（掲示板 / 論文 / GitHub）を採用し、`design-c5.md §K6 §6`（1174 行）で HG-KN-01〜08 を全て仮置き裁定した — HG-KN-01=C（その他板 v1 非掲載）/ 02=C（外側3柱・内側タブ）/ 04=A（論文は柱2正本）/ 05=A（記事/ブログ柱2統合）/ 07=A（GitHub 柱 URL=/knowledge/github）/ 08=B（3柱カード再設計）。**これらは分母除外（人間裁定待ち）で screendef の route/カードに閉じ、JSON 差替でコード不変** と宣言されている。したがって「ver2 の 4 柱 / 4 入口が ver3 で 3 柱になった」類は**破棄ではなく裁定反映**であり、本レビューでは「変更（裁定反映）」と扱う。

> **ver2 側の内部矛盾（先に開示）**: ver2 MASTER §2.2 は 3 柱（掲示板/論文/GitHub）だが、柱1 doc §0.4（45–51 行）は **4 柱**（P1掲示板 / P2論文 / P3記事 / P4ブログ）と宣言し、GitHub 柱は柱3 doc が別に主張する。ver2 内で「柱の数と割当」が確定していない。ver3 は MASTER の 3 柱 + HG-KN-05=A（記事/ブログ→柱2統合）でこの矛盾を一意に解消した。この解消自体が G2 レビューで人間が承認すべき論点（§4-Q1）。

---

## §1 柱1 — 公式掲示板（`知の広場-仮採用-01-掲示板-v1.md`）

| doc 節 | 主張 | ver3 実装 file:line | 判定 |
|--------|------|---------------------|------|
| §REQ REQ-KN-03 / §UI-KN-02 IA-01,03,05 | ハブ=1 ナビ層・タブとカード二重禁止・スレ一覧/投稿欄を載せない・1画面1主CTA | `screen-defs/knowledge-hub.json:7-48`（3柱カードのみ・タブノード不在・各カード action=navigate） | **実現** |
| §REQ REQ-KN-01/02 | 愚痴板・改善板のスレ閲覧/投稿 | `screen-defs/knowledge-board.json:18-20`（愚痴/改善リンク）+ `plaza-routes.ts:133-166`（POST /plaza/posts）+ `:201-226`（channel別スレ一覧） | **変更** — §7-A（板構成が gripe/improve→guide/complaint/improvement） |
| §DET-KN-01 1.1 GAP: `post_id` 未発行 | 現行 board_store は post_id 未発行、本採用時に発行必須（GAP-01） | `plaza-routes.ts:139`（`postId = str(body?.post_id) || ulid()`）・キーに埋込 `:161` | **実現** — ver2 が「未発行ギャップ」と正直記録した点を ver3 が解消 |
| §REQ FR-BBS-KN-04/13・§DET-KN-04 | INSERT ONLY・DELETE/UPDATE API を作らない | `plaza-routes.ts:162`（`putEventAt`=put-if-absent）・DELETE/PATCH route 不在（TruthStore に UPDATE/DELETE メソッド不在=CL-12） | **実現** |
| §REQ FR-BBS-KN-33・§DET-KN-01 1.3 | スレ index 投影（post_count・last_activity・最終更新降順） | `plaza-routes.ts:201-221`（projectChannelThreads: post_count / latest_at 集約・board_kind グルーピング） | **実現**（ソートは thread_id 昇順 `:216`。ver2 の「最終更新降順」とは並び順が違う → §7-A′ 軽微） |
| §REQ FR-BBS-KN-40/41・§UI-KN-04.3 | スレ本文＝レス番号順投稿リスト・引用/指摘 | `plaza-routes.ts:171-190`（projectThread: ULID 昇順 materialized view・correction_of を原投稿へ追記畳込 `:179-181`） | **変更** — §7-B（レス番号 `>>N` 表示アンカーは未実装、reply_to は post_id 直参照） |
| §REQ FR-BBS-KN-44・§DET-KN-01 1.4 | `>>N` アンカー引用を本文内でリンク化・表示番号と post_id の二重管理 | 該当なし（`reply_to` は post_id 文字列 `plaza-routes.ts:154`。post_display_index 相当の連番投影は projectThread に不在） | **未着手** — §7-B |
| §REQ REQ-KN-08 FR-BBS-KN-70〜73 | 指摘→二人部屋（#11）へ委譲・`dispute_kind=board_pointer`・1発言1 open | `gov-routes.ts:141-165`（二人部屋 open・subject_ref=CiteRef `:159`）・`:204-225`（参加者2名限定 message） | **変更** — §7-C（二人部屋は実装済だが「board post から指摘して open」する UI 導線・board_pointer 種別・1発言1 open 制約は未配線） |
| §REQ REQ-KN-07 FR-BBS-KN-60〜63 | 全画面 loading/empty/error・「未実装」文言禁止 | screendef に空/error 明示ノードなし（Renderer 既定に委譲）。ver3 方針 `design-c5.md §K6 §2.4:1107`（「未実装/WIP」表記は出さない） | **変更** — §7-D（状態 UI は宣言的 screendef 外・Renderer 既定依存で個別 doc の StatePanel 4状態文案は未反映） |
| §OSS OSS-KN-01/02/03 | 5ch-browser-template（MIT）の HTML/CSS 移植・shadcn/ui blocks・IHL catalog BoardPost 再利用 | 不採用。ver3 は ScreenDef JSON + 12ノード catalog（node type enum 12種の出典＝`design-c5.md §K5:911`「node type は既存 12 種 enum のみ」宣言・実定義は `schemas/screendef/screendef.schema.json:58-71`。`§K6 §2.4:1105` は「新 node 型・新コード不要」と述べるが知の広場で使う8種のみ列挙）・`§K7 note:806` shadcn/ui 不採用→ScreenDef+civ-catalog へ置換） | **破棄（設計転換）** — §7-E（React/shadcn/5ch テンプレ前提が ScreenDef 宣言 UI に置換。ver2 OSS 節の前提スタックが丸ごと非該当） |
| §TRN-KN-04 | `/board/complaint`→`/board/gripe` alias・URL 命名裁定 | ver3 は `/knowledge/board?board={guide,complaint,improvement}`（`knowledge-board.json:18-20`）。`gripe` 語は不採用 | **変更** — §7-A（URL・語彙とも別系。HG-KN 未決だった gripe/complaint 論争は「complaint」採用で決着） |

**柱1 小括**: ver2 が正直に記録した最大ギャップ（post_id 未発行・INSERT ONLY・ハブ単一ナビ層）は **実現**。板の語彙・構成（3板が説明/愚痴/改善へ）、スレ本文の `>>N` アンカー、指摘導線の配線、OSS スタックは **変更/未着手/破棄**。ver2 が想定した React/shadcn/5ch 実装は ver3 の ScreenDef 宣言 UI に全面置換されている（§7-E は G2 で人間が明示承認すべき最大の食い違い）。

---

## §2 柱2 — 論文（`知の広場-仮採用-02-論文-v1.md`）

> ver3 は HG-KN-04=A / 05=A を採り、論文の実体（6節・Paper Match・Citation）を **K6 plaza ではなく K5 research クラスタ**に置いた。柱2 の screendef は薄い navigate。

| doc 節 | 主張 | ver3 実装 file:line | 判定 |
|--------|------|---------------------|------|
| §REQ FR-PAPER-KN-02・§DET-KN-2 PaperSectionsV1 | 6節テンプレ（目的/仮説/条件/検証/フェーズ/ギャップ）・completeness | K5: `schemas/events/content.schema.json`（paper 専用 sections 6種/completeness_pct）・`design-c5.md §K5:886` | **別柱で実現**（K5・本 screendef 外） |
| §REQ FR-PAPER-KN-06・§DET-KN-5 | Paper Match（条件×観測）・missing/violated/score | K5: `apps/api/src/paper-match.ts`（matchConditions/gapAnalysis）・route `POST /research/paper-match`（`design-c5.md §K5:853,898-900`） | **別柱で実現**（K5） |
| §UI knowledge-paper 柱2 入口 | 論文柱ハブ・照合へ導線 | `screen-defs/knowledge-paper.json:27-33`（「論文照合を開く」→ navigate paper-match） | **実現**（導線のみ） |
| §DET-KN-3 Citation append-only / FR-PAPER-KN-11 | 観測/他 Content から〔引用に追加〕で Citation append-only 生成 | ver3 の `schemas/events/citation.schema.json` は **別概念**（WIK-16/PPR-18＝データ提供の貢献報酬記録・`citation.schema.json:5-6`）。ver2 の source→target 引用 Citation（citation_kind=embed/reference）は**この形では存在せず** cite_refs[] インライン（`plaza-routes.ts:158-159`） | **変更** — §7-F |
| §REQ FR-PAPER-KN-01 in_progress 一級・「下書き語禁止」 | 進行中論文を一級表示・下書き語をUIに出さない | K5 content status enum（`design-c5.md §K5`）に in_progress 相当。knowledge-paper screendef は一覧を `/api/v1/observation/search` に bind（`knowledge-paper.json:21`） | **別柱で実現 / 要確認** — §7-G（screendef の source_path が observation/search・bind_items=data.papers は論文一覧として整合性要確認） |
| §REQ FR-PAPER-KN-09/10 BBS 議論分離 | 論文 Content と BBS スレッドを別エンティティ・6節を BBS に埋めない | plaza-post（`plaza-post.schema.json`）と content（K5）は別イベント・別スキーマ。柱2 screendef は 6節編集を持たず照合へ navigate のみ | **実現**（分離は構造上成立） |
| §OSS OSS-KN-1〜5 QuartoReview/OSF/Manubot | split-pane 編集・SchemaBlock 検証・Manubot 公開ビュー | 未採用。ver3 は screendef `paper-match.json`/`paper-detail.json`（K5・`design-c5.md §K5:913-914`）で自前表現 | **破棄（設計転換）** — §7-E と同根 |

**柱2 小括**: 論文の**substance（6節・Paper Match・条件P・claims）は K5 で実現**しており、ver2 が「W2 の最大ギャップ＝mock（進行中論文）と実装（BBS スレ一覧）の不一致」と警告した点は ver3 では構造的に解消（論文と掲示板を別イベント・別クラスタに分離）。ただし柱2 の知の広場 screendef 自体は薄く、ver2 の「進行中論文ビュー（6節+5ステップ左右ペイン）」UI は本柱 screendef には無い。Citation の意味も ver2（出典引用）と ver3（データ提供報酬）で別物（§7-F）。

---

## §3 柱3 — GitHub 掲示板（`知の広場-仮採用-03-GitHub掲示板-v1.md`）

| doc 節 | 主張 | ver3 実装 file:line | 判定 |
|--------|------|---------------------|------|
| §0.4 設計原則 2・§DET-4・§REQ FR-GH-KN-10 | iframe 禁止・link-out 優先・新タブ | `screen-defs/knowledge-github.json:18-27`（link・external:true・GitHub repo へ link-out） | **実現** |
| §REQ FR-GH-KN-03・§UI-3 | 機能別板インデックス（feature:NN ラベル・open_issue_count・`GET /github-board/features`） | 該当 route・screendef 不在（Grep: `feature:` は docs/registry のみ・apps/api に実装なし） | **未着手** — §7-H |
| §REQ FR-GH-KN-20〜24・§DET-3.3 | GitHub Issues の LLM 3〜5行要約バッチ・R2 `ihl/board/github_summary/`・`/board/improvement?source=github` | 不在。ver3 の `github-webhook-routes.ts` は KRM-13 貢献ポイント算入用で #25 要約板ではない（`design-c5.md §K7:482,515`）。giscus/要約バッチ Grep 一致は docs のみ | **未着手** — §7-H |
| §REQ FR-GH-KN-30〜34・§UI-4 | giscus whitelist 埋込・utterances 不採用 | giscus 実装不在（Grep: apps/api/apps/web に giscus なし・docs/registry のみ） | **未着手** — §7-H |
| §REQ FR-GH-KN-40/41・§DET-1 | `docs/components/{id}/BOARD.md` Decision ログ・`GET /component-board` 索引 | ver3 に BOARD.md 索引 API 不在（Grep: `BOARD.md` は docs のみ） | **未着手** — §7-H |
| §DET-1 層1 自前 BBS（改善板と GitHub 要約の並列表現・source チップ） | 3層ハイブリッド（自前 BBS / GitHub / 可視化）・source=github チップ | 自前 BBS（柱1 plaza）は実現。GitHub 可視化層・source チップは未着手 | **部分（自前 BBS のみ）** |
| 「改善履歴とフォークを追う」意図 | GitHub 上の改善履歴を製品内から辿る | `knowledge-github.json:16-27`（link-out で改善履歴へ）+ fork 概念は `plaza-routes.ts:299-373`（plaza-fork）で製品内に別途存在 | **変更** — §7-H（GitHub 固有の可視化を捨て、単一 link-out + 製品内 fork に縮約） |

**柱3 小括**: ver3 は柱3 を **「GitHub repo への単一 link-out カード」1 枚に縮約**した。ver2 が設計した機能別板 index・#25 AI 要約バッチ・giscus・BOARD.md 索引は **すべて未着手**。設計原則（iframe 禁止・link-out 優先・PAT server-only）だけが思想として残る。これは §4-Q3 の最重要裁定点（柱3 を v1 で link-out のみに割り切るか、ver2 の可視化層まで求めるか）。

---

## §4-doc 柱4 — 汎用引用（`知の広場-仮採用-04-汎用引用-v1.md`）

| doc 節 | 主張 | ver3 実装 file:line | 判定 |
|--------|------|---------------------|------|
| §DET-01 CiteRef union type | 引用先を指す構造化 union 型（単一正本） | `schemas/events/cite-ref.schema.json:8-41`（type+id+label?+post_id?・単一正本・相対 $ref 参照） | **変更** — §7-I（type enum が ver2 と不一致） |
| §REQ FR-CITE-03・§UI BoardPost.onQuote | 本文と別に機械可読 cite_refs[]・token は従属 | `plaza-routes.ts:66-88`（parseCiteTokens/mergeCiteRefs＝cite_refs 正本・token 従属）・`:158-159`（post に格納） | **実現** |
| §REQ FR-CITE-11・§DET-06 cite token | `[ihl:cite type=id]` を本文許可・レンダラ展開 | `plaza-routes.ts:66-72`（正規表現 `\[ihl:cite\s+type=([a-z]+)\s+id=([^\]\s]+)\]` 抽出） | **実現**（抽出まで・mini-card レンダラは screendef 側未実装）／**ただし柱4 doc のトークン構文とは非互換→§7-M** |
| §REQ FR-CITE-01・§TRN-01 permalink | 各 type の安定 URL・INSERT ONLY ID 紐付け | `plaza-routes.ts:91-106`（citeUrl 全 type 分岐・空文字返さず） | **変更** — §7-J（URL パターンが ver2 permalink 表と不一致・post は thread_id を含まない） |
| §REQ FR-CITE-09・§DET-04 tombstone | 引用先 hidden/deleted/moderated を tombstone・reason enum（5値） | `plaza-routes.ts:116-126`（citeTargetExists）・`:183-188`（projectThread が tombstone 積む・reason="target_missing"） | **変更** — §7-K（post/fork のみ実在検証・外部 type は常に true `:125`。reason は単一値のみ・ver2 の 5 reason enum 未実装） |
| §REQ FR-CITE-10・§DET-05 Preview API | `GET /api/v1/cite/preview`（hover mini-card・self-hosted） | **不在**（Grep: apps/api/src に `/cite`・preview route なし） | **未着手** — §7-L |
| §DET-04 Citation INSERT 規則 | 共有 `ihl/research/citation/`・source_type/target_type/citation_kind の append-only イベント | ver3 に該当イベントなし。`citation.schema.json` は別概念（データ提供報酬 WIK-16）。cite は post インライン | **変更/未着手** — §7-F |
| §分離原則 SEP-01/02 | @mention（通知）と cite（出典）を別チャネル・#hashtag と tag cite を別 | `plaza-routes.ts:156-159`（mentions[]=@通知・tags[]=#検索・cite_refs[]=出典を**別フィールド**で保持） | **実現** |
| §分離原則 SEP-03 | `>>N`（表示専用）と post_id（permalink 正本）を分離 | ver3 は post_id を permalink 正本に使う（`citeUrl :98`）が `>>N` 表示アンカー自体を実装しない（§7-B） | **部分**（post_id 正本は実現・>>N 側が不在） |

**柱4 小括**: 汎用引用の**中核（cite_refs 正本・token 従属・citeUrl 全 type・@/#/cite の 3 チャネル分離）は実現**。ただし ver2 が厚く設計した **Preview API は未着手**、**Citation append-only イベント（出典グラフ）は別概念に置換**、**tombstone は post/fork のみで外部 type 未検証**、**type enum と permalink URL が ver2 表と不一致**。cite は「投稿に埋める最小形」で成立し、ver2 の「独立した引用グラフ層」までは実装していない。

---

## §5 OSS-PRIOR-ART（`知の広場-OSS-PRIOR-ART-v1.md`）

| doc の推奨 | ver3 実装状況 | 判定 |
|-----------|--------------|------|
| tiptap（リッチ composer）・shadcn/ui・react-markdown・remark + `remark-ihl-cite` | いずれも未導入。ver3 は ScreenDef JSON + 12ノード catalog（12種の出典＝`design-c5.md §K5:911`・実定義 `schemas/screendef/screendef.schema.json:58-71`。§K6:1105 は8種のみ列挙）・cite token は正規表現抽出（`plaza-routes.ts:66-72`）で remark 非依存 | **破棄（設計転換）** |
| Discourse/Flarum（スレッド UX・quote ブロック・link-out ブリッジ） | 未採用。掲示板は plaza 自前・`design-c5.md §K7 note:806`（掲示板 5ch 型テンプレ等の OSS 実導入は「知の広場 PROTECTED クラスタ」でライセンス実適合は人手レビュー＝**本 C5 で未実施**） | **未着手（ライセンス実適合レビューが人間ゲート）** |
| giscus（MIT・Discussions 連動コメント whitelist） | 未導入（§3 柱3 と同じ） | **未着手** |
| Manubot / QuartoReview / OSF SchemaBlock（論文） | 未採用（§2 柱2 と同じ） | **破棄（設計転換）** |
| self-hosted preview（iframely/oEmbed 不採用） | preview API 自体が未着手（§7-L）。ただし「外部依存を持たない」方針は ver3 の LLM/外部 OFF 既定と整合 | **方針一致・実装未着手** |
| remark-github の `@`/`#` を IHL cite に流用しない | ver3 は `@`=mentions[]・`#`=tags[]・cite=cite_refs[] を別フィールドで分離（`plaza-routes.ts:156-159`）＝doc の「流用しない」指針に合致 | **実現（思想一致）** |

**OSS 小括**: OSS-PRIOR-ART が前提とした **npm OSS スタック（tiptap/shadcn/remark/Discourse/giscus/Manubot）は ver3 で一つも導入されていない**。ver3 は「新規 npm 依存ゼロ・ScreenDef 宣言 UI・LLM/外部 OFF」を選び、OSS 調査の**結論（分離思想・self-hosted・GPL 回避）だけを継承**して実装スタックは総取り替えした。`design-c5.md §K7:806` は「掲示板 5ch 型テンプレ/tldraw 等の OSS 実導入とその license-scan は知の広場 PROTECTED クラスタ・ライセンス実適合は設計レビュー人手」と明記＝**OSS 実導入は本波の対象外で人間レビュー待ち**であることを ver3 自身が正直に開示している。

---

## §6 ver2 柱 doc に基盤を持たない ver3 追加（開示のため明記）

以下は **ver2 柱別 doc に対応主張が無い** が ver3 K6 が実装した機能。出典は第8回裁定（V3-BBS-36）と registry（BBS-29/GOV-19/23）であり、柱 doc レビューの対象外だが「実装が doc を超えている」点を誇張ゼロで開示する。

| ver3 追加 | 実装 file:line | ver2 柱 doc 上の扱い |
|-----------|----------------|----------------------|
| Zulip 型 channel+必須 topic / Polis 型 stance→consensus/divisive | `plaza-routes.ts:239-294`（stance/projectConsensus）・`plaza-constants.ts:13-22`（STANCE_VALUES/閾値） | 柱1 doc は 5ch 型スレッドのみ。合意可視化(Polis)は **doc 外**（第8回裁定 V3-BBS-36 で採用確定） |
| Fork ランク5段投影 / 全 fork 非削除共存 | `plaza-routes.ts:299-373`（fork/reduceForkRank/projectForkRanks） | 柱 doc 外（BBS-29・フォーク文化＝憲法由来） |
| 自然淘汰ランキング / OS 昇格 | `plaza-routes.ts:429-477`・`gov-routes.ts:116-135`（projectRanking/projectOsPromotion） | 柱 doc 外（GOV-23） |
| 要約 4層（post emb/block emb/current_summary/diff・LLM 空スロット） | `plaza-routes.ts:484-549`（summaries/projectSummary・EMBEDDING_REF `:36`） | 柱1 doc に要約層なし（BBS-10・K5 WIK distill と接続） |
| 二人部屋・判例・不使用フラグ・閾値投票（governance） | `gov-routes.ts` 全体（dispute/precedent/flag/vote） | 柱1 doc は「#11 へ委譲」とのみ記述。二人部屋実体は ver3 が K6 内に実装 |

---

## §7 差分ハイライト（隠さない食い違い一覧）

- **§7-A 板の語彙・構成が別物**: ver2 柱1 = `gripe`/`improve`（+ 論文/その他は別柱・4入口 ADR-H-07）。ver3 = `guide`/`complaint`/`improvement`（`plaza-constants.ts:7`）。**「説明（guide）板」は ver2 柱 doc に存在しない ver3 新設**、「その他板」は HG-KN-01=C で非掲載、`gripe`→`complaint` に語彙変更。裁定反映だが「guide 板の新設」は doc に根拠が無い純増分。**さらに ver2 内部で board_kind 語彙が不整合**: 柱1 doc は `board_kind = gripe/improve`（`知の広場-仮採用-01-掲示板-v1.md:168`）だが、柱4 doc は `board_kind = complaint/improvement/paper/general`（`知の広場-仮採用-04-汎用引用-v1.md:244`）と別語彙で enum を切る。**ver3 はこの不整合を柱4 側（complaint/improvement）を採用して解消し、`improvement` へ統一・`guide` を新設**した（`plaza-constants.ts:7`）＝ver3 の語彙は柱4 doc 系列の正規化。
- **§7-A′ スレ並び順**: ver2 は「最終更新降順」、ver3 projectChannelThreads は thread_id 昇順（`plaza-routes.ts:216`）。UI 上の新着性が出ない軽微差。
- **§7-B `>>N` アンカー未実装**: ver2（柱1 FR-BBS-KN-44・柱4 SEP-03）が明記した表示専用連番 `>>N` と post_display_index 投影が無い。ver3 は reply_to=post_id 直参照のみ（`plaza-routes.ts:154`）。
- **§7-C 指摘導線の未配線**: 二人部屋（gov-dispute）は実装済だが、board post から `board_pointer` 種別で指摘 open する導線・「1発言1 open」制約が未配線。subject_ref は汎用 CiteRef（`gov-routes.ts:159`）。
- **§7-D 状態 UI**: ver2 の StatePanel 4状態（loading/empty/error 文案）は宣言的 screendef に個別ノードとして無く Renderer 既定依存。「未実装文言を出さない」思想のみ継承（`design-c5.md §K6 §2.4:1107`）。
- **§7-E OSS スタック総取替（最重要）**: ver2 柱1/柱2/OSS-PRIOR-ART が前提した React + shadcn/ui + tiptap + 5ch-browser-template + remark + Discourse/giscus/Manubot は **ver3 で一つも導入されていない**。ver3 は ScreenDef JSON + civ-catalog + 正規表現 cite で「新規 npm 依存ゼロ」を選択（`design-c5.md §K6 §2.4:1105`・`§K7:806`）。doc の OSS 節は結論（思想）のみ生存、実装前提は全滅。
- **§7-F Citation の意味が別物**: ver2 柱2/柱4 の Citation = 出典引用イベント（source→target・citation_kind=embed/reference・`ihl/research/citation/`）。ver3 `citation.schema.json` = データ提供の貢献報酬記録（WIK-16/PPR-18・grantPlatinum 連動・`citation.schema.json:5-6`）。**同名・別概念**。ver2 の出典引用は cite_refs[] インライン（`plaza-routes.ts:158-159`）に縮約され、独立イベント化されていない。
- **§7-G 論文一覧 bind の要確認**: `knowledge-paper.json:21` は論文一覧を `/api/v1/observation/search`・bind_items=`data.papers` に束ねる。観測検索エンドポイントが論文一覧を返すのか、暫定 stub なのか G2 で要確認（screendef の実データ整合）。
- **§7-H 柱3 の大幅縮約**: feature 別板 index・#25 AI 要約バッチ・giscus・BOARD.md 索引はすべて未着手。ver3 柱3 = GitHub repo への単一 link-out（`knowledge-github.json:18-27`）。
- **§7-I CiteRef type enum 不一致**: ver2 = observation/individual/cross/content/post/thread/user/tag/template/market_listing/tombstone。ver3（`cite-ref.schema.json:13-24`）= observation/individual/paper/thread/post/user/tag/listing/precedent/fork。**ver3 は cross/content/template/market_listing/tombstone を落とし、paper/listing/precedent/fork を追加**。tombstone は type ではなく投影時の付帯情報に変更。
- **§7-J permalink URL 不一致**: ver2 post permalink = `/board/{board_kind}/{thread_id}#post-{post_id}`。ver3 citeUrl post = `/knowledge/board/p/{id}`（`plaza-routes.ts:98`・thread_id を含まない）。全 type で URL 基底が `/knowledge/*` 系に移動。
- **§7-K tombstone 検証範囲**: ver3 の実在検証は post/fork のみ（`plaza-routes.ts:116-126`）。外部 type（observation/paper/user/tag/listing/precedent/individual/thread）は常に存在扱い（`:125` return true）＝これらの引用先が消えても tombstone 化されない。reason も `"target_missing"` 単一（ver2 の 5値 enum 未実装）。
- **§7-L Preview API 未着手**: ver2 が厚く設計した `GET /cite/preview`（self-hosted mini-card）は ver3 に無い（Grep 不在）。cite の hover プレビュー機能は未実装。
- **§7-M cite token 構文の非互換**: 柱4 doc の実トークン文法は **`[ihl:cite <type>=<id>]` の key=value 形式**（`知の広場-仮採用-04-汎用引用-v1.md:441` の正規表現 `\[ihl:cite\s+([a-z_]+)=([^\s\]]+)…\]`・例 `[ihl:cite observation=cap-abc]`/`[ihl:cite user=…]`/`[ihl:cite content=cnt-001 content_type=paper]` :448-452）。ver3 は **`[ihl:cite type=X id=Y]` の固定 `type=`/`id=` 二フィールド形式**（`plaza-routes.ts:68`）で、**トークン文法レベルで非互換**（ver2 柱4 の `observation=cap-abc` は ver3 パーサでは抽出されない）。※ ver2 MASTER §5.5:340 は逆に `[ihl:cite type=<kind> id=<uuid>]` と ver3 同形で書いており、**ver2 内部でも柱4 doc と MASTER でトークン文法が食い違う**。ver3 は MASTER 側の `type=/id=` 形を採用。FR-CITE-11 の「実現」は ver3 文法での抽出成立を指し、柱4 doc の key=value 例をそのまま流し込む後方互換は無い。

---

## §8 人間 PASS 判定に必要な残論点（G2 ゲート）

> G2 の合格条件は MASTER §1.4「子 doc 4 本 + OSS 索引が人間 PASS」。以下は PASS 前に人間が明示裁定すべき論点。可逆（JSON/後波）か不可逆かを併記。

- **Q1（IA 確定・G1 と連動）**: ver2 の柱数矛盾（MASTER=3柱 vs 柱1 doc=4柱）を ver3 は 3柱+HG-KN-05=A で解消した。この **3柱確定と記事/ブログの柱2統合を承認するか**。→ 可逆（screendef JSON 差替・`design-c5.md §K6 §6:1174`）。
- **Q2（柱1 板構成）**: ver2 に無い **「説明（guide）板」の新設**と `gripe→complaint` 語彙変更、「その他板」非掲載を承認するか。→ 可逆（`plaza-constants.ts:7` 定数）。ただし BOARD_KINDS は schema enum の正本なので既存 Truth データがあると後方互換に影響。
- **Q3（柱3 スコープ・最重要）**: 柱3 を **v1 は GitHub link-out 1枚に割り切る**（ver3 現状）か、ver2 設計の可視化層（feature 板 index・#25 要約バッチ・giscus・BOARD.md 索引）まで G2 の合格要件に含めるか。含めるなら **柱3 は現状 PASS 不可**（§7-H）。→ スコープ裁定。
- **Q4（汎用引用の深さ）**: cite を **投稿インライン最小形で PASS とする**か、ver2 の Preview API（§7-L）・独立 Citation グラフ（§7-F）・外部 type tombstone（§7-K）・type/permalink 整合（§7-I/J）まで求めるか。→ スコープ裁定。求めるなら柱4 は部分 PASS。
- **Q5（OSS 実導入とライセンス実適合）**: ver3 は OSS スタックを全て置換し、`design-c5.md §K7:806` が「掲示板/tldraw 等 OSS 実導入の license-scan は知の広場 PROTECTED クラスタ・人手レビュー」と defer 宣言。**OSS を導入しない ScreenDef 路線を承認するか**、ver2 OSS 索引が要求する tiptap/giscus 等の実導入と GPL/AGPL 適合判定を G2 要件に残すか。→ 設計方針 + ライセンス人手レビュー（人間ゲート）。
- **Q6（Polis/fork/要約/governance の doc 逆昇格）**: ver3 実装は柱 doc を超えて Polis 合意・fork ランク・要約4層・二人部屋/判例/フラグを持つ（§6）。これらは第8回裁定・registry 由来で正当だが、**ver2 柱 doc 側に対応記述が無い**＝doc と実装の網羅性が逆転している。G2 で「doc を実装に追随させて更新する」か「実装済として承認のみ」か。→ 文書運用裁定（可逆）。
- **Q7（screendef データ整合の実測）**: `knowledge-paper.json` の論文一覧 bind（§7-G）と、柱1 の状態 UI（§7-D）が実 API/Renderer で意図通り描画されるかは静的 Read では未確定。G2 PASS には **screendef の実描画 1 回の目視**が要る（可逆・確認作業）。
- **Q8（GOV-09 フラグの濫用面）**: 直接 G2（柱 doc）ではないが柱1 の指摘/governance に隣接。`gov-routes.ts:340` で `requireRole("operator","admin")` は配線済（`design-c5.md §K6 批評家#5:1188` の「認証済なら誰でも叩ける」懸念は解消済）。柱 doc レビュー上は追加裁定不要だが、指摘導線（§7-C）を柱1 に配線する波で再確認。

---

## §9 G2 総合所見（機械可読サマリ）

```yaml
g2_review:
  date: "2026-07-11"
  scope: [pillar-01-board, pillar-02-paper, pillar-03-github, pillar-04-cite, oss-prior-art]
  method: read-grep-fileline-verified
  verdict_by_pillar:
    pillar-01-board:
      core_realized: [hub-single-nav, post_id-issued, insert-only, thread-projection]
      changed: [board-kinds-vocab, thread-sort, dispute-wiring]
      not_implemented: [display-anchor-N, state-panel-4states]
      discarded_stack: [react, shadcn, 5ch-template]  # §7-E
    pillar-02-paper:
      realized_in_cluster: K5   # 6-sections / paper-match / conditions / claims
      thin_in_k6: knowledge-paper.json  # navigate only
      changed: [citation-semantics]     # §7-F
      needs_check: [paper-list-bind]    # §7-G
    pillar-03-github:
      realized: [iframe-forbidden, link-out]
      not_implemented: [feature-board-index, ai-summary-batch, giscus, board-md-index]  # §7-H
      verdict: heavily-reduced
    pillar-04-cite:
      realized: [cite_refs-canonical, token-subordinate, citeUrl-all-types, mention-tag-cite-separation]
      changed: [type-enum, permalink-url, tombstone-scope]  # §7-I/J/K
      not_implemented: [preview-api, independent-citation-graph]  # §7-L/F
    oss-prior-art:
      stack_adopted: none   # tiptap/shadcn/remark/discourse/giscus/manubot all absent
      thesis_inherited: [channel-separation, self-hosted, gpl-avoidance]
      license_scan: deferred-human-review   # design-c5 §K7:806
  ver3_beyond_doc: [zulip-topic, polis-consensus, fork-ranks, os-promotion, summary-4layer, dispute-precedent-flag]
  open_points_for_human:
    reversible: [Q1, Q2, Q6, Q7]
    scope_ruling: [Q3, Q4]
    design-plus-license-gate: [Q5]
    adjacent: [Q8]
  blocking_for_pass_if_ver2_scope_required: [pillar-03-github, pillar-04-cite-depth]
```

---

*G2 柱別 doc レビュー · 2026-07-11 · 実装実在は Read/Grep で file:line 確認済 · 誇張ゼロ（食い違いは §7 に全開示）· 参照 REPORT-ver3-phase-c5-2026-07-11*
