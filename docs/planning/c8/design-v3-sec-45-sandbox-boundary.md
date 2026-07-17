---
id: design-v3-sec-45-sandbox-boundary
title: V3-SEC-45 サンドボックス境界 — 実装範囲と残課題(誇張ゼロ)
date: "2026-07-17"
status: active
---

# V3-SEC-45 サンドボックス境界 — 実装範囲と残課題

## 要件(再掲)

> ユーザーコード/ドライバー実行はサンドボックス境界(Extism/Docker/CUSB/WebAssembly/vm)で
> 完全隔離実行し、本番DBは読み取り専用・テストDBは破壊可能・外部通信不可・CPU/メモリ制限を
> 課す。失敗時は400を返す。ノーコード利用者はGrapesJS+Blockly、上級者はMonaco+JSON、開発者は
> GitHubでForkを作り、Fork実行安全はWhitelist(Component/API/Workflow)+Sandbox+Permission制御で
> 担保する。

srs.md の検証キーは「400」のみ(受入条件が「拒否時 400 を返すこと」に絞られている)。

## 今回実装した部分(`apps/api/src/sandbox-routes.ts`)

**POST /api/v1/sandbox/execute-request** — Fork/Workflow/Component 実行"要求"の事前検証ゲート。
以下を全て満たさない限り 400 を返す(実行そのものはしない・後述の理由):

1. **Whitelist(Component/API/Workflow)**: `kind`(component|api|workflow)+`ref` が
   `SANDBOX_WHITELIST`(固定の許可リスト・拡張はここへ追記)に無ければ 400
   `WHITELIST_VIOLATION`。
2. **本番DB読み取り専用**: `target_db==="production"` かつ書込系操作要求
   (`write:true`)なら 400 `PRODUCTION_WRITE_FORBIDDEN`。書込は `target_db==="test"`
   のみ許可(「テストDBは破壊可能」)。
3. **外部通信不可**: `network===true` なら 400 `NETWORK_ACCESS_FORBIDDEN`。
4. **CPU/メモリ制限**: `cpu_ms`/`memory_mb` が `SANDBOX_CPU_MS_MAX`/
   `SANDBOX_MEMORY_MB_MAX` を超えるなら 400 `RESOURCE_LIMIT_EXCEEDED`。

全て通過すれば `202 { accepted: true }` を返す。

## 実装していない部分(誇張ゼロ・明示)

上記は「Whitelist+Permission制御」の**認可ゲート**のみである。要件本文が求める
**「サンドボックス境界(Extism/Docker/CUSB/WebAssembly/vm)で完全隔離実行」— 実際にコードを
隔離実行するランタイムそのもの — は本セッションでは実装していない。**理由:

- Cloudflare Workers ランタイム(workerd)は `new Function` / 動的コード生成を禁止する
  (`packages/truth/src/envelope.ts` の ajv standalone 化コメント参照・同じ制約)。任意の
  ユーザー JS を同一 Worker プロセス内で `eval` する経路は存在しない。
- 実際の隔離実行には次のいずれかが要る: (a) Cloudflare **Workers for Platforms**
  (dynamic dispatch namespace)— アカウントレベルの契約/インフラ設定が要る人間ゲート相当の
  意思決定、(b) 独自 WebAssembly インタプリタの新規実装 — 数週間規模の別プロジェクト、
  (c) Extism/Docker を使う場合はサーバサイド(Workers 外)の別実行基盤が要る。
- CPU/メモリの**強制**(制限値の宣言ではなく実測ガード)も、実行ランタイムが無い現状では
  行えない(宣言値のチェックのみで、実測による打ち切りではない)。

## 実際のユーザー階層別の安全境界(既存アーキテクチャに即した読み替え)

- **ノーコード(GrapesJS+Blockly)・上級者(Monaco+JSON)**: 本システムの「ユーザーコード」は
  実質 **宣言的 JSON 設定**(screen-defs・workflow 定義等)であり命令的コードではない。
  よって真に必要な境界は「宣言可能な範囲の whitelist 検証」であり、これは今回実装した
  ゲートで実質的に担保される(JSON は実行系を持たないため「隔離実行」の脅威モデルが
  縮小する)。
- **開発者(GitHub Fork)**: Fork 自体が別リポジトリ/別アカウントという構造的隔離であり、
  本番への反映は `AGENTS.md` 不変条項④「sandbox改善は明示 Promote まで本番へ流すな」の
  既存の人間ゲート契約でカバーされる(新規実装不要・既存規約の適用)。

## 引継ぎ(次セッション/人間裁定への申し送り)

1. Extism/WASM ランタイム導入 or Cloudflare Workers for Platforms 契約が必要になった時点で、
   `sandbox-routes.ts` の認可ゲートを実行トリガーの前段として再利用する設計にする
   (ゲート通過 → 実行基盤へディスパッチ、の2段構成)。
2. Whitelist(`SANDBOX_WHITELIST`)は現状プレースホルダ値。実際の Component/API/Workflow
   registry が確定した時点で置き換える。
3. progress.json 上のステータスは **in_progress**(認可ゲートのみ実装・実行基盤は未着手)
   として記録すること。「動く」と書かない。
