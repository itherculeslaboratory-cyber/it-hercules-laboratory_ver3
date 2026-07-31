# 技術宣言書(Technical Manifesto) — V3-BBS-32

> 本ディレクトリの文書は法的助言ではない。it-hercules-laboratory(IHL)の思想・構造・哲学を
> 公知化するための社内ドラフトである。

## 要件(再掲)

> 思想・構造・哲学を公知化する技術宣言書(Technical Manifesto)/設計書を多層で作成する:
> 専門家向け・一般人向け(10歳でも分かる)・ショート動画台本の3層、および設計書3種
> (AI用/一般人用/開発者用)×英語・日本語の両言語。全コンポーネントにtechnical/engineer・
> human・AI最適化の3パターン設計書を必須とし最初にEngineer Specを作りそこから派生させる。

## 本ラウンドで作成したもの(誇張ゼロ・スコープの明示)

| 成果物 | 状態 |
|---|---|
| 専門家向け層(日本語) | 作成済み — [technical-manifesto-expert.md](./technical-manifesto-expert.md) |
| 一般人向け層・10歳でも分かる版(日本語) | 作成済み — [technical-manifesto-general.md](./technical-manifesto-general.md) |
| ショート動画台本層(日本語) | 作成済み — [technical-manifesto-video-script.md](./technical-manifesto-video-script.md) |
| 英語版(3層とも) | **未着手**。トークン予算(本ラウンド+100k見積り・15件中の1件)の都合で日本語版を優先した |
| 設計書3種(AI用/一般人用/開発者用) × 3パターン設計書の一般規約 | [spec-pattern-guide.md](../spec-pattern-guide.md)(V3-WIK-22)へ統合済み。個別コンポーネントごとの3パターン文書の全面整備はコンポーネント数が多く本ラウンド外 |

**この節を正直に読むこと**: 要件が求める「3層×3種×2言語」のフルマトリクスのうち、
本ラウンドで実際に作成したのは「日本語・3層」のみである。英語版・個別コンポーネントの
3パターン設計書整備は残作業として明記し、`progress.json` の status を `done` にはしない
(下記「progress.json記録」参照)。

## 出典

- `01-requirements/registry.json`(id=V3-BBS-32 statement)
- `02-design/constitution.md`(思想の一次情報源: AIファースト・10年コスト最小・フォーク文化・人間ゲート)
- `docs/knowledge/spec-pattern-guide.md`(V3-WIK-22・3パターン設計書の執筆規約)
