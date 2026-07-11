---
id: public-oss-release-plan
title: it-hercules-laboratory — 段階制 OSS 公開計画（Release Plan）
date: "2026-07-11"
status: draft
---

# it-hercules-laboratory — 段階制 OSS 公開計画

> **本計画は起草物であり、公開の実施ではない。** 各段の**昇格（本番/公開の実施）は人間ゲート**（V3-AIP-80 公開・V3-AIP-68 昇格）。
> ライセンスは Apache License 2.0(第12回裁定確定)。公開日そのものは未裁定。本書は「何が揃えば次段へ進めるか」の条件表である。

## 0. 前提（不変条項に従う）

- 正本は GitHub 一本・全ソース単一 clone 公開（フォーク文化）。Truth（永続データ）は repo の外（R2）。
- 秘密は repo に入れない。置いてよいのは `.env.example` の型だけ。実鍵投入は人間ゲート。
- 各段の昇格は**可逆な準備をすべて済ませてから**、不可逆・対外操作の一点だけを人間が裁定する。

## 1. 段階（Stage 0 → 3）

### Stage 0 — Internal（現在地）

- **範囲**: 非公開 repo・sandbox（wrangler dev local / workers.dev dev サブドメイン）。
- **成果**: schemas / 投影純関数 / ScreenDef / 機械 GATE 群 / 公開文書 3 本（本書・whitepaper・protocol）起草済。
- **昇格ゲート（→ Stage 1）**: 機械 GATE 全緑（lint / test / pytest）・RTM 閉包 100%・秘密混入 grep 0・必須公開文書（MANIFESTO / README / CONTRIBUTING / CODE_OF_CONDUCT / LICENSE）存在 GATE 緑。**判断は人間。**

### Stage 1 — Staging（限定・read-only 公開の準備）

- **範囲**: staging worker（`ihl-ver3-truth-dev` バケット・workers.dev/dev サブドメインのみ・本番 route/ドメインなし）。少人数の招待レビュー。
- **目的**: 実 UI E2E（観測ライフサイクル・UGC 翻訳）の実走確認と、危険コード物理ゲート（金銭/DNS/自己権限変更の検出）の運用確認。
- **昇格ゲート（→ Stage 2）**: 10 人規模レビュー + 約 1 ヶ月の試験運用（V3-AIP-68 運用ゲート）・重大回帰ゼロ・意図台帳と要件凍結ゲートが運用に耐えること。**staging 実デプロイ・dev worker への secret 投入は対外操作**につき実行直前に一言報告（承認済み）。**正式採用判断は人間。**

### Stage 2 — Public read-only（ソース公開）

- **範囲**: repo を公開 clone として開示（Apache 2.0）。書込は招待/認証済みに限定。
- **目的**: 単一 clone 宣言の実現・fork 文化の起動（Component fork + lineage を外部が始められる）。
- **昇格ゲート（→ Stage 3）**: 外部 fork/PR の受け入れフローが CONTRIBUTING と CI GATE で回ること・ガバナンス（掲示板/裁定/precedent）が実運用に耐えること。**公開の実施は人間ゲート。**

### Stage 3 — Open contribution（外部書込・本番）

- **範囲**: 外部貢献の常時受け入れ・本番ドメイン。
- **前提**: 本番鍵/実鍵の投入・金銭導線・物理治具は各々**独立の人間ゲート**（この計画では一括承認しない）。

## 2. 昇格ゲート早見表

| From → To | 機械条件 | 人間ゲート |
|-----------|----------|-----------|
| 0 → 1 | 全 GATE 緑・RTM 閉包 100%・秘密 0・公開文書存在 | Stage 1 開始判断 |
| 1 → 2 | E2E 実走緑・危険コードゲート運用確認 | 10 人×約1ヶ月試運用・正式採用判断（V3-AIP-68） |
| 2 → 3 | fork/PR フロー + ガバナンス実運用 | 外部書込・本番の開放（V3-AIP-80） |

## 3. 撤回台帳との関係

公開・昇格に伴う不可逆操作（公開範囲の変更・本番鍵投入・金銭導線）は撤回台帳 R-1〜R-9 の対象。**台帳項目の復活は人間ゲート**であり、本計画は台帳を消費しない。

## 4. 未実装・分母除外（誇張ゼロ）

- 本計画は**条件と順序の宣言**であり、いずれの段の昇格も現時点で「実施済み」とは主張しない。
- Stage 1 以降の実デプロイ・公開・本番鍵は、それぞれ実行直前の人間裁定を要する（可逆準備は先行してよい）。
