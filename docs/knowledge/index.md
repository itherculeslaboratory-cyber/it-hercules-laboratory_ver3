# docs/knowledge — インデックス

サブブレイン知識バンドルの全ページ 1 行カタログ。**保存とインデックスは不可分** — ページを増減したらこの表を同じ変更で更新する（乖離禁止）。規約は [`CLAUDE.md`](./CLAUDE.md)。

## topics

| name | link | 一文説明 |
|---|---|---|
| 飼育環境の知識 | [topics/breeding-environment.md](./topics/breeding-environment.md) | 観測の「環境」ドメインと温度・湿度・照度の取得/保存規約（生値のみ・append-only） |
| 観測パイプライン | [topics/observation-pipeline.md](./topics/observation-pipeline.md) | capture→DINOv2 埋め込み→決定論的な metadata+cosine 類似検索梯子と rerank 重み |
| 知の広場 | [topics/knowledge-plaza.md](./topics/knowledge-plaza.md) | 3 柱 IA（掲示板/論文/GitHub）と汎用引用スキーマの設計要約（PROVISIONAL） |
| 研究ノートモデル | [topics/research-notes-model.md](./topics/research-notes-model.md) | 論文 6 節スキーマ・5 ステップ進行・append-only 研究フロー（PROVISIONAL） |
| 標準撮影チャンバー | [topics/shooting-chamber.md](./topics/shooting-chamber.md) | 全国参加者がスマホで同一品質のヘラクレス画像を撮る標準化撮影ボックス仕様 |

## sources

| name | link | 一文説明 |
|---|---|---|
| （情報源要約） | [sources/index.md](./sources/index.md) | K2 ingest が 1 スレッド/1 論文ノート単位で書き込む場所（現在は空） |

## その他

| name | link | 一文説明 |
|---|---|---|
| オープンクエスチョン | [open-questions.md](./open-questions.md) | 矛盾・ギャップ・次に調べること |
| バンドル規約 | [CLAUDE.md](./CLAUDE.md) | OKF frontmatter・保存=index 追記・出典必須・境界 |
| 更新ログ | [log.md](./log.md) | Initialization / Ingest / Lint 履歴 |
