---
id: RES-UI-SKILLS-2026-07-10
title: UI/UXスキル資料調査 — ver3への採用蒸留
date: "2026-07-10"
status: active
---

# UI/UX スキル資料調査(2026-07-10)

対象: ユーザー指定の13資料。ver3 の確定UI要件(V3-UIX-16/17/18/32/55/67/75/76)との整合で採用/不採用を蒸留する。
本文中の「事実」は資料の記載内容、「提案」は本調査の提言。

## ① 調査した資料一覧(取得可否)

| # | 資料 | 取得 | 備考 |
|---|------|------|------|
| 1 | anthropics/claude-code `frontend-design` SKILL.md | 成功 | raw 経由 |
| 2 | shadcn-ui/ui `skills/shadcn` SKILL.md | 成功 | raw 経由 |
| 3 | bergside/awesome-design-skills | 成功 | 索引67 skill。うち minimal / clean / spacious / sleek の4本を精読 |
| 4 | nextlevelbuilder/ui-ux-pro-max-skill | 成功 | README |
| 5 | greensock/gsap-skills | 成功 | README(8 skill 構成) |
| 6 | skills.sh leonxlnx/taste-skill `minimalist-ui` | 成功 | WebFetch 要約経由 |
| 7 | skills.sh leonxlnx/taste-skill `industrial-brutalist-ui` | 成功 | 同上 |
| 8 | skills.sh code-yeongyu/oh-my-opencode `frontend-ui-ux` | 成功 | 同上 |
| 9 | skills.sh github/awesome-copilot `premium-frontend-ui` | 成功 | 同上 |
| 10 | ceorkm/mobile-app-ui-design | 成功 | README |
| 11 | ameyalambat128/swiftui-skills | 成功 | 内容確認の上、無関係と判定(③) |
| 12 | hamen/material-3-skill | 成功 | raw README(main)は404 → GitHub ページ経由で取得 |
| 13 | expo/skills `plugins/expo/skills` | 成功 | 22 skill の索引 |

完全な取得失敗: なし。注記: #6-9 は skills.sh ページを要約モデル経由で読んだため、原文の全文引用ではない。#3 は67本中4本のみ精読(残りはスタイル名から ver3 テーマ固定と無関係と判断)。

## ② ver3 要件と整合する原則の蒸留(採用推奨)

### 2-1. semantic token 強制(shadcn / awesome-design-skills 共通)→ ThemePack(V3-UIX-16)
- 事実: shadcn skill は「`bg-primary` 等の semantic token のみ・`bg-blue-500` 等の raw 値禁止」「theming は単一のグローバル CSS ファイルのみ(新規 CSS ファイル作成禁止)」を明文ルール化。awesome-design-skills 4本も全て「semantic tokens over raw values」。
- 採用先: ThemePack の `--civ-*` トークン運用規約にそのまま採用。**ScreenDef → Renderer が受け付ける className はトークン系のみ、raw hex/任意色クラスは機械 GATE で拒否**(生成物 lint に raw color 検出を追加)。これが「1箇所変更→全画面伝播」(V3-UIX-16)と「誰が編集しても壊れない」(V3-UIX-76)の実装的裏付けになる。

### 2-2. コンポーネント state 規約の具体列挙(awesome-design-skills / ui-ux-pro-max)→ Renderer(V3-UIX-18)
- 事実: spacious skill は「default / hover / focus-visible / active / disabled / loading / error を必ず定義」、共通で「WCAG 2.2 AA・keyboard-first・visible focus・reduced-motion 対応・44px+ タッチターゲット」。ui-ux-pro-max は「hover/focus/レスポンシブの pre-delivery checklist」「motion 150–300ms + prefers-reduced-motion」。
- 採用先: V3-UIX-18 の「全コンポーネントに state+className props を規約統一」の **state を上記7種に確定**し、C2 Renderer の受け入れ基準(TC)にする。44px+ タップターゲットは V3-UIX-55「大きなタップターゲット」の数値化。

### 2-3. shadcn 合成優先 + registry フロー(shadcn)→ 部品カタログ / UIBuilder(V3-UIX-32/67)
- 事実: shadcn skill は「新規UIを書く前に registry を search せよ」「既存コンポーネントの合成 > 自作」「フォームは Field 合成 + `data-invalid`/`aria-invalid`」を強制。
- 採用先: V3-UIX-32(OSSでまかなう)・V3-UIX-75(操作性にオリジナリティ不要)と完全一致。C2 の Renderer 部品カタログは shadcn 合成を第一選択にし、ScreenDef の form node 規約に `data-invalid`/`aria-invalid` を組み込む。将来の UIBuilder L1/L2 の部品配布は shadcn registry 方式(search→add→fork)が V3-UIX-76 の fork 文化のそのまま雛形になる(提案)。

### 2-4. タイポ・スペーシング上限(mobile-app-ui-design / awesome-design-skills)→ ThemePack
- 事実: mobile-app-ui-design は「タイポは最大4サイズ・2ウェイト」「8pt グリッド(4の倍数)」「主要アクションは画面下1/3(親指ゾーン)」。minimal skill は spacing 「4/8/12/16/24/32」。
- 採用先: ver3 の weight 300/400(2ウェイト)と偶然一致しており、design_token.yaml に「type scale ≤4サイズ・weight 300/400 固定・spacing 4/8/12/16/24/32」を上限規約として明記する(提案)。親指ゾーンは飼育現場のモバイル利用と親和し、ScreenDef のレイアウトテンプレ規約候補。

### 2-5. UXコピー規約 + 品質フロア(frontend-design)→ 「小学生でも迷わない」(V3-UIX-75)
- 事実: Anthropic frontend-design skill は「コピーは能動態・平易語・フロー全体で動詞名を一貫(Publish→Published)」「空状態・エラーは次の行動を指示する(曖昧・謝罪調禁止)」「品質フロア: モバイル対応・キーボードフォーカス可視・reduced motion 尊重を黙って満たす」。
- 採用先: ScreenDef の label / error 文言規約として文書化し、V3-UIX-75 の判定基準に使う。品質フロア3点は C2 Renderer の共通実装(全画面に自動適用)へ。
- 注意(事実): 同 skill は「near-black + acid-green アクセント」を AI 生成っぽく見える頻出クラスタとして挙げる。ver3 の #0D0D0D + mint green は要件確定済みなので変更しないが、差別化はタイポ(細字)と余白で作るという同 skill の指針が有効。

### 2-6. AI 作業規約(oh-my-opencode frontend-ui-ux)→ 運用
- 事実: 「実装前に既存パターン・規約・履歴を調べよ」「既存コードに溶け込め」「スコープを広げるな」。
- 採用先: ScreenDef/部品を AI が生成する際の作業規約として、ver3 の AGENTS.md 系規約と同種。skill 化(④)に含める。

## ③ 採用しないもの + 理由

| 資料 | 判定 | 理由 |
|------|------|------|
| swiftui-skills | 不採用(無関係) | SwiftUI/iOS ネイティブ専用・macOS+Xcode 前提。ver3 は Next.js 15 の web(V3-UIX-32)。予想どおり関係なし。 |
| expo/skills | 不採用 | React Native/Expo ネイティブ開発用。ver3 にネイティブアプリ計画なし。将来モバイルネイティブを検討する時のみ再訪。 |
| material-3-skill | 不採用 | Material You の動的カラー・elevation(影)・tonal palette は ver3 固定テーマ(影なし・角丸12px・黒基調・ThemePack SSOT)と正面衝突。しかも web 実装(@material/web)はメンテナンスモードと自認。予想どおり衝突。 |
| taste-skill industrial-brutalist-ui | 不採用 | 90度角のみ・高密度・スキャンライン等の演出は「角丸12px・シンプル・小学生でも迷わない」(V3-UIX-55/75)と衝突。 |
| taste-skill minimalist-ui | ほぼ不採用 | 「Inter 禁止・角丸コンテナ禁止・warm bone 背景」が ver3 の Inter 指定・角丸12px・黒基調と正面衝突。「motion は fade+hover のみ」「1px ボーダー統一」の2点のみ参考値として ThemePack 検討時に見る価値あり。 |
| premium-frontend-ui | 不採用 | 「4つのビジュアルアイデンティティから選ぶ」構造が主で、ver3 はテーマ確定済みのため選択フェーズが存在しない。 |
| gsap-skills | 不採用(条件付き) | 内容は良質だが新規依存。ver3 のモーションは CSS transition 150–300ms + prefers-reduced-motion で足りる(不変条項① 10年コスト最小)。将来 UIBuilder L1 で高度アニメ部品が実需になった時のみ導入検討。 |
| awesome-design-skills の残り63本 | 不採用 | glassmorphism/neon/retro 等スタイル注入系。ver3 はテーマ固定でスタイル選択をしない。 |
| ui-ux-pro-max の style/palette 生成部 | 不採用 | 67スタイル・161パレットの提案エンジンは同上の理由で不要。チェックリスト部分のみ採用(②-2)。 |

## ④ 実装への落とし込み提案(C2 Renderer / 将来 UIBuilder)

以下は全て提案(未実施)。

1. **C2 Renderer 受け入れ基準の具体化**: state 7種(default/hover/focus-visible/active/disabled/loading/error)+ `aria-invalid`/`data-invalid` + visible focus + prefers-reduced-motion + 44px+ タップターゲットを、Renderer 共通層の TC として起票。V3-UIX-18 の「state props 規約統一」がこれで数え上げ可能になる。
2. **design_token.yaml に上限規約を明記**: type scale ≤4サイズ / weight 300・400 のみ / spacing 4/8/12/16/24/32 / radius 12px 単一 / shadow 禁止 / motion 150–300ms。トークンは全て `--civ-*` 経由。
3. **機械 GATE に raw color / 任意クラス検出を追加**: ScreenDef JSON と生成 TSX 内の raw hex・`bg-blue-500` 型クラスを lint で拒否。ThemePack 一括伝播(V3-UIX-16)と fork 安全性(V3-UIX-76)の機械的担保。
4. **repo 内に ver3 UI skill を置く(運用提案)**: awesome-design-skills のフォーマット(機械可読トークン + do/don't + anti-patterns)を借り、ver3 確定テーマを `SKILL.md` 化して repo に置く(例: `.claude/skills/ver3-ui/`)。AI が ScreenDef・部品を生成する際に常時参照させる。shadcn 公式 skill は upstream をそのまま導入してよい(自作不要)。②-6 の作業規約も同 skill に含める。
5. **UIBuilder(将来)の部品配布は registry 方式**: shadcn の search→add→fork フローを L1/L2 部品カタログの UI モデルとして踏襲。fork された UI も ThemePack トークン whitelist + ScreenDef schema バリデーションを通過したものだけ描画する(壊れない保証)。
6. **UX コピー規約の文書化**: 能動態・平易語・動詞一貫・エラーは次の行動を指示。ScreenDef の label/error フィールドのレビュー規約として docs へ 1 ページ。
7. **モーションは CSS で一元**: GSAP 等の導入は見送り。Renderer 共通 wrapper で transition と reduced-motion を一括適用し、個別画面にモーション実装を書かせない。
