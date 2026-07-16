# CLAUDE.md — docs/knowledge バンドル規約

エージェントが維持する永続 Wiki（サブブレイン）。設計は [`DESIGN-subbrain-knowledge-layer.md`](../planning/claude-plans/DESIGN-subbrain-knowledge-layer.md)、骨格計画は [`PLAN-knowledge-bundle-bootstrap.md`](../planning/claude-plans/PLAN-knowledge-bundle-bootstrap.md)。OKF v0.1 準拠で、`D:\notes` の個人ノートと**同一規約**（相互運用のため）。

## ファイル形式

- **OKF frontmatter 必須**: `type`（`Topic` | `Source` | `Question`）· `title` · `description` · `tags` · `timestamp`。
- スラグは **kebab-case 英語**（日本語ファイル名を使わない）。日本語は `title` に置く。
- リンクは**バンドル相対**（例 `./topics/xxx.md`）。壊れリンクは「未執筆の知識」として許容する。

## 保存とインデックスは不可分

ページを作成・改名したら、**同じ変更で** [`index.md`](./index.md) に 1 行を追加・修正する（Second Brain 原則 4「常に真のインデックス」）。index.md と実ファイルの乖離は禁止。

## 出典必須

各 Topic ページは Truth イベント・設計 doc・辞書などへの引用を `# Citations` 節に必ず持つ。**出典なしの主張を書かない**。引用パスは実在させる（リンク切れゼロ）。

## 記録と Lint

- 更新は [`log.md`](./log.md) に記録（`## YYYY-MM-DD` 見出し + `**Ingest**` / `**Lint**` / `**Creation**` エントリ）。
- 月次 Lint（矛盾・孤立ページ・古い記述・リンク切れの健全性チェック）も log に残す。`/graphify` で参照グラフの孤立を可視化してよい。

## ディレクトリ

| 場所 | 役割 |
|---|---|
| `topics/` | トピックページ（蒸留された知識） |
| `sources/` | 情報源の要約ページ（1 スレッド / 1 論文ノート = 1 ページ）。K2 の ingest が書く |
| `open-questions.md` | 矛盾・ギャップ・次に調べること |

## Ingest と蒸留(K2)

決定論 CLI `tools/knowledge_ingest.py` が `board/board_event` · `research/v1` をリプレイし、新規分の `sources/*.md` スタブ（末尾に `<!-- DISTILL: pending -->` マーカー）を生成する。**CLI はモデル呼び出しをしない**。蒸留は以下のエージェント手順で行う:

```
claude --model sonnet -p "docs/knowledge/CLAUDE.md を読み、sources/ の DISTILL: pending を1件ずつ蒸留せよ: description を書き、関連 topics ページを更新し、相互リンクと Citations を張り、マーカーを削除し、log.md に記録"
```

運用: `python tools/knowledge_ingest.py scan`（差分確認）→ `ingest`（スタブ生成）→ 上記蒸留。

## 境界

- 本バンドルは **docs 配下のみ**。`01-要件` 等の他ディレクトリへは**一方向リンク**のみで、変更しない。
- 知の広場: （旧）PROVISIONAL（実装禁止ゲート中） → （現在）第13回裁定（`user-ruling-2026-07-11-round-13.md` #2）で本採用 Go・HG-KN-01〜08 確定。BBS（plaza-routes）/GOV（gov-routes）系は実装済み。残る人間ゲートは**一般公開のみ**（PROTECTED 解除は cutover 後に別途裁定・不可逆ゲート分離）。K1/K2 は引き続き docs/tools 層に限定する。
- Truth データ（R2 / captures / events）は append-only。UPDATE / DELETE しない。
