---
id: sandbox-local
title: ローカルサンドボックス — Fork して自分の環境で試す(V3-SEC-45 C案)
date: "2026-08-01"
status: active
---

# ローカルサンドボックス — Fork して自分の環境で試す

> **隔離実行はこちらでは行いません。利用者のローカル環境で実行してください。**
> これは制限ではなく、この文明が採る設計上の宣言です。

## なぜこの形なのか

it-hercules-laboratory はユーザーコード(Fork した機能・ドライバー・カスタムワークフロー)を
**サーバー側で隔離実行しません**。理由は次の2点です。

1. **技術的制約**: 本サービスの API は Cloudflare Workers 上で動作しており、Workers
   ランタイム(workerd)は任意コードの動的実行(`eval`等)を許容しません。真の隔離実行環境
   (Workers for Platforms 契約・独自 WebAssembly インタプリタ等)は大規模なインフラ投資を
   要する別プロジェクトです(詳細は `docs/planning/c8/design-v3-sec-45-sandbox-boundary.md`
   を参照)。
2. **思想的な選択**: 「フォーク文化」(V3-FND-16)を前提とするこの文明では、コードを
   実行するのはサービス運営者ではなく利用者自身であるべきだと考えています。あなたの
   コードが暴走しても、他の利用者に影響しない構造(=あなたの手元の Docker コンテナ内で
   完結する構造)の方が、サーバー側で無理に隔離するより安全で誠実だと判断しました。

**「サーバー側で安全に隔離実行できます」とは言いません。それは事実ではないからです。**
代わりに、あなたの環境で好きなだけ壊せる場所を用意しました。

## 手順

### 1. Fork する

GitHub 上で it-hercules-laboratory のリポジトリを Fork します。あなたの Fork は
あなた自身のものであり、本サービス側のデータ・利用者へは一切影響しません。

### 2. `docker compose up` で起動する

Fork したリポジトリのルートで、以下を実行します。

```bash
docker compose up
```

API とローカル DB(本番 R2 とは完全に別のローカルストレージ)がまとめて起動する想定です
(実際の構成は同梱の `docker-compose.yml` を参照)。

### 3. 好きなだけ壊して試す

ローカル環境なので、データを壊しても、無限ループを書いても、他の誰にも影響しません。
本サービスの `apps/api/src/sandbox-routes.ts` が提供する認可ゲート(Whitelist・
本番DB書込禁止・外部通信禁止・CPU/メモリ制限の事前検証)は、あなたの Fork 環境でも
そのまま動作を確認できますが、実際の隔離はあなたのローカル Docker コンテナ境界が
担っています。

### 4. Promote 申請する

自分の変更を本サービスへ取り込みたい場合は、Fork から Pull Request(Promote 申請)を
出してください。ここで初めて人間によるレビューが入ります
(`AGENTS.md` 不変条項④「sandbox改善は明示 Promote まで本番へ流すな」)。**Promote 申請
以前の作業内容が本番へ自動的に反映されることはありません。**

## Fork → Docker → Promote の全体像

```
[あなたの GitHub Fork]
   │  docker compose up(ローカルDocker・完全隔離)
   ▼
[あなたのローカル環境で自由に実行・破壊・実験]
   │  Pull Request(Promote 申請)
   ▼
[人間によるレビュー] ──通過── [本サービスへ反映]
```

## Dockerfile / docker-compose.yml について

`Dockerfile` と `docker-compose.yml` 本体はリポジトリ直下に別途配置されます
(本文書は手順書のみを提供しており、それらのファイル自体はこの文書の担当範囲外です)。
本文書執筆時点でのリポジトリ直下の配置状況は、`git status`/`git log` で別途確認して
ください(本手順書は Docker 定義ファイルの実在を保証するものではありません — 誇張ゼロ)。

## 未確定・要今後の作業(誇張ゼロ)

- `sandbox-routes.ts` の応答メッセージ(「隔離実行はこちらでは行いません」旨の明記)は、
  本文書とは別のレーンが担当します(`apps/api/src` は本文書のレーンの書いてよい場所の外)。
- `docs/planning/c8/progress.json` の `V3-SEC-45` 行は、本文書の追加によって変化しません
  (2026-07-31 HQ裁定 R64-9 により `in_progress` を維持する運用のため、本レーンはこの行を
  触りません)。

## Citations

- `docs/planning/c8/design-v3-sec-45-sandbox-boundary.md`(サンドボックス境界の実装範囲と残課題)
- `(00-hq)kits/lane-think/R0731-08b452-REPORT-2026-07-31-g64-design19.md` §T2-4(C案の設計根拠。外部リポジトリ=00-hq)
- `apps/api/src/sandbox-routes.ts`(既存の認可ゲート実装)
