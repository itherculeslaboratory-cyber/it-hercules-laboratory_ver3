---
source: "docs/planning/ver3/b2/research-external-knowledge-v1.md@4a56cf6"
id: research-external-knowledge-v1
title: 外部知見回収 — anthropics/life-sciences と Chase AI(@Chase-H-AI)、および Anthropic 公式 agent 設計知見
date: 2026-07-10
status: draft
decision: anthropics/life-sciences の marketplace + Skill/MCP 構造を「科学OS」の設計テンプレとして採用参照し、Chase AI の Agentic OS 三層(ドメイン→タスク→スキル)+ Karpathy raw/wiki/output ボールト構造を Claude HQ(V3-AIP-97)の思想的参照とする。ただし Chase AI 側に公開 repo は存在せず(有料コミュニティ限定)、転用はパターン抽出に限る。
sources_count: 12
revalidate_before_impl: true
---

# 外部知見回収レポート — anthropics/life-sciences / Chase AI / Anthropic agent 設計知見

調査日: 2026-07-10 / 担当: ver3 Phase B2 deep-research / 読者: 将来の AI と開発者

---

## 1. 結論(選定)

**anthropics/life-sciences は実在する公式 repo であり、Claude Code の marketplace + Skill/MCP プラグイン構造を「科学OS」(AI査読6段・Living Paper・観測→論文パイプライン)の設計テンプレとしてそのまま参照採用する。** 具体的には (a) `marketplace.json` を中心にプラグインを外部ホストへ分離する構造、(b) `scientific-problem-selection` Skill(Fischbach & Walsh, Cell 2024 のフレームワークを SKILL.md 化した研究問題選定ワークフロー)、(c) `pubmed`/`biorxiv`/`consensus`/`open-targets` 等の文献 MCP 群 — の3点が ver3 の論文OS に直接転用できる。一方 **Chase AI(@Chase-H-AI)には公開の Agentic OS repo は存在しない**(GitHub アカウント `chaseingai` の公開 repo 5本はいずれもフォーク中心で Agentic OS 実装ではなく、本体は有料コミュニティ「Chase AI+」限定)。したがって Chase AI からは「ドメイン→タスク→スキル→自動化」の三層分解と Karpathy 由来の `raw/wiki/output` ボールト構造という**思想パターンのみ**を Claude HQ(V3-AIP-97)・夜間運転(V3-AIP-96)の参照として採用する。加えて Anthropic 公式の agent 設計3文書(Claude Code ベストプラクティス / building effective agents / multi-agent research system)を V3-AIP 系(司令塔+批評家、5不変条項⑤批評家ゲート)の設計裏付けとする。

---

## 2. 根拠

### 根拠1 — anthropics/life-sciences は実在。marketplace.json 中心・プラグイン外部分離の構造
GitHub 上の `anthropics/life-sciences` は「Claude for Life Sciences Launch 用の Claude Code Marketplace」であり、README 自身が「`marketplace.json` を長期ホストするが実 MCP サーバコードはここには置かない(外部ホスト)」と明言している。ディレクトリは MCP サーバ用フォルダ群(`.claude-plugin` config 付き: pubmed / biorxiv / consensus / open-targets / chembl / clinical-trials 等)と Skill フォルダ群(`single-cell-rna-qc` / `nextflow-development` / `scvi-tools` / `instrument-data-to-allotrope` / `scientific-problem-selection`)、`.github/workflows` から成る。
→ ver3「科学OS」の実装配線モデルとして、正本(marketplace.json = 目録)と実体(プラグイン)を分離する構造は **append-only 目録 + 使用時発行**(V3-FND-32 の「使われた瞬間だけ発行」)と整合する。
出典: https://github.com/anthropics/life-sciences (アクセス 2026-07-10)

### 根拠2 — `scientific-problem-selection` Skill = 研究問題選定を SKILL.md 化した実物パターン
同 repo の `scientific-problem-selection` Skill は Fischbach & Walsh の方法論(Cell, 2024)に基づき、プロジェクト構想・リスク評価・行き詰まりのトラブルシュート・戦略的科学計画を Claude に実行させる。これは「観測データを持つブリーダーを研究者にする」(ver3 論文OS の存在理由)という要望に対し、**研究の入口(何を問うべきか)を AI ワークフロー化した先行実例**である。SKILL.md 一枚で査読前段の思考を配線している点が、ver3 の AI査読6段(V3-PPR-05: 決定論5段+LLM1段)の「段0=問題設定」レイヤーの雛形になる。
出典: https://github.com/anthropics/life-sciences (アクセス 2026-07-10)

### 根拠3 — 文献 MCP 群が Living Paper の「世界接続層」に直結
`pubmed`(生物医学文献検索・認証不要)、`biorxiv`(プレプリント)、`consensus`(2億+査読論文の evidence 合成)、`open-targets`(標的・遺伝学プラットフォーム)、`chembl`(化合物・生物活性 DB, EBI)が MCP として提供され、多くが無認証または無料アカウントで使える。これは ver3「科学OS の世界接続層」(V3-PPR-13: Wikidata 正規ID + 内部Index + 専門APIマッピング)の**専門APIマッピング**部分の実在参照実装であり、ヘラクレスオオカブト観測では GBIF/NCBI 等への同型マッピングに置き換え可能。
出典: https://github.com/anthropics/life-sciences (アクセス 2026-07-10)

### 根拠4 — Chase AI の Agentic OS 三層 + Karpathy ボールト構造(公開 repo なし・思想のみ)
Chase AI 公式ブログ「How to Build a Claude Code Agentic OS (3 Steps)」は、(1) 人生/事業を 5〜10 の**ドメイン**に分割、(2) 各ドメインの反復**タスク**を列挙(「2回以上やるならスキルにせよ」)、(3) タスクを**スキル**化し、手動トリガ or ローカル(cron)/リモートの**自動化**に分類する三層を説く。記憶層は Obsidian ボールトで、Karpathy テンプレの `raw`(初期キャプチャ)/`wiki`(整形済み参照)/`output`(完成物)構造を採り、ボールト直下の `CLAUDE.md` が「そのディレクトリ内の全プロンプトに付加される」。観測性ダッシュボードはスキルをクリック可能ボタンにラップした Web UI。
**ただし記事内に公開 GitHub repo リンクは一切なく、本体は有料「Chase AI+」コミュニティ限定。** GitHub `chaseingai` の公開 repo(mcp-client-chatbot / openai-chatkit-starter-app / claude-desktop-fedora / square-ui 等)はフォーク中心で Agentic OS 実装ではない。したがって転用は**パターン抽出に限定**する。
→ ver3 では Claude HQ(V3-AIP-97: `D:\claude` を本拠地とする階層)と夜間タスク(V3-AIP-96: 台本生成・wiki生成・資料メタ化・改善ループ)に、この三層分解と raw/wiki/output + ディレクトリ別 CLAUDE.md の考えが直接効く。本 repo は既に `docs/knowledge/` を wiki 層、`docs/planning/` を作業層として持ち、CLAUDE.md 階層運用も実施済みで、Chase AI パターンと構造が一致している。
出典: https://www.chaseai.io/blog/build-claude-code-agentic-os-3-steps (アクセス 2026-07-10) / https://github.com/chaseingai (アクセス 2026-07-10)

### 根拠5 — Anthropic 公式「Claude Code ベストプラクティス」= 司令塔+批評家+検証ループの一次資料
公式ドキュメント(現行 URL は https://code.claude.com/docs/en/best-practices、旧 anthropic.com からリダイレクト)は、(a) CLAUDE.md は簡潔に・肥大は指示無視を招く、(b) explore→plan→code→commit の分離(plan mode)、(c) **検証を Claude 自身が回せる形で与える**(テスト/ビルド/スクリーンショット差分/Stop hook/`/goal` gate)、(d) **Writer/Reviewer パターンと adversarial review subagent**(diff だけを見る新鮮コンテキストの批評家に通す)、(e) headless `claude -p` + fan-out で並列自動化、を説く。
→ (c)(d) は ver3 の5不変条項⑤「検証されないものは納品されない=批評家ゲート」の一次的裏付け。本 repo の `.claude/verify.cmd` PostToolUse フックはまさに (c) の実装であり、Writer/Reviewer は司令塔(Fable)+実装(Sonnet)+批評家の分業(グローバル運用規約)に一致する。
出典: https://code.claude.com/docs/en/best-practices (アクセス 2026-07-10)

### 根拠6 — Anthropic「Building effective agents」= workflow/agent 区別と「まず単純に」原則
公式記事は workflow(定義済みコードパスで LLM/tool を配線)と agent(LLM が自らプロセスを動的制御)を区別し、prompt chaining / routing / parallelization / orchestrator-workers / evaluator-optimizer の5パターンを整理。核心の助言は「単純なプロンプトから始め、単純解が不足したときだけ複雑化せよ。フレームワークは抽象層を増やしロジックを隠す」。
→ ver3 の5不変条項①「10年コスト最小・決定論優先・モデル最小化」に直結。AI査読6段の段1〜5を**決定論コード**(workflow)、段6のみ LLM(V3-PPR-05)という設計は、まさにこの workflow/agent 区別の正しい適用例であることが公式知見で裏付けられる。
出典: https://www.anthropic.com/engineering/building-effective-agents (アクセス 2026-07-10)

### 根拠7 — Anthropic「How we built our multi-agent research system」= 司令塔+批評家のトークン経済と評価法
2025-06-13 の公式記事。orchestrator-worker(lead agent が分解し subagent を並列 spawn)で単一 agent 比 +90.2%(内部評価)だが**トークンは約15倍**。教訓: (a) lead は委譲を詳細指示(目的・出力形式・ツール指針・境界)、(b) 複雑度に応じ agent 数をスケール、(c) 評価は ~20 ケースの LLM-as-judge(事実性・引用正確性・網羅性・出典品質・ツール効率)+人手、(d) agent は stateful で**チェックポイント再開**、(e) full production tracing。
→ ver3 の司令塔+批評家体制(V3-AIP 系)と夜間運転(V3-AIP-96)に直結。特に**15倍のトークン経済は不変条項①コスト最小と真っ向から衝突する警告**であり、V3-AIP-96 の「1夜あたりコスト上限・自動停止必須」設計要件の外部エビデンスになる。LLM-as-judge は批評家ゲート(条項⑤)の評価設計の雛形。
出典: https://www.anthropic.com/engineering/multi-agent-research-system (アクセス 2026-07-10)

---

## 3. 比較した代替案と却下理由

| 代替案 | 却下/限定採用理由 |
|--------|------------------|
| Chase AI の実装 repo をそのまま fork | **公開 repo が存在しない**(有料コミュニティ限定)。パターン抽出に限定せざるを得ない。存在しないものを存在すると書かない。 |
| `chaseingai` の公開 repo を Agentic OS 参照として採用 | 実体はフォーク中心(mcp-client-chatbot 等)で Agentic OS 実装ではない。ver3 転用価値は低い。 |
| コミュニティ製 Obsidian+Claude repo(AgriciDaniel/claude-obsidian, spencermarx/obsidian-ai)を採用 | 検索で存在は確認したが未 WebFetch 検証・保守主体不明。本 repo は既に自前の wiki/planning 構造を持ち、外部依存を増やすのは不変条項①に反する。将来 Stage R 評価候補として保留。 |
| life-sciences の MCP をそのまま本番導入 | 生物医学特化(pubmed/chembl 等)でヘラクレス観測には直接使えない。**構造テンプレ**として参照し、GBIF/NCBI 等へ置換する方針が正しい。 |
| multi-agent(15倍トークン)を夜間運転に全面採用 | コスト最小(①)と衝突。単一 agent + 決定論 workflow を基本とし、multi-agent は高価値タスク限定 + コスト上限で導入する(公式記事の助言に従う)。 |

---

## 4. ver3 要件との接続

| 知見 | 効く V3 要件 | 効き方 |
|------|-------------|--------|
| life-sciences marketplace.json 分離構造 | V3-FND-32 / V3-PPR-13 | 目録(append-only)と実体分離、使用時発行の設計テンプレ |
| scientific-problem-selection Skill | V3-PPR-05(AI査読6段) | 査読前段「問題設定」レイヤーの SKILL.md 雛形 |
| 文献 MCP 群(pubmed/consensus/open-targets) | V3-PPR-13(世界接続層) | 専門APIマッピングの実在参照 → GBIF/NCBI へ置換 |
| Living Paper 該当 | V3-PPR-14 | 構造化 JSON 論文 + 再現性メタの設計参照 |
| Chase AI 三層 + raw/wiki/output | V3-AIP-97(Claude HQ)/ V3-AIP-96(夜間) | ワークスペース階層とディレクトリ別 CLAUDE.md の思想 |
| Claude Code ベストプラクティス(検証ループ/Reviewer) | 不変条項⑤批評家ゲート / V3-AIP 系 | verify.cmd フック・Writer/Reviewer 分業の一次裏付け |
| Building effective agents(決定論優先) | 不変条項① / V3-PPR-05 | 段1-5 決定論・段6のみ LLM の正当化 |
| multi-agent(15倍トークン・LLM-as-judge) | 不変条項① / V3-AIP-96 / 条項⑤ | 夜間コスト上限・自動停止の根拠、批評家評価設計の雛形 |

**5不変条項への適合**: ①コスト最小=決定論優先/15倍トークン警告→コスト上限設計に反映。②fork文化=marketplace プラグイン構造は fork/差替え前提で整合。③append-only=marketplace.json 目録は追記型と整合。④人間ゲート=Chase AI ダッシュボードの「クリックで発火」は人間トリガ、夜間運転は分割点で人間 OK/NG。⑤批評家ゲート=Writer/Reviewer・adversarial subagent・LLM-as-judge が直接の設計素材。

---

## 5. リスクと再検証条項

- **2026-07 時点の情報**。GitHub repo 内容(life-sciences のプラグイン一覧・Skill 名)は変動しうる。実装着手時に `anthropics/life-sciences` を再 clone し `marketplace.json` と各 SKILL.md を直接読むこと(本レポートは WebFetch 経由の要約であり、ファイル逐語ではない)。
- Chase AI の三層/ボールト構造はブログ記事の要約に基づく。有料コミュニティの実装詳細は未検証。思想参照に留め、実装は本 repo 既存の wiki/planning 構造を正とする。
- Anthropic 公式ドキュメント URL は anthropic.com → code.claude.com へ移行済み(308)。将来さらに移動しうるので実装時に再確認。
- multi-agent の「+90.2%」「15倍」は Anthropic 内部評価値であり ver3 の観測ドメインで再現する保証はない。夜間運転の PoC で自前計測すること。

**実装着手前 再検証チェックリスト**:
1. life-sciences の marketplace.json 実ファイルを clone して構造確認
2. scientific-problem-selection の SKILL.md 逐語を読み、査読段0 の雛形として写経可否判断
3. Chase AI の最新公開情報に repo が出ていないか再検索(有料化解除の可能性)
4. multi-agent トークン15倍を前提に V3-AIP-96 のコスト上限を数値決定

---

## 6. 未解決の問い

- life-sciences の MCP プラグインは MCPB(ローカル)/リモートいずれの認証モデルか、ヘラクレス観測で使う GBIF/NCBI マッピングにどの型が最適か(要 marketplace.json 逐語確認)。
- Chase AI の観測性ダッシュボード(スキル=クリックボタン化)を ver3 の朝レビューかんばん(V3-AIP-96)にどう写像するか — 本 repo は GitHub 一本化(AIP-37)方針だが、ダッシュボードは別レイヤーとして要るか。
- 夜間 multi-agent 運転の「1夜あたりコスト上限」の具体数値(15倍トークンを踏まえた円/夜)は誰がどう決めるか(人間ゲート案件)。
- scientific-problem-selection の Fischbach & Walsh 方法論は昆虫観測ドメインに転用可能か、それとも独自の「問い選定」フレームが要るか。

---

## 追補(2026-07-10 第3回裁定 Q1 対応): anthropics org コンテンツ生成資産の調査

調査日: 2026-07-10。対象: ユーザー指定3リポジトリ + anthropics org 全体スイープ。V3-VID 系(動画・台本・記事、特に V3-VID-01/07/28 とツイン二体発信 V3-VID-10)および V3-AIP 系への転用可否を判定。

### 追-1. anthropics/life-sciences(既調査の差分)

差分なし。org 一覧(2026-07-10 時点)でも説明は「Repo for Claude Code Marketplace, hosts marketplace.json」のままで、コンテンツ生成(台本・記事・動画)に関わる新資産は確認されない。本文根拠1〜3の評価(marketplace 分離構造・Skill/MCP テンプレとして科学OS に参照)を維持。
出典: https://github.com/anthropics/life-sciences / https://github.com/orgs/anthropics/repositories (アクセス 2026-07-10)

### 追-2. anthropics/knowledge-work-plugins — 実在。台本・記事側の最有力参照

実在(公式、22.5k stars)。「Plugins that turn Claude into a specialist for your role, team, and company. Built for Claude Cowork, also compatible with Claude Code」。役割別プラグイン約19本(marketing / product-management / customer-support / design / engineering / legal / finance / sales / bio-research / small-business 等)。各プラグインは `plugin.json` + `.mcp.json`(コネクタ)+ `commands/`(明示発火のスラッシュコマンド)+ `skills/`(自動発火のドメイン知識)という4点構造で、**コードなし・Markdown+JSON のみ・ビルド不要**。

最重要は **marketing プラグイン**。skills は `content-creation`(チャネル別ライティング作法・SEO・見出し公式・CTA)/ `brand-voice`(ボイス属性・トーン適応・スタイルガイド強制・用語管理)/ `campaign-planning` / `competitive-analysis` / `performance-analytics` の5本、commands は `/draft-content`(ブログ・SNS・メール・LP・プレスリリース・ケーススタディの下書き)/ `/brand-review`(ブランドボイス照合レビュー)/ `/campaign-plan` / `/seo-audit` / `/email-sequence` 等。
→ **V3-VID-01(台本)/ V3-VID-07(記事)への直接転用**: `content-creation` の「コンテンツ種別テンプレ+チャネル別作法」を SKILL.md として写経し、チャネルを YouTube 台本/note 記事/X スレッドに置換すれば ver3 のコンテンツ生成スキルの雛形になる。**V3-VID-10(ツイン二体)へは `brand-voice` が効く**: 二体それぞれの「ボイス属性・トーン・用語集」を brand-voice 型 SKILL.md 2枚として定義し、`/brand-review` 相当で人格ブレを機械チェックする方式が、ユーザー裁定「方式は AI 委任」の下での最小実装候補。動画そのものの生成資産は**なし**(正直な限界)。
出典: https://github.com/anthropics/knowledge-work-plugins (アクセス 2026-07-10)

### 追-3. anthropics/financial-services — 実在。ドメインは使えないが「編成」の実装参照として最重要

実在(公式、33.3k stars)。金融ワークフロー向けの reference agents + skills + データコネクタ。ドメインスキル群(comps/DCF/LBO/CIM/earnings note 等 50本超)は**昆虫観測・動画には使えない**。ただし構造が3点転用できる:
1. **`plugins/agent-plugins/`(名前付きワークフローagent)と `plugins/vertical-plugins/`(スキル束)の二層分離** — 「agent = 完結ワークフロー」「vertical = スキル+コネクタ束」の分け方は、ver3 で「夜間台本生成 agent」(V3-AIP-96)と「コンテンツスキル束」(V3-VID 系)を分離する設計テンプレ。
2. **`managed-agent-cookbooks/` の agent.yaml + `callable_agents`(leaf-worker subagent、preview)+ `scripts/orchestrate.py`(handoff_request イベントを agent 間ルーティングするイベントループ)** — Anthropic 公式の**マルチエージェント編成の実装コード実例**。本文根拠7(multi-agent 記事)は思想のみだったが、こちらは配線の実物。V3-AIP 系(司令塔+批評家)の実装時に逐語参照する価値がある。
3. **`pptx-author` / `xlsx-author`(Managed Agent モードの headless 文書生成)** — 「人が見やすい成果物を headless で吐く」パターンで、記事・資料の自動生成(V3-VID-07/28)の配線と同型。
出典: https://github.com/anthropics/financial-services (アクセス 2026-07-10)

### 追-4. anthropics org スイープ — その他の転用候補と「動画は無い」という結論

org 公開リポジトリ(約30本、2026-07-10 時点)から関連を抽出:

| repo | 内容 | ver3 転用判定 |
|------|------|--------------|
| **anthropics/skills**(160k stars) | 公式 Agent Skills 集。`docx`/`pptx`/`xlsx`/`pdf`(本番文書生成の source-available 実装)、`brand-guidelines`、`doc-coauthoring`、`internal-comms`、`theme-factory`、`canvas-design`、`web-artifacts-builder`、`slack-gif-creator`、`skill-creator`、`frontend-design`、`algorithmic-art`、`mcp-builder`、`webapp-testing` + `spec/`(Skill 仕様)+ `template/` | **採用参照**。`skill-creator` と `template/` は ver3 独自スキル(台本・記事)を書く際の公式雛形。`brand-guidelines` はツイン人格定義(V3-VID-10)の第2参照。`doc-coauthoring`/`internal-comms` は記事生成(V3-VID-07)の文章作法参照。`pptx`/`docx` は資料生成(V3-VID-28)の本番級実装 |
| claude-plugins-official(31.9k stars) | 公式プラグイン目録(`/plugins` + `/external_plugins`)。今回の fetch ではカタログ全容は取得できず | 目録として存在確認のみ。実装時に `/plugin > Discover` で content 系を再探索(再検証条項) |
| launch-your-agent(768 stars) | 「アイデア→本番 Claude Managed Agent」までの founder 向けスキル集 | V3-AIP 系の Managed Agent 化を検討する場合の入門参照。優先度低 |
| claude-agent-sdk-demos / claude-cookbooks | SDK デモ・レシピ集 | 汎用。V3-AIP 実装時の逆引き用 |
| claude-for-legal / defending-code 等 | 法務・セキュリティ特化 | **使えない**(ドメイン不一致) |

**正直な結論**: anthropics org には**動画生成そのものの資産は存在しない**(音声・映像合成の repo・Skill はゼロ。最も近いのは `slack-gif-creator` 程度)。org 資産がカバーするのは (a) 台本・記事・資料などテキスト/文書側のスキルテンプレ(knowledge-work-plugins marketing + skills repo)、(b) マルチエージェント編成の実装配線(financial-services)、(c) Skill の書き方仕様(skills/spec + skill-creator)の3点。**V3-VID の映像・音声レイヤーは外部ツール(動画生成・TTS 等)を別途選定する必要があり、本追補の範囲外**として次段の調査課題に残す。

### 追-5. V3 要件マッピング(追補分)

| 資産 | 効く V3 要件 | 効き方 |
|------|-------------|--------|
| marketing/content-creation + commands | V3-VID-01 / V3-VID-07 | 台本・記事スキルの SKILL.md 雛形(チャネル置換で写経) |
| marketing/brand-voice + skills/brand-guidelines | V3-VID-10(ツイン二体) | 二体分の人格 SKILL.md + /brand-review 型の人格ブレ機械チェック |
| skills/pptx・docx・doc-coauthoring | V3-VID-28 / V3-VID-07 | 資料・記事の本番級文書生成実装 |
| financial-services agent-plugins/vertical 二層 + agent.yaml + orchestrate.py | V3-AIP 系(司令塔+批評家)/ V3-AIP-96 | マルチエージェント編成・handoff の公式実装参照(本文根拠7 の実物版) |
| skills/skill-creator + template/ + spec/ | V3-AIP 系全般 | ver3 独自スキル作成の公式仕様・雛形 |

**再検証条項(追補分)**: (1) 実装着手時に knowledge-work-plugins の `marketing/skills/*/SKILL.md` と anthropics/skills の `brand-guidelines`・`skill-creator` を clone して逐語確認(本追補は WebFetch 要約に基づく)。(2) claude-plugins-official のカタログ全容を Claude Code の `/plugin > Discover` で再探索。(3) skills repo の docx/pptx は source-available ライセンス(OSS ではない)のため、商用発信物への利用条件を実装前に原文確認。

出典(追補): https://github.com/anthropics/knowledge-work-plugins / https://github.com/anthropics/financial-services / https://github.com/anthropics/skills / https://github.com/anthropics/claude-plugins-official / https://github.com/orgs/anthropics/repositories (すべてアクセス 2026-07-10)
