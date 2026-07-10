---
id: C1-R2-EVIDENCE
title: "R2 put-if-absent 実バケット検証（先勝ち・後発 null）"
date: "2026-07-10"
status: active
---

# R2 put-if-absent LIVE 検証エビデンス（Phase C1 / R1）

不変条項③「Truth は append-only・同一キー再 put は拒否」を **ストレージ層（Cloudflare R2 本体）で強制できるか** を、実バケットに対する 2 重 put で実測した記録。

## 環境

| 項目 | 値 |
|---|---|
| 実行日 | 2026-07-10 |
| wrangler | 4.20.0（Node 20.20.2 のため latest=4.110.0 は不可 — engines が Node 22 要求） |
| Node.js | v20.20.2 |
| バケット | `ihl-ver3-truth-dev`（本検証で新規作成。実 Cloudflare R2。アカウント ID はログ・URL に一切出現せず、本書にも記載しない） |
| 実行方式 | `wrangler dev --remote`（Worker はエッジ実行・R2 は実バケット）+ curl localhost:8787 |
| compatibility_date | 2025-06-01 |

## Worker の put 呼び出し（検証コード抜粋）

```js
const onlyIf =
  syntax === "headers"
    ? new Headers({ "If-None-Match": "*" })
    : { etagDoesNotMatch: "*" };
const res = await env.TRUTH.put(key, body, { onlyIf });
return Response.json({ syntax, result: res === null ? null : { etag: res.etag } });
```

GET 側は `env.TRUTH.get(key)` で本文と etag を返す。

## 実測ログ（request/response 逐語）

### 構文 A: `{ onlyIf: { etagDoesNotMatch: "*" } }` — key `c1-verify/object-syntax`

```
PUT /?key=c1-verify/object-syntax&syntax=object  body="first-body-object"
→ {"syntax":"object","result":{"etag":"b3c4b0d0129e204afba12b4ba2f635e7"}}

PUT /?key=c1-verify/object-syntax&syntax=object  body="second-body-object"
→ {"syntax":"object","result":null}

GET /?key=c1-verify/object-syntax
→ {"body":"first-body-object","etag":"b3c4b0d0129e204afba12b4ba2f635e7"}
```

3 回目の put（body="third-body-object"）も `result: null`、GET は依然 `first-body-object`。拒否は安定。

### 構文 B: `new Headers({ "If-None-Match": "*" })` — key `c1-verify/headers-syntax`

```
PUT /?key=c1-verify/headers-syntax&syntax=headers  body="first-body-headers"
→ {"syntax":"headers","result":{"etag":"5b71a948a9d9e1ad86e299936ea81ae8"}}

PUT /?key=c1-verify/headers-syntax&syntax=headers  body="second-body-headers"
→ {"syntax":"headers","result":null}

GET /?key=c1-verify/headers-syntax
→ {"body":"first-body-headers","etag":"5b71a948a9d9e1ad86e299936ea81ae8"}
```

## 先勝ち証明

両構文とも: 1st put = etag 返却（書き込み成功）、2nd put = `null`（書き込み拒否・例外なし・上書きなし）、GET の本文と etag は 1st put のものと一致。**first-wins をストレージ層が保証**。workers-sdk issue 6411 で報告された不具合は本環境（compatibility_date 2025-06-01、2026-07 時点のエッジ）では再現しない。

## 判定

- **mode: storage** — アプリ層チェック（ver2 方式・R-05 フォールバック）は不要。
- ver3 が使う正式構文（どちらも動作するが、型付きオブジェクト形式を正とする）:

```ts
const res = await env.TRUTH.put(key, body, { onlyIf: { etagDoesNotMatch: "*" } });
if (res === null) {
  // 同一キーが既存 → 409 Conflict を返す（不変条項③）
}
```

- 注意: put は失敗時に throw せず **null を返す**。呼び出し側は必ず null 判定して 409 に変換すること。

## 後始末

- `wrangler dev` プロセスは停止済み。Worker のデプロイは行っていない（dev --remote のみ）ため削除対象なし。
- バケット `ihl-ver3-truth-dev` とテストオブジェクト `c1-verify/object-syntax`・`c1-verify/headers-syntax` は append-only 文化に従い残置（無害なエビデンス）。
