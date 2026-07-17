---
id: ADR-V3-WASM-01
title: WASM(Extism/Spin)スクリプトドライバ — 最小仕様と Extism 推奨(未実装・要architect確認)
date: "2026-07-17"
status: proposed
source: "01-requirements/srs.md V3-FND-20"
---

# ADR-V3-WASM-01 — WASM スクリプトドライバ最小仕様

- **Status**: Proposed(未実装・in_progress)。ランタイム選定(Extism vs Spin)は本 ADR で
  Extism を推奨するが、実装着手前に architect/人間の確認を推奨する(2 つの妥当な選択肢が
  あり、どちらを採るかで後続実装が分岐するため)。
- **Date**: 2026-07-17(round-16 C8 ラン・g01-基盤コストクラスタ)
- **誇張ゼロの明記**: 本 ADR は設計文書のみ。ランタイム本体(Extism/Spin の埋め込み)・
  AST バリデータ・manifest/監査ログの実装コードは**まだ書かれていない**。理由は下記
  「規模」節。

## 文脈(Context)

V3-FND-20: 「WASM(Extism/Spin)ドライバで中間APIサーバーを不要化し、既存フレームワーク
は丸ごとでなく承認済みホワイトリストAPIのみをアダプタ化して吸収する。AST最小仕様+
C-USB(JSON型/エラー/バージョニング)を固め、危険API(ファイル書込/ネットワーク/OS
コマンド)はASTレベルで書けないようにし、manifest+監査ログ付きで実行する。Scriptノード
はWASMまたはプロセス隔離で実行する(node vmは隔離境界として使わない)。」

現行アーキテクチャは Cloudflare Workers(`apps/api`)+ Pages(`apps/web`)+ R2(Truth)の
サーバーレス構成で、常駐プロセスは一切ない(不変条項①・V3-CST-01)。AI Kernel
(`apps/api/src/ai-kernel.ts`, V3-FND-21)はプロバイダ未接続で既定 501 を返す設計。
「中間APIサーバーを不要化」する Script 実行機構は、この既存の「常駐サーバーを持たない」
制約と両立しなければならない。

## 規模(なぜ実装まで進めなかったか)

以下 4 点はいずれも本ラン(1 セッション・g01 レーン)の残枠に収まらない設計判断/実装量:

1. ランタイム選定自体が二択の設計判断(下記)。
2. AST ホワイトリスト検証は言語ごとに別実装が要る(「対象言語はホワイトリスト適用可能
   なものに限定する」を満たすには、まず対象言語を 1 つに絞る裁定が要る)。
3. 危険 API(ファイル書込/ネットワーク/OS コマンド)を AST レベルで「書けなくする」静的
   検証器は、既存 lint スクリプト群(`scripts/*.mjs`)とは別クラスの実装(パーサ+ホワイト
   リスト規則エンジン)。
4. WASM ランタイム自体(Extism/Spin どちらでも)が新規の重い依存で、`node_modules`/
   Python env に現状どちらも入っていない(確認済み — ゼロから追加する規模)。

代わりに、後続実装が迷わないための最小仕様(下記)を固定する。

## 決定(Decision)— ランタイム推奨: Extism

| 観点 | Extism | Spin |
|---|---|---|
| 実行モデル | ライブラリとして呼び出し元プロセスに埋め込む(PDK 埋め込み・別プロセス不要) | 独立した WASM アプリサーバー(常駐プロセスとして起動) |
| 現行アーキテクチャとの整合 | Workers ハンドラ内から呼べる可能性がある(要検証: workerd 内での WASM 実行制約) | 常駐サーバー = V3-CST-01「サーバーレス中心・常駐プロセスを持たない」と衝突しやすい |
| 10 年コスト最小(不変条項①) | 追加の常駐プロセスなし → 適合しやすい | 別途プロセス/コンテナのホスティングコストが要る → 不適合寄り |

**推奨**: Extism(埋め込み型)。Spin は「中間APIサーバーを不要化する」という本要件の目的
そのものと矛盾する(Spin 自体が中間サーバーになりうる)ため、現行のサーバーレス制約
(V3-CST-01)の下では Extism が既定路線になる。ただし Cloudflare Workers(workerd)ランタイム
上で Extism ホストがどこまで動くか(WASM 実行自体は workerd がネイティブサポートするが、
Extism PDK のホスト関数呼び出し層が workerd 上で動作するかは未検証)は要 spike。

## AST 最小仕様(固定する契約)

Script ノードは以下の C-USB 契約(JSON型/エラー/バージョニング)を満たす:

```
ScriptManifest {
  id: string                    // C-USB component id
  version: string                // semver。破壊的変更は version bump(type 内包・V3-FND-04系)
  language: "js-subset"          // 初回は 1 言語のみ(全言語相互変換は目標から外す)
  allowed_apis: string[]         // ホワイトリスト(承認済み API 名のみ・既定は空 = 何も呼べない)
  entrypoint: string             // 実行関数名
}
ScriptError {
  code: string                   // 機械可読エラーコード(AGENTS.md 規約と同型)
  message: string
}
ScriptAuditLogEntry {            // 実行ごとに1件・INSERT ONLY(不変条項③と同型)
  run_id: string                  // ULID
  script_id: string
  script_version: string
  started_at: string              // RFC3339
  allowed_apis_used: string[]      // 実行中に呼ばれた API(ホワイトリスト部分集合であることを事後検証可能にする)
  status: "ok" | "denied" | "error"
}
```

**危険 API 拒否の位置**: AST 静的検証(実行前)で `allowed_apis` に無い呼び出し(ファイル
書込/ネットワーク/OS コマンド等)を含むスクリプトは実行そのものを拒否する(実行時
サンドボックスの二重防御ではなく、実行前ゲートを一次防御とする — 実行時にすり抜けを
検知する設計は本 ADR の対象外)。

**隔離境界**: Node `vm` モジュールは隔離境界として使わない(要件文どおり — `vm` は
プロトタイプ汚染等でサンドボックス破りが知られる)。WASM 線形メモリ、またはプロセス
隔離(別プロセス起動)のいずれかを隔離境界とする。

## 帰結(Consequences)

- **次のセッションが着手する際の入口**: (1) Extism を Cloudflare Workers(workerd)上で
  動かせるかの spike(動かなければ Spin 案 or 別ランタイムへ裁定を差し戻す)。(2) 対象
  言語 1 つの裁定(JS サブセットが最有力 — 既存スタックが TS/JS のため)。(3) 上記
  `ScriptManifest`/`ScriptError`/`ScriptAuditLogEntry` を `schemas/events/` に正式スキーマ化
  してから実装に入る(スキーマ先行・Spec-Driven, V3-AIP-34 と同じ流儀)。
- **リスク**: ランタイム選定を誤ると後戻りコストが大きい(埋め込み型 vs サーバー型は
  アーキテクチャレベルの分岐)。この ADR の推奨(Extism)を採用する前に、上記 spike で
  workerd 適合性を実測することを推奨する。
