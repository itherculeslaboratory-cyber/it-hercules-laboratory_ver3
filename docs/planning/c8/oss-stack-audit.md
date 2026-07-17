---
id: c8-oss-stack-audit
title: OSSベース監査(V3-UIX-32) — Next.js15/shadcn/ui採用状況の実態と差分
date: "2026-07-17"
status: active
---

# OSSベース監査(V3-UIX-32)

> 要件文: 「UIはOSSベース(Next.js 15 + shadcn/ui、掲示板は5ch型テンプレ、tldraw/flexlayout-react等)を採用し、ダサく使いづらい既存civ-os UIは全面破棄してhooks/api層のみ再利用する。できるだけOSSでUI・機能をまかない、GPL/AGPL製品はUI参考に留めライセンス適合を確認する。」
> 本書は誇張ゼロで現状を機械的に棚卸しし、要件との一致/乖離を1枚にまとめる。round-16裁定は設計方向(OSS採用)を承認済みだが、個々のOSS採用・ライセンス適合はR1人間ゲート(法務)。

## 1. 実態棚卸し(検証済み・出典つき)

| 項目 | 実態 | 出典 |
|---|---|---|
| Next.js | **15.5系を実採用**(要件どおり) | `apps/web/package.json` dependencies.next=`^15.5.0` |
| React | 19系 | `apps/web/package.json` |
| Tailwind CSS | **v4を導入済みだが実質未使用**。`postcss.config.mjs`が`@tailwindcss/postcss`を通し、`globals.css`が`@import "tailwindcss";`するのみ。JSX側でTailwindユーティリティクラス(`flex`/`p-4`/`bg-blue-500`等)を使った箇所は0件(grep実測)。 | `apps/web/postcss.config.mjs`・`apps/web/src/app/globals.css`・`scripts/check-ui-tokens.mjs`(Tailwindカラーユーティリティを全面禁止する`ARBITRARY_CLASS`正規表現がCIで強制) |
| shadcn/ui | **未採用(0件)**。`components.json`なし、`@radix-ui/*`系依存なし、`npx shadcn add`の形跡なし。 | `apps/web/package.json`(dependencies/devDependenciesにshadcn/radix系皆無)・`components.json`探索0件 |
| tldraw / flexlayout-react / react-konva / Tremor | **未採用(0件)**。`package-lock.json`全文検索でも該当パッケージ0件。 | `package-lock.json` |
| 5ch型掲示板テンプレ(知の広場) | **未採用**。`knowledge-thread`/`knowledge-board`はレンダラの専用ノード型(`thread-posts`等)による自前実装。5chライクなUI/IAの直接移植なし。 | `screen-defs/knowledge-thread.json`・`apps/web/src/renderer/renderer.tsx`(`ThreadPostsNode`) |
| 実際の実装方式 | **ScreenDef(JSON)→汎用ノード語彙(app-shell/page/heading/card/table/...)を描画する自作データ駆動レンダラ**(`apps/web/src/renderer/renderer.tsx`・5,300行超)+ トークンベースCSS(`--civ-*`変数・`globals.css`+`tokens.generated.css`)。専用(一発物)ノードが7種(`clutch-intake`/`batch-roster`/`batch-summary`/`batch-done`/`search-navigator`/`growth-chart`/`individual-profile`/`thread-posts`)。 | `apps/web/src/renderer/renderer.tsx`・`docs/planning/c8/ui-asset-catalog.md`(接地事実として既記載) |
| ver2資産(W2コンポーネント群・`packages/ihl-ui-catalog`) | **本clone(ver3 repo)には存在しない**。`ui-asset-catalog.md`が引用する`MarketDetailBoardW2`等は分析専用の参照であり、このリポジトリからimportできる実コードではない(誇張ゼロ)。 | `find`で本repo内0件確認 |
| GPL/AGPL製品の混入リスク | 現状は該当OSSを1つも導入していないため**現時点でのライセンス違反リスクはゼロ**。`ui-asset-catalog.md`に除外リスト(Discourse/NodeBB/eLabFTW/Cal.com等)は策定済みで運用ルールとしては備えている。 | `docs/planning/c8/ui-asset-catalog.md`「ライセンス上／スタック上 使えない資産の除外リスト」 |
| 品質ゲート(装飾色・トークン強制) | `scripts/check-ui-tokens.mjs`+`check-contrast.mjs`が生hex/Tailwindカラークラスの使用を機械的に禁止し、`--civ-*`トークンのみ許容(CIで強制)。 | `scripts/check-ui-tokens.mjs`・`npm run lint`緑 |

## 2. 要件との一致/乖離判定

- **一致**: Next.js 15の採用、GPL/AGPL回避方針の明文化、装飾色ゼロ(トークン強制)は要件の精神(10年コスト最小・保守性)に沿う。
- **乖離**: 要件が名指しする shadcn/ui・tldraw・flexlayout-react・5ch型テンプレは**1つも採用されていない**。「ダサいciv-os UIを全面破棄」も発生していない — 逆に、C5〜C8で全画面をゼロから自作データ駆動レンダラとして再構築し、974本超のunitテスト+E2E 60/60 greenという**実働資産**を積み上げている。

## 3. 判断(推奨・断定はしない)

1. **全面破棄・OSS丸ごと入れ替えは非推奨**。理由: 現行レンダラは不変条項①(10年コスト最小)・⑤(検証済みのみ納品)を満たす実装済み・全緑の資産であり、shadcn/ui等への総取り替えは大工数かつ回帰リスクが高い割に、ユーザー可視の価値(見た目の完成度)は`ui-asset-catalog.md`が既に個別画面ごとに識別した「丸ごと採用すべきブロック」の部分適用でも到達できる。
2. **`ui-asset-catalog.md`のPath A(既存ノード語彙の組合せ)/Path B(一発物のみ専用ノード化)方針を継続するのが費用対効果最良**。市場(market-trade)・広場(knowledge-thread)は本ラン(wave-1/2)で既にこの方式でOSS発想を「薄い接着層」として取り込み済み(stepper/table/badge等の汎用語彙へ写像)。
3. **shadcn/ui個別コンポーネントの`npx shadcn add`によるつまみ食いは、汎用語彙で表現できない一発物が出た時にのみ実施**が妥当(既存7専用ノードと同格の「最終手段」の位置づけを維持)。tldraw/flexlayout-react/react-konvaはV3-UIX-82(検索グラフビュー)等、明確な個別ニーズが出た画面でのみ検証導入する。

## 4. 未確認・要フォロー

- 実際に`npx shadcn add <component>`を1つ試験導入してビルド・レンダリングを検証したことはまだない(WebSearch/コード監査のみ・実地検証は未実施)。
- Tailwind v4を今後も devDependency として維持するか、`--civ-*`トークン専用運用に振り切って依存を外すかは未裁定(現状はビルドチェーンに残るが実利用ゼロで、10年コスト最小の観点では「使っていない依存」自体が軽微な保守コスト)。
