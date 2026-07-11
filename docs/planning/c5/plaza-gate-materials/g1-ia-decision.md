---
id: g1-ia-decision
title: 知の広場 本採用ゲート G1 — IA 確定 裁定材料
date: "2026-07-11"
status: active
---

# G1 IA 確定 — 人間裁定材料

> **このファイルの役割**: 知の広場「本採用（正式昇格）」判定 6 ゲート（`ihl-ver2/.../知の広場-仮採用-MASTER-v1.md` §1.4）のうち **G1「IA 確定」** を人間が *レビューするだけで裁定できる* 状態にする。G1 合格条件は「§5 未決事項（HG-KN-01〜08）がすべて **決定済み** または **明示 defer（ADR 番号付き）**」。
>
> **誇張ゼロ方針**: ver3 実装と ver2 仮採用資料が食い違う点は「差分」列に隠さず明記する。実装の実在は Read/Grep で確認済み・`file:line` を引用する。
>
> **裁定範囲**: 本材料が扱うのは IA（情報設計＝柱構成・ルート・ナビ）の 8 論点のみ。柱別 doc レビュー=G2 / RTM 閉包=G3 / E2E 整合=G4 / 設計ゲート=G5 / 監査=G6 は別材料。

---

## §1 結論（先に読む）

**ver3 実装は 8 論点のうち 6 点を JSON/コードとして既に体現しており、その 6 点は「確認するだけ」で決定に落ちる。** 残り 2 点（HG-KN-03 walkId・HG-KN-05 記事/ブログ）は ver3 では宙に浮いており、**明示 defer** を推奨する。

| # | 論点（1 行） | ver3 の状態 | 推奨裁定 |
|---|-------------|------------|----------|
| HG-KN-01 | その他板の柱所属 | **選択済（C=v1 非掲載）** — 実装が体現 | 確認クローズ |
| HG-KN-02 | 3 タブ vs 3 柱 | **部分体現（外側 3 柱=実装済 / 内側タブ=未実装）** | 確認クローズ（内側タブは defer） |
| HG-KN-03 | walkId→本番ルート対応 | **論点が ver3 に写像しない**（walkId 概念なし） | **明示 defer / N-A** |
| HG-KN-04 | 論文板の柱 | **選択済（A=柱2正本）** — 実装が体現 | 確認クローズ |
| HG-KN-05 | 記事/ブログ(#24)の配置 | **宣言のみ（画面は未実装・#24 は C5 スコープ外）** | **明示 defer** |
| HG-KN-06 | 汎用引用の昇格時期 | **選択済（A=柱確定と同時）** — コードで完全実装 | 確認クローズ |
| HG-KN-07 | GitHub 柱の URL | **選択済（A=/knowledge/github）** — 実装が体現 | 確認クローズ |
| HG-KN-08 | Hub 4 カード vs 3 柱カード | **選択済（B=3柱カード再設計）** — 実装が体現 | 確認クローズ |

**差し替えコストの全体像**: IA はほぼ全て *宣言的 screen-def JSON*（`screen-defs/knowledge-*.json` + `home.json`）に閉じており、裁定が推奨と違ってもコード改修は原則不要（JSON 差し替えのみ）。唯一 **HG-KN-06（汎用引用）だけは実コード+スキーマ+codegen** に落ちているため差し替えコストが高い（後述表参照）。

---

## §2 ver3 実装が体現している IA（事実記述）

MASTER §2 の「3 柱モデル」を、ver3 は次の 4 screen-def + home ボタンとして **既に出荷済み**（PROTECTED・公開スイッチ未押下）。

### 2.1 柱構成（実装された事実）

| 柱 | ver3 screen_id | route | 実装ファイル:line | 中身の事実 |
|----|---------------|-------|-------------------|-----------|
| Hub | `knowledge-hub` | `/knowledge` | `screen-defs/knowledge-hub.json:3` | 3 柱カードのみ・**タブノード不在**（`nodes` は card×3 = board/paper/github、`:19`,`:27`,`:36`）。各カード `action.kind=navigate`。 |
| 柱1 公式掲示板 | `knowledge-board` | `/knowledge/board` | `screen-defs/knowledge-board.json:3` | 3 板リンク guide/complaint/improvement（`:18`〜`:20`）＋スレ一覧 list（`source_path=/api/v1/plaza/channels/knowledge-board/threads`, `:25`）＋投稿 form（`:32`）＋「論文から引用する」link→`/knowledge/paper`（`:41`）。 |
| 柱2 論文 | `knowledge-paper` | `/knowledge/paper` | `screen-defs/knowledge-paper.json:3` | 論文 list ＋「論文照合を開く」button→`paper-match`（`:28`）。**記事/ブログのノードは無い**（後述 HG-KN-05）。 |
| 柱3 GitHub 掲示板 | `knowledge-github` | `/knowledge/github` | `screen-defs/knowledge-github.json:3` | 単一の外部 link-out（`external:true`, `:19`〜`:26`）。iframe なし・新タブ link-out 原則を体現。 |

**ホーム動線（BBS-01 ≤3 クリック）**: `home.json:73` に「知の広場を開く」button（`action=navigate to knowledge-hub`）＋ transition（`:116`）。動線は `ホーム → hub`（1）→`hub → 柱`（2）→ 柱内主操作（3）= **≤3 クリックを満たす**。

### 2.2 3 板 enum の正本（実装された事実）

`apps/api/src/plaza-constants.ts:7`:
```
export const BOARD_KINDS = ["guide", "complaint", "improvement"] as const;
```
= 愚痴/改善に「説明(guide)」を加えた **3 板**。**「論文板」も「その他板(general)」も enum に無い** → HG-KN-01/04 の選択が enum レベルで固定されている。

### 2.3 汎用引用（実装された事実・唯一コードに落ちている IA）

`apps/api/src/plaza-routes.ts`:
- `parseCiteTokens(body)`（`:66`）= `[ihl:cite type=X id=Y]` 抽出
- `mergeCiteRefs(explicit, tokens)`（`:75`）= `cite_refs[]` が正本・token 従属
- `citeUrl(ref)`（`:91`〜`:106`）= 全 10 type（observation/individual/paper/thread/post/user/tag/listing/precedent/fork）に安定 URL
- スキーマ正本 `schemas/events/cite-ref.schema.json`（envelope data ではない共用 component 型）

→ HG-KN-06「柱確定と同時に汎用引用を昇格」が **設計に留まらずコードで完了している**。

---

## §3 8 論点 裁定表（本体）

各行: **論点** / **ver2 §5 の AI 推奨** / **ver3 が既に選んでいる選択肢（事実・file:line）** / **差分（ver2 と ver3 の食い違い＝隠さず明記）** / **本材料の推奨** / **差し替えコスト（裁定が推奨と違った場合に何を変えるか・ファイル名つき）**。

---

### HG-KN-01 — その他板（`/board/general`）の柱所属

- **選択肢**: A) 柱1 に含める / B) 独立 4 柱目 / C) v1 非掲載
- **ver2 §5 推奨**: **B または C**（柱1 は愚痴+改善に限定）
- **ver3 が選んでいる選択肢**: **C（v1 非掲載）**。`design-c5.md:1174` で HG-KN-01=C と明記。体現: `plaza-constants.ts:7` の `BOARD_KINDS` に `general` 無し・`knowledge-hub.json` に第4カード無し・`general` route 無し。
- **差分**: ver2 は「B **または** C」と幅を残していた。ver3 は **C に一本化**（絞り込み判断を先取り）。→ 裁定は「C 確定でよいか」を確認するだけ。
- **推奨**: **C を確認クローズ**。3 板（説明/愚痴/改善）で v1 は必要十分。「その他」は改善サイクルの外で、v1 に載せる利用者価値が薄い。
- **差し替えコスト**: 裁定が **A/B**（その他板を出す）なら → `plaza-constants.ts:7` の `BOARD_KINDS` に `"general"` 追加（+ frozen 定数変更のため対応 TC 緑化必須）／A なら `knowledge-board.json` に板リンク1本追加／B なら `knowledge-hub.json` に第4カード＋`knowledge-general.json` 新設＋`home`/transition。**コード改修は enum 追加のみ**。

---

### HG-KN-02 — KN 3 タブ vs W2 3 柱

- **選択肢**: A) 3 タブ維持（記事/ブログ込み）/ B) 3 柱に置換 / C) ハイブリッド（外側 3 柱・内側タブ）
- **ver2 §5 推奨**: **C ハイブリッド**（柱2 内に記事/論文チップ）
- **ver3 が選んでいる選択肢**: `design-c5.md:1174` は **C（ハイブリッド）** と宣言。だが **実装は「外側 3 柱」のみ体現**し、**「内側タブ」は未実装**: `knowledge-hub.json` にタブノード不在（3 card のみ `:19/:27/:36`）・`knowledge-paper.json` に chip/tab ノード無し（`:18`〜`:32` は list＋button のみ）。
- **差分（重要）**: 宣言＝C ハイブリッドだが、**出荷物は実質 B（純 3 柱・内側タブなし）**。ハイブリッドの「内側タブ」部分は設計意図として `knowledge-paper.json:6` の notes にある（「記事/ブログもこの柱に統合」）が、UI ノードとしては存在しない。ver3 は「タブとカードの重複禁止=BBS-01」（`design-c5.md:1100`）を優先し、Hub をタブレスにしている。
- **推奨**: **「外側 3 柱」を C の第一段として確認クローズ**し、**「内側タブ（柱2 内の論文/記事/ブログ切替）」は HG-KN-05 と束ねて defer**。理由: 内側タブは記事/ブログ実装（#24・C5 スコープ外）に依存し、今それを建てても中身が無い。BBS-01 のタブレス原則とも整合。
- **差し替えコスト**: 裁定が **A（3 タブ全面）** なら → Hub をタブ構成へ再設計（`knowledge-hub.json` を card→tab に書換）＋各柱をタブ内包に変更。Renderer に tab ノード種があるかは要確認（現状 catalog は card/list/button/form/field/link/heading/text=`design-c5.md:1105`）→ **タブ採用は Renderer 拡張コストが乗る唯一の分岐**。C の内側タブ実装も同様に Renderer 依存。B 確定なら現状のまま（コスト0）。

---

### HG-KN-03 — walkId → 本番ルート対応

- **選択肢**: A) walkId=ルート / B) walkId=画面種別のみ / C) 段階的 alias
- **ver2 §5 推奨**: **B**（lab は画面種別・本番は `/knowledge` 配下）
- **ver3 が選んでいる選択肢**: **論点が ver3 に写像しない**。walkId（`07a`/`09t`/`19board` 等）は ver2 の W2 lab（`apps/ui-parts-lab-w2` port 3101）専用の識別子で、**ver3 コードベースに walkId 概念は存在しない**（`screen-defs` は `screen_id` + `route` で直接構成）。本番ルートは既に `/knowledge` 配下（`knowledge-*.json:3` の各 route）。
- **設計での仮置き**: `design-c5.md:1174` は既に **HG-KN-03=B（walkId=画面種別・本番は /knowledge 配下）** を仮置き裁定として宣言済み。→ **B の実質（本番ルート=`/knowledge` 配下）は ver3 で事実化済み**であり、残るのは「lab の walkId → 本番ルート写像表」そのものだけ。その写像表が ver3 に非該当（walkId 概念が無い）＝ **N-A**。B と N-A は矛盾せず、「B の帰結は達成・写像表だけ非該当」で一意に整合する。
- **差分（重要）**: ver2 の論点は「lab の walkId をどう本番ルートへ写すか」だが、ver3 は lab を経由せず screen_id+route を正本にした。**ver2 §5 推奨 B の帰結（本番は /knowledge 配下）は ver3 で既に事実化**しており、walkId マッピング表そのものは ver3 に不要。
- **推奨**: **明示 defer / N-A**。ADR に「HG-KN-03 は ver2 W2 lab 固有の論点であり ver3 では非該当。本番ルートは screen_id+route 正本で `/knowledge` 配下に確定済み」と記録してクローズ。
- **差し替えコスト**: なし（写像対象の walkId が ver3 に存在しない）。将来 W2 lab から walkthrough を移植する場合のみ再検討。

---

### HG-KN-04 — 論文板（`/board/paper`）の柱

- **選択肢**: A) 柱2 のみ / B) 柱1+2 両方から入口 / C) 柱1 維持
- **ver2 §5 推奨**: **A**（柱2 正本・柱1 からリンクのみ）
- **ver3 が選んでいる選択肢**: **A（柱2 正本）**。体現: `BOARD_KINDS`（`plaza-constants.ts:7`）に `paper` 無し=柱1 に論文板は存在しない。柱1→柱2 の入口は「論文から引用する」link（`knowledge-board.json:41`→`/knowledge/paper`）としてのみ存在。論文の正本画面は `knowledge-paper`（柱2）。
- **差分**: なし（ver2 推奨 A と一致）。
- **推奨**: **A を確認クローズ**。
- **差し替えコスト**: 裁定が **B/C**（柱1 にも論文板を置く）なら → `BOARD_KINDS` に `"paper"` 追加（frozen 定数＝対応 TC 緑化必須）＋`knowledge-board.json` に板リンク追加。コードは enum 追加のみ。

---

### HG-KN-05 — 記事/ブログ（#24）

- **選択肢**: A) 柱2 サブタブ / B) 独立柱 / C) Phase 2 defer
- **ver2 §5 推奨**: **A**（柱2「研究コンテンツ」に統合）
- **ver3 が選んでいる選択肢**: `design-c5.md:1174` と `knowledge-paper.json:6` notes は **A（柱2 統合）** と宣言。だが **画面は未実装**: `knowledge-paper.json` に記事/ブログの list/tab/link ノードは一切無い（`:18`〜`:32` は論文 list＋paper-match button のみ）。#24 は K6/C5 のスコープ外（対象要件 13 件は BBS/GOV のみ・`design-c5.md:1011`）。
- **差分（重要）**: **配置方針は A と宣言済みだが、実体（記事/ブログ画面）は存在しない**。「統合先＝柱2」の *約束* だけがあり、実装は空。
- **推奨**: **配置=柱2（A）を確認しつつ、実装は明示 defer**。ADR に「記事/ブログ(#24)は柱2 に配置する方針を確定。画面実装は #24 要件の波（C5 スコープ外）へ defer」と記録。HG-KN-02 の「内側タブ」と同じ波で建てるのが自然。
- **差し替えコスト**: 裁定が **B（独立柱）** なら → 第4柱として `knowledge-articles.json` 新設＋`knowledge-hub.json` に第4カード＋`home`/transition。A/C なら現状のまま（記事/ブログ実装時に `knowledge-paper.json` へノード追加）。いずれもコード改修なし（JSON のみ）。

---

### HG-KN-06 — 汎用引用の昇格タイミング

- **選択肢**: A) 柱確定と同時 / B) 実装直前 / C) Phase 2
- **ver2 §5 推奨**: **A**（柱間導線が引用に依存）
- **ver3 が選んでいる選択肢**: **A（同時）— かつ唯一コードで完全実装済み**。`schemas/events/cite-ref.schema.json`（共用型正本）＋`plaza-routes.ts` の `parseCiteTokens`(`:66`)/`mergeCiteRefs`(`:75`)/`citeUrl`(`:91`〜`:106`・全10 type)。`plaza-post.schema.json` の `cite_refs` は cite-ref への相対 `$ref` で単一正本化（`design-c5.md:1080`）。
- **差分**: なし。むしろ ver2 が「仮スキーマ・コードベース未実装」（MASTER §1.3）としていたものが **ver3 で本実装に到達**している（前進差分）。
- **推奨**: **A を確認クローズ**。既にコードが存在し TC（`plaza-cite.test.ts`）で守られている。
- **差し替えコスト（唯一の高コスト分岐）**: 裁定が **B/C（引用を後回し）** なら → `cite-ref.schema.json` 削除＋`plaza-routes.ts` の cite 3 関数除去＋`plaza-post.schema.json` の `cite_refs` $ref 除去＋`codegen-validators.mjs`/`codegen-schemas.mjs` 再生成＋`plaza-cite.test.ts` 削除。**IA 論点で唯一「JSON 差し替え」で済まない**（コード+スキーマ+codegen の巻き戻し）。ただし現状維持（A）が推奨なので通常は発生しない。

---

### HG-KN-07 — GitHub 柱の URL

- **選択肢**: A) `/knowledge/github` / B) `/board/github` / C) `19board` のみ
- **ver2 §5 推奨**: **A**（知の広場配下に統一）
- **ver3 が選んでいる選択肢**: **A（/knowledge/github）**。体現: `knowledge-github.json:3` の `route:"/knowledge/github"`。中身は正本 repo への外部 link-out（`:19`〜`:26`・`external:true`・iframe なし）。
- **差分**: なし（ver2 推奨 A と一致）。
- **推奨**: **A を確認クローズ**。
- **差し替えコスト**: 裁定が **B** なら → `knowledge-github.json:3` の route を `/board/github` に変更＋`knowledge-hub.json` カードの navigate 先は screen_id 参照なので不変。JSON 1 箇所。コード改修なし。

---

### HG-KN-08 — 07a ハブ 4 カード vs 2 カード

- **選択肢**: A) ADR-H-07 4 枚維持 / B) 柱1 は 2 枚+柱2/3 へ（Hub を 3 柱カードに再設計）
- **ver2 §5 推奨**: **B**（Hub を 3 柱カードに再設計）
- **ver3 が選んでいる選択肢**: **B（3 柱カード再設計）**。体現: `knowledge-hub.json` は 3 柱カード（board/paper/github）のみ・**タブノード不在**（`:19/:27/:36`）。ver2 の `CAL-07-HUB-03`「2×2 カード単一ナビ」は **ver3 では 3 柱 Hub に置換**されている。
- **差分**: ver2 側に「CAL-07-HUB-03（2×2 単一ナビ）を維持するか 3 柱 Hub に統合するか」（MASTER §10）という宙吊りがあったが、**ver3 は 3 柱 Hub に統合済み**で宙吊りを解消。
- **推奨**: **B を確認クローズ**。BBS-01「タブとカードの重複禁止」とも整合。
- **差し替えコスト**: 裁定が **A（4 枚ハブ維持）** なら → `knowledge-hub.json` の nodes を 4 カードに再構成（その他板カード復活=HG-KN-01 と連動）。JSON のみ。コード改修なし。

---

## §4 差分サマリ（ver2 資料と ver3 実装の食い違い・隠さず一覧）

| # | 差分の性質 | 内容 | 裁定への含意 |
|---|-----------|------|-------------|
| D-1 | 絞り込み | HG-KN-01: ver2「B または C」→ ver3「C」に一本化 | C 確認だけで済む |
| D-2 | **宣言 vs 実体** | HG-KN-02: 宣言=C ハイブリッドだが**内側タブ未実装**（実質 B） | 外側3柱を確認・内側タブは defer |
| D-3 | **論点の非該当** | HG-KN-03: ver3 に walkId 概念が無く論点が写像しない | 明示 defer / N-A |
| D-4 | **宣言 vs 実体** | HG-KN-05: 記事/ブログ「柱2統合」は宣言のみ・画面は空（#24 は C5 外） | 配置確認＋実装 defer |
| D-5 | 前進差分 | HG-KN-06: ver2「仮スキーマ・未実装」→ ver3「コード完全実装」 | A 確認（既に守られている） |
| D-6 | 宙吊り解消 | HG-KN-08: ver2 CAL-07-HUB-03(2×2) 維持問題 → ver3 が 3柱Hubに統合済 | B 確認 |

**誇張ゼロ注記**: D-2・D-4 は「設計 doc は決めたと書いてあるが、UI ノードは存在しない」ケース。G1 の合格条件は *IA の決定 or 明示 defer* であり実装完了ではないため、**配置方針を確定しつつ画面実装を defer する裁定で G1 は閉じられる**。ただし人間が「G1=実装まで含めて確定」を求める場合は D-2/D-4 が未完事項として残る点を明示しておく。

---

## §5 defer 案（ADR に落とす文面のたたき台）

裁定が推奨どおりなら、以下を ADR（新設候補 `02-設計/_横断/adr/ADR-H-3x-知の広場-IA` または ver3 側 ruling ledger）に記録すれば G1 が閉じる:

1. **HG-KN-01=C 確定** — その他板は v1 非掲載（`BOARD_KINDS` 3 板で固定）。
2. **HG-KN-02=C（第一段のみ確定）** — 外側 3 柱を採用・タブレス Hub。内側タブは HG-KN-05 と同波へ **defer**。
3. **HG-KN-03=N-A / defer** — walkId 概念は ver3 非該当。本番ルートは `/knowledge` 配下で確定済み。
4. **HG-KN-04=A 確定** — 論文は柱2 正本・柱1 からリンクのみ。
5. **HG-KN-05=A（配置のみ確定）** — 記事/ブログは柱2 配置。画面実装は #24 波へ **defer**。
6. **HG-KN-06=A 確定** — 汎用引用は柱確定と同時（コード実装済）。
7. **HG-KN-07=A 確定** — GitHub 柱 URL=`/knowledge/github`。
8. **HG-KN-08=B 確定** — Hub は 3 柱カード再設計（CAL-07-HUB-03 を置換）。

→ 8 論点すべてが **決定済み（6）または明示 defer（HG-KN-02 内側タブ・HG-KN-03・HG-KN-05 の 2〜3 項）** となり、**MASTER §1.4 G1 の合格条件「すべて決定済み or 明示 defer」を満たす**。

---

## §6 出典・確認済みファイル

- 解除条件正本: `ihl-ver2/docs/planning/w2-checkpoint/知の広場-仮採用-MASTER-v1.md` §1.4（G1〜G6）・§2（3 柱）・§5（HG-KN-01〜08）
- ver3 設計正本: `docs/planning/c5/design-c5.md` §K6（対象要件 13 件・§2.4 screen-def・§6 human-gate line 1174 の AI 仮置き裁定）
- ver3 実装（Read/Grep 実確認）:
  - `screen-defs/knowledge-hub.json` / `knowledge-board.json` / `knowledge-paper.json` / `knowledge-github.json`
  - `screen-defs/home.json:73`（知の広場ボタン）
  - `apps/api/src/plaza-constants.ts:7`（BOARD_KINDS）
  - `apps/api/src/plaza-routes.ts:62-126`（CiteRef 一式）
  - `schemas/events/cite-ref.schema.json`
- ver2 柱別 doc（G2 対象・存在確認済）: `知の広場-仮採用-01-掲示板` / `-02-論文` / `-03-GitHub掲示板` / `-04-汎用引用` / `-OSS-PRIOR-ART`（すべて `ihl-ver2/docs/planning/w2-checkpoint/` に実在）

*本材料は IA（G1）に限定。実装完了の主張はしていない — D-2/D-4 のとおり一部は「配置確定＋実装 defer」である点を明記した。*
