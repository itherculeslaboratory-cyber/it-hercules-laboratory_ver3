---
id: C1-TC-LOG
title: "CL-01〜13 negative TC — TDD red/green 実測ログ"
date: "2026-07-10"
status: active
---

# CL-01〜13 negative TC — TDD red → green 実測ログ（Phase C1）

厳格 TDD の証跡。13 本の TC ファイル（`tests/cl-01-insert-only.test.ts` 〜 `tests/cl-13-tag-events.test.ts`）を**先に**意図インターフェイスへ向けて書き、ガード無しスタブ実装（`packages/truth` の validate 常時 true・無条件 put・固定値 derive、`apps/api` の認証ミドルウェア無し・常時 201）に対して vitest を実行して RED を採取。その後 `packages/truth` / `apps/api` を実装して GREEN を採取した。出力はすべて実行結果の逐語コピー（捏造なし）。

## RED（スタブ実装・ガード無し）

コマンド: `npx vitest run`（cwd: `tests/`、2026-07-10）

```
 RUN  v2.1.9 D:/claude/systems/ihl-ver3/tests

 Test Files  13 failed (13)
      Tests  81 failed | 20 passed (101)
   Duration  612ms (transform 544ms, setup 0ms, collect 1.45s, tests 448ms, environment 5ms, prepare 1.78s)
```

代表的な失敗（逐語抜粋）:

```
 FAIL  cl-01-insert-only.test.ts > CL-01 insert-only (store level) > rejects a duplicate put of the same event id — first-wins
AssertionError: expected 'inserted' to be 'conflict' // Object.is equality

 FAIL  cl-01-insert-only.test.ts > CL-01 insert-only (HTTP level) > POST /events → 201 on first insert, 409 on duplicate
AssertionError: expected 201 to be 409 // Object.is equality

 FAIL  cl-02-provenance.test.ts > CL-02 provenance meta > rejects a record missing required run_id
AssertionError: expected true to be false // Object.is equality

 FAIL  cl-03-actor-id.test.ts > CL-03 actor_id derivation (pure layer) > matches every ver2 vector byte-for-byte

 FAIL  cl-04-deny-by-default.test.ts > CL-04 deny-by-default > unauthenticated POST /events → 401

 FAIL  cl-13-tag-events.test.ts > CL-13 tag event append-only (HTTP level) > duplicate tag event id → 409; invalid shape → 400
AssertionError: expected 201 to be 409 // Object.is equality
```

RED 時に green だった 20 件は「正 fixture が受理される」系（スタブ validate が常時 true のため通過）と CL-12 の「update/delete が存在しない」assert（スタブにも元々無い）。negative ガード 81 件は全滅 = ガードが実装で入ることの証明。

## GREEN（実装後）

コマンド: `npm test`（repo root、`apps/api` と `tests` の両 workspace、2026-07-10）

```
 RUN  v2.1.9 D:/claude/systems/ihl-ver3/apps/api

 ✓ src/index.test.ts (1 test) 30ms

 Test Files  1 passed (1)
      Tests  1 passed (1)

 RUN  v2.1.9 D:/claude/systems/ihl-ver3/tests

 ✓ cl-09-ed25519.test.ts (5 tests) 19ms
 ✓ cl-04-deny-by-default.test.ts (6 tests) 46ms
 ✓ cl-03-actor-id.test.ts (5 tests) 50ms
 ✓ cl-10-qr-token.test.ts (9 tests) 73ms
 ✓ cl-11-transfer-code.test.ts (8 tests) 77ms
 ✓ cl-07-thumbnail.test.ts (9 tests) 78ms
 ✓ cl-08-embedding.test.ts (9 tests) 78ms
 ✓ cl-06-individual-key.test.ts (8 tests) 80ms
 ✓ cl-05-consent.test.ts (9 tests) 93ms
 ✓ cl-12-ledger.test.ts (9 tests) 103ms
 ✓ cl-01-insert-only.test.ts (4 tests) 119ms
 ✓ cl-02-provenance.test.ts (10 tests) 131ms
 ✓ cl-13-tag-events.test.ts (10 tests) 141ms

 Test Files  13 passed (13)
      Tests  101 passed (101)
   Duration  993ms (transform 733ms, setup 0ms, collect 4.61s, tests 1.09s, environment 4ms, prepare 2.19s)
```

`npm run lint`（機械 GATE 5 本）も全 OK: filename / generated-file / agents-sync / schema validation / frontmatter。

## 実装対象（green 化で入ったガード）

| 対象 | 内容 |
|---|---|
| `packages/truth/src/envelope.ts` | Ajv draft-2020-12（`ajv/dist/2020` + ajv-formats）で `schemas/events/envelope.schema.json` と `schemas/frozen/*` 9 本を実行時ロード検証。dataschema → frozen 対応は path / $id 両対応。 |
| `packages/truth/src/store.ts` | `TruthStore.putEvent`: envelope 検証 → key `truth/<type>/<id>.json`（ver2 event_store レイアウト適応）→ `put(key, body, { onlyIf: { etagDoesNotMatch: "*" } })`。null 戻り = conflict（実 R2 実測: `docs/planning/c1/r2-put-if-absent-evidence.md`）。update/delete は存在しない（CL-12 契約）。 |
| `packages/truth/src/contracts.ts` | ver2 互換移植: `canonicalJson`（CL-09）・`deriveActorId`（CL-03）・`deriveTransferCode`（CL-11）・`cosineSimilarity` 次元ガード（CL-08）。全 fixture ベクタ一致。 |
| `apps/api/src/index.ts` | deny-by-default ミドルウェア（PUBLIC_ROUTES=`/health` のみ・他は Bearer DEV_TOKEN 必須・未知 route も 401 先行）+ `POST /events`（201/400/409）。 |
| `tests/helpers.ts` | in-memory R2 fake — 条件付き put の意味論は実測エビデンスをミラー（既存キー + onlyIf → null・上書き無し・先勝ち）。 |

## 機械 GATE 実行結果（統合ラン 2026-07-10）

codegen を機械 GATE に配線（root `lint` チェーン末尾 + `codegen` / `codegen:check` script 追加、CI は既存 `npm run lint` step で通過）後、フル GATE を実行。

```
$ npm run lint
filename lint OK
generated-file guard OK
agents-sync OK
schema validation OK
frontmatter check OK
codegen --check OK (12 files in sync)

$ npm test
apps/api:  Test Files  1 passed (1) / Tests  1 passed (1)
tests:     Test Files  13 passed (13) / Tests  101 passed (101)

$ node scripts/codegen-schemas.mjs --check
codegen --check OK (12 files in sync)
```

全 GATE 緑（lint 6 本 / test 102 件 / codegen sync 12 files）。
