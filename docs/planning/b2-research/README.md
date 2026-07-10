---
source: "docs/planning/ver3/b2/README.md@4a56cf6"
id: B2-INDEX
title: Phase B2 deep-research 技術選定 — 索引
date: 2026-07-10
status: done
phase: B2
report_ref: REPORT-ver3-phase-b-2026-07-10
---

# Phase B2 技術選定 — 索引(8レポート)

> 全レポートは「調査→敵対的出典実在チェック→(不合格時)修正」の批評家ゲートを通過済み。各選定に web 根拠5件以上。調査日 2026-07-10 — **実装着手時に再検証条項あり**(各レポート末尾)。

| # | レポート | 決定(1行) | 根拠数 | ゲート |
|---|---|---|---|---|
| 1 | [ADR-V3-EMB-01-embedding-dimension.md](ADR-V3-EMB-01-embedding-dimension.md) **(最優先・DIFF-C-18 解消)** | 画像埋め込みは **384 次元(DINOv2 ViT-S/14)に一本化**。ColorHist/Lab は rerank 特徴として分離維持。768 はエスケープハッチ(移行手順のみ定義) | 13 | 修正後通過 |
| 2 | [research-gmo-aozora-api.md](research-gmo-aozora-api.md) | GMO あおぞら API 正式採用。設計〜結合検証は **sunabar(無料 sandbox)で完結**、本番は振込入金明細照会ポーリング照合(CL-11 互換)最小構成、VA+Webhook は拡張経路 | 12 | 通過 |
| 3 | [research-workers-vs-vps.md](research-workers-vs-vps.md) | ver3 新 repo は**最初から Workers+Hono(TS)** で主 API を書く(二度書き棄却)。「VPS=SMTP 薄常駐」条項は HTTP メール API 第一候補に修正 | 16 | 通過 |
| 4 | [research-tts-video-stack.md](research-tts-video-stack.md) | TTS は **VOICEVOX Engine** 正(互換 HTTP API を C-USB 境界、AivisSpeech 差替候補)、合成は ffmpeg+Python(ASS 焼き込み)、画像は ComfyUI(8GB VRAM)+open_clip 再利用判定、投稿は YouTube Data API のみ自動 | 21 | 修正後通過 |
| 5 | [research-wiki-integration.md](research-wiki-integration.md) | テキスト埋め込みは **ruri-v3-70m(384・Apache-2.0・ONNX 端末実行)**、小wiki→大wiki は既存 ingest CLI の決定論拡張。新規 RAG 基盤・ベクトル DB は導入しない | 11 | 通過 |
| 6 | [research-ai-first-data-design.md](research-ai-first-data-design.md) | **7点セット標準規約**: AGENTS.md+llms.txt / CloudEvents 風エンベロープ(ULID+provenance) / JSON Schema 単一正本+codegen / Parquet kv_metadata / 見出し=チャンク境界 / 人間可読ビュー全生成 | 16 | 通過 |
| 7 | [research-smtp-secrets-migration.md](research-smtp-secrets-migration.md) **(B2 必須項目)** | 送信は **Resend** へ移行し鍵は API キー1本に集約。保管3段(いま=.env.platform+playbook 追記 → ver3=systemd LoadCredential → ver4=Workers secret+HTTPS 直送信)。**実鍵投入は人間ゲート** | 15 | 通過 |
| 8 | [research-external-knowledge.md](research-external-knowledge.md) | anthropics/life-sciences の marketplace+Skill/MCP 構造を科学OS設計テンプレに採用参照。Chase AI は公開 repo なし(有料限定)のためパターン抽出に限定 | 7 | 通過 |

## 決定間の整合メモ

- **384 統一**: #1(画像 384)と #5(テキスト ruri-v3-70m 384)で画像・テキストとも 384 に揃い、V3-FND-19(端末 ONNX・従量課金ゼロ)と整合。
- **メール経路**: #3 が「VPS=SMTP 薄常駐を選択肢に降格」、#7 が「Resend(HTTPS API)第一候補」— 相互に整合。ver4 の VPS 薄常駐前提の最終再裁定は人間ゲートに付議。
- **symlink 注意**: #6 は AGENTS.md=CLAUDE.md symlink を挙げるが、新 repo フォルダ設計(b3)は Windows 環境を踏まえ **複製+CI 同期検査**を採用。フォルダ設計側を正とする。
- **鍵の扱い**: #2/#7 とも実鍵(GMO 本番キー・SMTP/Resend キー)の投入は人間ゲート。**キーのコミットは絶対禁止**。
